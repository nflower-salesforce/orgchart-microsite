// Persistent data layer for the USAA stakeholder org chart.
//
// Two interchangeable backends behind one async interface:
//   • Postgres  — used whenever DATABASE_URL is set (i.e. on Heroku, which
//     provisions it automatically). The filesystem on a Heroku dyno is
//     ephemeral, so a flat file or SQLite would silently lose every edit on the
//     next deploy/restart — Postgres is the only durable option.
//   • In-memory — used when there is no DATABASE_URL (the test suite and quick
//     local runs). Edits live only for the life of the process.
//
// Either way the database is SEEDED from seed-data.js the first time it is found
// empty, so a fresh deploy comes up pre-populated with the known roster and is
// fully editable from there on.

const { STAKEHOLDERS, WORKSTREAMS } = require("./seed-data");

// Stakeholder fields by storage type. `id` is the primary key (handled
// separately). The chart is hierarchy-first but also draws a "works-with"
// network and groups by workstream, so beyond the plain text fields we keep:
//   • reportsTo            — the single manager edge (may be null = unknown)
//   • reportingConfidence  — "confirmed" | "inferred" (drives solid vs dashed)
//   • workstreams[]        — initiatives this person touches (color + filter)
//   • worksWith[]          — peer/collaboration edges (undirected, by id)
//   • affiliationUncertain — true if it's unclear they're USAA (not a partner)
//   • contractor           — true for contractor/consultant roles
//   • posX / posY          — saved canvas position (null = auto-layout). Lets a
//     user's manual arrangement survive a reload; cleared by auto-layout.
const TEXT_FIELDS = ["name", "title", "email", "linkedin", "sfid", "dept", "cat", "notes"];
const ARRAY_FIELDS = ["workstreams", "worksWith"];
const BOOL_FIELDS = ["affiliationUncertain", "contractor"];
const NUM_FIELDS = ["posX", "posY"];
// Every non-id field, for callers that want the full list.
const FIELDS = [...TEXT_FIELDS, "reportsTo", "reportingConfidence", ...ARRAY_FIELDS, ...BOOL_FIELDS, ...NUM_FIELDS];

const CATEGORIES = ["exec", "tech", "mktg", "ops", "analytics", "unplaced"];
const CONFIDENCE = ["confirmed", "inferred"];

function toArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  // Tolerate a comma-separated string coming from a form field.
  return String(value).split(",").map((v) => v.trim()).filter(Boolean);
}

function normalize(input, fallbackId) {
  const row = { id: input.id || fallbackId };

  for (const field of TEXT_FIELDS) {
    const value = input[field];
    row[field] = value === undefined || value === null ? "" : String(value).trim();
  }
  if (!CATEGORIES.includes(row.cat)) row.cat = "unplaced";

  // reportsTo: empty string → null (unknown / top-level)
  const mgr = input.reportsTo;
  row.reportsTo = mgr === undefined || mgr === null || String(mgr).trim() === ""
    ? null
    : String(mgr).trim();

  // Confidence only matters when there IS a manager; default to inferred.
  row.reportingConfidence = CONFIDENCE.includes(input.reportingConfidence)
    ? input.reportingConfidence
    : "inferred";

  for (const field of ARRAY_FIELDS) row[field] = toArray(input[field]);
  // worksWith must never include self.
  row.worksWith = row.worksWith.filter((wid) => wid !== row.id);

  for (const field of BOOL_FIELDS) row[field] = Boolean(input[field]);

  // Positions: finite number or null (null = let the layout place it).
  for (const field of NUM_FIELDS) {
    const v = input[field];
    row[field] = typeof v === "number" && Number.isFinite(v)
      ? v
      : (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  }

  return row;
}

// A short, URL-safe id derived from a name, with a numeric suffix on collision.
// Mirrors the human-readable initials style of the seed ids (e.g. "JT", "CW").
function makeId(name, existingIds) {
  const initials = String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  let base = initials || "P";
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

// ───────────────────────────── In-memory store ─────────────────────────────

function createMemoryStore() {
  let rows = new Map();

  return {
    kind: "memory",
    async init() {
      if (rows.size === 0) {
        for (const person of STAKEHOLDERS) {
          const row = normalize(person, person.id);
          rows.set(row.id, row);
        }
      }
    },
    async all() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
    async get(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async create(input) {
      const existing = new Set(rows.keys());
      const id = input.id && !existing.has(input.id)
        ? input.id
        : makeId(input.name, existing);
      const row = normalize(input, id);
      rows.set(row.id, row);
      return { ...row };
    },
    async update(id, input) {
      if (!rows.has(id)) return null;
      const row = normalize({ ...input, id }, id);
      rows.set(id, row);
      return { ...row };
    },
    async remove(id) {
      if (!rows.has(id)) return false;
      rows.delete(id);
      for (const row of rows.values()) {
        // Orphan anyone who reported to the removed node...
        if (row.reportsTo === id) row.reportsTo = null;
        // ...and drop it from any works-with lists.
        if (Array.isArray(row.worksWith) && row.worksWith.includes(id)) {
          row.worksWith = row.worksWith.filter((wid) => wid !== id);
        }
      }
      return true;
    },
    // Persist a single card's canvas position (cheap path for drag-to-move).
    async setPosition(id, x, y) {
      const row = rows.get(id);
      if (!row) return false;
      row.posX = Number.isFinite(x) ? x : null;
      row.posY = Number.isFinite(y) ? y : null;
      return true;
    },
    // Bulk position save (after a layout settles).
    async setPositions(list) {
      for (const { id, posX, posY } of list) {
        const row = rows.get(id);
        if (row) { row.posX = Number.isFinite(posX) ? posX : null; row.posY = Number.isFinite(posY) ? posY : null; }
      }
      return true;
    },
    // Forget every saved position so the layout takes over again (auto-layout).
    async clearPositions() {
      for (const row of rows.values()) { row.posX = null; row.posY = null; }
    },
    async _reset() {
      rows = new Map();
    }
  };
}

// ───────────────────────────── Postgres store ──────────────────────────────

function createPostgresStore(connectionString) {
  // Lazy-require so the test suite (no DATABASE_URL) never needs `pg` loaded.
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString,
    // Heroku Postgres requires TLS but uses a cert the default chain rejects.
    ssl: { rejectUnauthorized: false }
  });

  // (object key, db column) pairs in INSERT order. Arrays are stored as JSONB.
  const COLS = [
    ["id", "id"],
    ["name", "name"],
    ["title", "title"],
    ["email", "email"],
    ["linkedin", "linkedin"],
    ["sfid", "sfid"],
    ["dept", "dept"],
    ["cat", "cat"],
    ["notes", "notes"],
    ["reportsTo", "reports_to"],
    ["reportingConfidence", "reporting_confidence"],
    ["workstreams", "workstreams"],
    ["worksWith", "works_with"],
    ["affiliationUncertain", "affiliation_uncertain"],
    ["contractor", "contractor"],
    ["posX", "pos_x"],
    ["posY", "pos_y"]
  ];

  function rowFromDb(r) {
    if (!r) return null;
    return {
      id: r.id,
      name: r.name || "",
      title: r.title || "",
      email: r.email || "",
      linkedin: r.linkedin || "",
      sfid: r.sfid || "",
      dept: r.dept || "",
      cat: r.cat || "unplaced",
      notes: r.notes || "",
      reportsTo: r.reports_to,
      reportingConfidence: r.reporting_confidence || "inferred",
      workstreams: Array.isArray(r.workstreams) ? r.workstreams : [],
      worksWith: Array.isArray(r.works_with) ? r.works_with : [],
      affiliationUncertain: Boolean(r.affiliation_uncertain),
      contractor: Boolean(r.contractor),
      posX: r.pos_x == null ? null : Number(r.pos_x),
      posY: r.pos_y == null ? null : Number(r.pos_y)
    };
  }

  // Build the value list for a normalized row, JSON-encoding the array columns.
  function valuesFor(row) {
    return COLS.map(([key]) =>
      ARRAY_FIELDS.includes(key) ? JSON.stringify(row[key] || []) : row[key]
    );
  }

  const INSERT_SQL = (() => {
    const names = COLS.map(([, col]) => col).join(", ");
    const params = COLS.map((_, i) => `$${i + 1}`).join(", ");
    return { names, params };
  })();

  async function insert(row, onConflictNothing) {
    const tail = onConflictNothing ? "ON CONFLICT (id) DO NOTHING" : "";
    const { rows } = await pool.query(
      `INSERT INTO stakeholders (${INSERT_SQL.names})
       VALUES (${INSERT_SQL.params}) ${tail} RETURNING *`,
      valuesFor(row)
    );
    return rows[0] ? rowFromDb(rows[0]) : null;
  }

  return {
    kind: "postgres",
    pool,
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS stakeholders (
          id                    TEXT PRIMARY KEY,
          name                  TEXT NOT NULL DEFAULT '',
          title                 TEXT NOT NULL DEFAULT '',
          email                 TEXT NOT NULL DEFAULT '',
          linkedin              TEXT NOT NULL DEFAULT '',
          sfid                  TEXT NOT NULL DEFAULT '',
          dept                  TEXT NOT NULL DEFAULT '',
          cat                   TEXT NOT NULL DEFAULT 'unplaced',
          notes                 TEXT NOT NULL DEFAULT '',
          reports_to            TEXT,
          reporting_confidence  TEXT NOT NULL DEFAULT 'inferred',
          workstreams           JSONB NOT NULL DEFAULT '[]'::jsonb,
          works_with            JSONB NOT NULL DEFAULT '[]'::jsonb,
          affiliation_uncertain BOOLEAN NOT NULL DEFAULT false,
          contractor            BOOLEAN NOT NULL DEFAULT false,
          pos_x                 DOUBLE PRECISION,
          pos_y                 DOUBLE PRECISION
        );
      `);
      // Add new columns if an older schema exists (idempotent migration).
      await pool.query(`
        ALTER TABLE stakeholders
          ADD COLUMN IF NOT EXISTS reporting_confidence  TEXT NOT NULL DEFAULT 'inferred',
          ADD COLUMN IF NOT EXISTS workstreams           JSONB NOT NULL DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS works_with            JSONB NOT NULL DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS affiliation_uncertain BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS contractor            BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS pos_x                 DOUBLE PRECISION,
          ADD COLUMN IF NOT EXISTS pos_y                 DOUBLE PRECISION;
      `);
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM stakeholders");
      if (rows[0].n === 0) {
        for (const person of STAKEHOLDERS) {
          await insert(normalize(person, person.id), true);
        }
      }
    },
    async all() {
      const { rows } = await pool.query("SELECT * FROM stakeholders ORDER BY id");
      return rows.map(rowFromDb);
    },
    async get(id) {
      const { rows } = await pool.query("SELECT * FROM stakeholders WHERE id = $1", [id]);
      return rowFromDb(rows[0]);
    },
    async create(input) {
      const { rows: existingRows } = await pool.query("SELECT id FROM stakeholders");
      const existing = new Set(existingRows.map((r) => r.id));
      const id = input.id && !existing.has(input.id)
        ? input.id
        : makeId(input.name, existing);
      return insert(normalize(input, id), false);
    },
    async update(id, input) {
      const row = normalize({ ...input, id }, id);
      const sets = COLS
        .filter(([key]) => key !== "id")
        .map(([, col], i) => `${col}=$${i + 2}`)
        .join(", ");
      const values = [id, ...COLS.filter(([key]) => key !== "id").map(([key]) =>
        ARRAY_FIELDS.includes(key) ? JSON.stringify(row[key] || []) : row[key]
      )];
      const { rows } = await pool.query(
        `UPDATE stakeholders SET ${sets} WHERE id=$1 RETURNING *`,
        values
      );
      return rows[0] ? rowFromDb(rows[0]) : null;
    },
    async remove(id) {
      // Orphan direct reports, and scrub the deleted id from any works-with lists.
      await pool.query("UPDATE stakeholders SET reports_to = NULL WHERE reports_to = $1", [id]);
      await pool.query(
        `UPDATE stakeholders
           SET works_with = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
                             FROM jsonb_array_elements_text(works_with) e
                             WHERE e <> $1)
         WHERE works_with @> to_jsonb($1::text)`,
        [id]
      );
      const { rowCount } = await pool.query("DELETE FROM stakeholders WHERE id = $1", [id]);
      return rowCount > 0;
    },
    async setPosition(id, x, y) {
      const { rowCount } = await pool.query(
        "UPDATE stakeholders SET pos_x = $2, pos_y = $3 WHERE id = $1",
        [id, Number.isFinite(x) ? x : null, Number.isFinite(y) ? y : null]
      );
      return rowCount > 0;
    },
    // Bulk save via one UPDATE ... FROM (unnest) statement.
    async setPositions(list) {
      if (!list.length) return true;
      const ids = [], xs = [], ys = [];
      for (const { id, posX, posY } of list) {
        ids.push(id);
        xs.push(Number.isFinite(posX) ? posX : null);
        ys.push(Number.isFinite(posY) ? posY : null);
      }
      await pool.query(
        `UPDATE stakeholders AS s SET pos_x = v.px, pos_y = v.py
         FROM (SELECT UNNEST($1::text[]) AS id, UNNEST($2::float8[]) AS px, UNNEST($3::float8[]) AS py) AS v
         WHERE s.id = v.id`,
        [ids, xs, ys]
      );
      return true;
    },
    async clearPositions() {
      await pool.query("UPDATE stakeholders SET pos_x = NULL, pos_y = NULL");
    }
  };
}

// ──────────────────────────────── Factory ──────────────────────────────────

function createStore(options = {}) {
  const connectionString = options.databaseUrl || process.env.DATABASE_URL;
  return connectionString
    ? createPostgresStore(connectionString)
    : createMemoryStore();
}

// Would assigning `newParentId` as the parent of `id` create a cycle? A node may
// not report to itself or to any of its own descendants. Pure helper over a
// flat row list so both backends and the route layer can reuse it.
function wouldCreateCycle(rows, id, newParentId) {
  if (!newParentId) return false;
  if (newParentId === id) return true;
  const byId = new Map(rows.map((r) => [r.id, r]));
  let cursor = byId.get(newParentId);
  const seen = new Set();
  while (cursor) {
    if (cursor.id === id) return true;
    if (seen.has(cursor.id)) break; // guard against pre-existing bad data
    seen.add(cursor.id);
    cursor = cursor.reportsTo ? byId.get(cursor.reportsTo) : null;
  }
  return false;
}

module.exports = {
  createStore,
  wouldCreateCycle,
  normalize,
  makeId,
  FIELDS,
  TEXT_FIELDS,
  ARRAY_FIELDS,
  BOOL_FIELDS,
  CATEGORIES,
  CONFIDENCE,
  WORKSTREAMS
};

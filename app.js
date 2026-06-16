const fs = require("node:fs");
const path = require("node:path");

const express = require("express");
const session = require("express-session");

const { createStore, wouldCreateCycle, CATEGORIES, WORKSTREAMS } = require("./data");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function extractDocumentTitle(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/<title>([\s\S]*?)<\/title>/i);

  if (!match) {
    return path.basename(filePath);
  }

  return decodeHtmlEntities(match[1].trim());
}

function listDocuments(documentsDir) {
  // The template ships no documents/ folder — degrade to "just the org chart".
  if (!fs.existsSync(documentsDir)) return [];
  return fs
    .readdirSync(documentsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const filename = entry.name;
      const filePath = path.join(documentsDir, filename);

      return {
        filename,
        title: extractDocumentTitle(filePath)
      };
    });
}

function renderPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/png" href="/favicon.png">
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f7fb;
        --card: #ffffff;
        --text: #1f2a37;
        --muted: #526072;
        --border: #d7e0ea;
        --accent: #1b3a5c;
        --accent-2: #2e5a88;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Arial, sans-serif;
        background: linear-gradient(180deg, #eef3f9 0%, var(--bg) 100%);
        color: var(--text);
      }
      .shell {
        width: min(760px, calc(100% - 32px));
        margin: 48px auto;
        padding: 32px;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 16px;
        box-shadow: 0 12px 40px rgba(27, 58, 92, 0.08);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 1.9rem;
      }
      p {
        margin: 0 0 20px;
        line-height: 1.6;
        color: var(--muted);
      }
      form {
        display: grid;
        gap: 12px;
        margin-top: 20px;
      }
      input {
        width: 100%;
        padding: 12px 14px;
        font-size: 1rem;
        border: 1px solid var(--border);
        border-radius: 10px;
      }
      button, .link-button {
        display: inline-block;
        padding: 12px 16px;
        border: none;
        border-radius: 10px;
        background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
        color: white;
        font-size: 0.98rem;
        text-decoration: none;
        cursor: pointer;
      }
      ul {
        list-style: none;
        margin: 24px 0 0;
        padding: 0;
        display: grid;
        gap: 12px;
      }
      li {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
        background: #fbfdff;
      }
      .doc-link {
        color: var(--accent);
        font-weight: 700;
        text-decoration: none;
      }
      .error {
        color: #9f1c1c;
      }
      .actions {
        margin-top: 24px;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      ${body}
    </main>
  </body>
</html>`;
}

function renderLoginPage(hasError = false) {
  return renderPage(
    "Private Microsite Login",
    `
      <h1>Private Microsite</h1>
      <p>This is private material. Please enter the password:</p>
      ${
        hasError
          ? '<p class="error">Invalid password. Please try again.</p>'
          : ""
      }
      <form method="post" action="/login">
        <input type="password" name="password" aria-label="Password" required>
        <button type="submit">Continue</button>
      </form>
      <script>
        (function () {
          var KEY = "usaa-microsite-pw";
          var hasError = ${hasError ? "true" : "false"};
          var form = document.querySelector('form[action="/login"]');
          var input = form.querySelector('input[name="password"]');
          // Remember the password whenever the form is submitted.
          form.addEventListener("submit", function () {
            try { localStorage.setItem(KEY, input.value); } catch (e) {}
          });
          // A wrong password was just rejected: drop the bad value and stop,
          // so we never auto-resubmit it (loop guard).
          if (hasError) {
            try { localStorage.removeItem(KEY); } catch (e) {}
            return;
          }
          // Otherwise, if we have a stored password, log in automatically.
          var stored = null;
          try { stored = localStorage.getItem(KEY); } catch (e) {}
          if (stored) {
            input.value = stored;
            form.submit();
          }
        })();
      </script>
    `
  );
}

function renderChooserPage(documents, orgChartTitle = "Stakeholder Map") {
  const items = documents
    .map(
      (document) => `
        <li>
          <a class="doc-link" href="/documents/${encodeURIComponent(
            document.filename
          )}">${escapeHtml(document.title)}</a>
        </li>
      `
    )
    .join("");

  return renderPage(
    "Available Documents",
    `
      <h1>Available Documents</h1>
      <p>Select a private document to open.</p>
      <ul>
        <li>
          <a class="doc-link" href="/org-chart">${escapeHtml(orgChartTitle)}</a>
          <div style="margin-top:6px;color:var(--muted);font-size:0.9rem">Interactive, editable stakeholder org chart.</div>
        </li>
      </ul>
      ${
        documents.length
          ? `<ul>${items}</ul>`
          : ""
      }
      <div class="actions">
        <form method="post" action="/logout">
          <button type="submit">Log out</button>
        </form>
      </div>
      <script>
        (function () {
          // Clear the remembered password on logout, or auto-login would
          // immediately sign the user back in on the next /login render.
          var form = document.querySelector('form[action="/logout"]');
          if (!form) return;
          form.addEventListener("submit", function () {
            try { localStorage.removeItem("usaa-microsite-pw"); } catch (e) {}
          });
        })();
      </script>
    `
  );
}

function requireAuth(req, res, next) {
  if (req.session?.isAuthenticated) {
    return next();
  }

  // Remember the specific document the user was trying to open so login can
  // return them to it (instead of dumping everyone at the chooser). Scope this
  // to GET requests for an actual document — not asset sub-requests, not the
  // chooser. The value is server-derived from req.originalUrl (always a local
  // /documents/ path), so it cannot be used for an open redirect.
  if (
    req.method === "GET" &&
    req.session &&
    req.originalUrl.startsWith("/documents/") &&
    !req.originalUrl.startsWith("/documents/supporting-files/")
  ) {
    req.session.returnTo = req.originalUrl;
  }

  return res.redirect("/login");
}

function createApp(options = {}) {
  const app = express();
  const documentsDir =
    options.documentsDir || path.join(__dirname, "documents");
  const sitePassword = options.sitePassword || process.env.SITE_PASSWORD;
  const sessionSecret =
    options.sessionSecret ||
    process.env.SESSION_SECRET ||
    "development-session-secret";

  // Branding is env-driven so the SAME code runs unbranded (the shareable
  // template) or branded (e.g. USAA, via Heroku config vars). Defaults are
  // generic; a deployment sets SITE_TITLE / SITE_SUBTITLE / SITE_LOCKUP.
  const branding = {
    title: options.siteTitle || process.env.SITE_TITLE || "Stakeholder Map",
    subtitle: options.siteSubtitle || process.env.SITE_SUBTITLE || "",
    lockup: options.siteLockup || process.env.SITE_LOCKUP || ""
  };

  if (!sitePassword) {
    throw new Error("SITE_PASSWORD must be configured.");
  }

  // The org-chart data store (Postgres in prod, in-memory for tests/local).
  // Callers can inject a store for testing; otherwise one is built from env.
  // init() is fire-and-forget here — the API handlers await app.locals.storeReady
  // so the first request can't race ahead of schema creation / seeding.
  const store = options.store || createStore(options);
  app.locals.store = store;
  app.locals.storeReady = store.init();
  // Surface a seed failure instead of leaving every request hanging on a
  // promise that already rejected.
  app.locals.storeReady.catch((err) => {
    console.error("Org-chart store failed to initialize:", err);
  });

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
      }
    })
  );

  // Favicon is served PUBLICLY (before requireAuth) so the unauthenticated
  // login page shows a tab icon too. Sourced from the published assets; guarded
  // by existsSync so test fixtures without the file don't 404 the suite.
  const faviconPath = path.join(
    documentsDir,
    "supporting-files",
    "usaa-favicon.png"
  );
  app.get(["/favicon.png", "/favicon.ico"], (_req, res) => {
    if (fs.existsSync(faviconPath)) {
      return res.type("image/png").sendFile(faviconPath);
    }
    return res.status(404).end();
  });

  app.get("/login", (_req, res) => {
    res.status(200).send(renderLoginPage(false));
  });

  app.post("/login", (req, res) => {
    if (req.body.password === sitePassword) {
      req.session.isAuthenticated = true;
      // Return to the document the user originally requested, if any; the
      // value is only ever set by requireAuth from a local /documents/ path.
      const destination = req.session.returnTo || "/";
      delete req.session.returnTo;
      return res.redirect(destination);
    }

    return res.status(401).send(renderLoginPage(true));
  });

  app.post("/logout", (req, res) => {
    req.session.destroy(() => {
      res.redirect("/login");
    });
  });

  app.get("/", requireAuth, (_req, res) => {
    const documents = listDocuments(documentsDir);
    // With no extra documents, the chooser is just the org chart — skip it and
    // send the user straight there.
    if (!documents.length) return res.redirect("/org-chart");
    res.status(200).send(renderChooserPage(documents, branding.title));
  });

  // ── Interactive org chart ──
  // The page is a single self-contained HTML file beside app.js. We inject the
  // env-driven branding (title/subtitle/lockup) via placeholder tokens so the
  // file itself stays brand-neutral and identical across deployments.
  // Served no-store: the page is iterated on frequently, and a stale cached
  // copy makes deployed fixes silently not appear for an open tab.
  const orgChartPath = path.join(__dirname, "org-chart.html");
  function renderOrgChart() {
    const html = fs.readFileSync(orgChartPath, "utf8");
    const lockupTag = branding.lockup
      ? `<span class="lockup-plate"><img class="lockup" src="${escapeHtml(branding.lockup)}" alt="${escapeHtml(branding.title)}"></span>`
      : "";
    // The "All documents" link only makes sense when there ARE other documents
    // to return to (the USAA deck host); the standalone org chart hides it.
    const homeLink = listDocuments(documentsDir).length
      ? '<a class="home-link" href="/">All documents &rarr;</a>'
      : "";
    return html
      .replaceAll("{{SITE_TITLE}}", escapeHtml(branding.title))
      .replaceAll("{{SITE_SUBTITLE}}", escapeHtml(branding.subtitle))
      .replaceAll("{{SITE_LOCKUP}}", lockupTag)
      .replaceAll("{{HOME_LINK}}", homeLink);
  }
  app.get("/org-chart", requireAuth, (_req, res) => {
    res.set("Cache-Control", "no-store, must-revalidate");
    res.type("html").send(renderOrgChart());
  });

  // JSON API backing the page. Every route is auth-gated and awaits the store's
  // one-time init before touching it.
  async function withStore(res, work) {
    try {
      await res.req.app.locals.storeReady;
      return await work(res.req.app.locals.store);
    } catch (err) {
      console.error("Org-chart API error:", err);
      res.status(500).json({ error: "Internal error" });
      return undefined;
    }
  }

  function validateCategory(cat) {
    return cat === undefined || cat === "" || CATEGORIES.includes(cat);
  }

  app.get("/api/stakeholders", requireAuth, (req, res) => {
    withStore(res, async (store) => {
      const people = await store.all();
      res.json({ stakeholders: people, workstreams: WORKSTREAMS });
    });
  });

  app.post("/api/stakeholders", requireAuth, (req, res) => {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!validateCategory(body.cat)) {
      return res.status(400).json({ error: "Invalid category" });
    }
    withStore(res, async (store) => {
      // A new person may only be parented to someone who exists.
      if (body.reportsTo) {
        const parent = await store.get(body.reportsTo);
        if (!parent) return res.status(400).json({ error: "Manager not found" });
      }
      const created = await store.create(body);
      res.status(201).json({ stakeholder: created });
    });
  });

  // ── Position routes (registered BEFORE "/:id" so literal paths win) ──

  // Bulk position save — used after a layout settles (one round-trip for the
  // whole roster instead of N).
  app.put("/api/stakeholders/positions", requireAuth, (req, res) => {
    const list = Array.isArray(req.body?.positions) ? req.body.positions : null;
    if (!list) return res.status(400).json({ error: "positions array required" });
    const clean = list
      .filter((e) => e && typeof e.id === "string")
      .map((e) => ({
        id: e.id,
        posX: e.posX === null ? null : Number(e.posX),
        posY: e.posY === null ? null : Number(e.posY)
      }));
    withStore(res, async (store) => {
      await store.setPositions(clean);
      res.json({ ok: true, count: clean.length });
    });
  });

  // Forget all saved positions (the "auto-layout" action), so the client
  // re-seeds from the tidy tree and re-runs the simulation.
  app.post("/api/stakeholders/reset-positions", requireAuth, (req, res) => {
    withStore(res, async (store) => {
      await store.clearPositions();
      res.json({ ok: true });
    });
  });

  // Lightweight single-card position save — used on drag-end.
  app.put("/api/stakeholders/:id/position", requireAuth, (req, res) => {
    const { id } = req.params;
    const { posX, posY } = req.body || {};
    const x = posX === null ? null : Number(posX);
    const y = posY === null ? null : Number(posY);
    if (x !== null && !Number.isFinite(x)) return res.status(400).json({ error: "Bad posX" });
    if (y !== null && !Number.isFinite(y)) return res.status(400).json({ error: "Bad posY" });
    withStore(res, async (store) => {
      const ok = await store.setPosition(id, x, y);
      if (!ok) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    });
  });

  app.put("/api/stakeholders/:id", requireAuth, (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!validateCategory(body.cat)) {
      return res.status(400).json({ error: "Invalid category" });
    }
    withStore(res, async (store) => {
      const existing = await store.get(id);
      if (!existing) return res.status(404).json({ error: "Not found" });

      if (body.reportsTo) {
        if (body.reportsTo === id) {
          return res.status(400).json({ error: "Cannot report to self" });
        }
        const parent = await store.get(body.reportsTo);
        if (!parent) return res.status(400).json({ error: "Manager not found" });
        const all = await store.all();
        if (wouldCreateCycle(all, id, body.reportsTo)) {
          return res.status(400).json({ error: "That change would create a reporting loop" });
        }
      }
      const updated = await store.update(id, body);
      res.json({ stakeholder: updated });
    });
  });

  app.delete("/api/stakeholders/:id", requireAuth, (req, res) => {
    const { id } = req.params;
    withStore(res, async (store) => {
      const ok = await store.remove(id);
      if (!ok) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    });
  });

  app.use(
    "/documents/supporting-files",
    requireAuth,
    express.static(path.join(documentsDir, "supporting-files"), { index: false })
  );

  app.get("/documents/:filename", requireAuth, (req, res) => {
    const requestedFile = path.basename(req.params.filename);
    const fullPath = path.join(documentsDir, requestedFile);

    // Unknown / stale document URL: send the user to the chooser rather than a
    // dead-end "not found". Redirecting (not rendering inline) clears the bad
    // path from the address bar so a refresh won't re-hit it.
    if (!fs.existsSync(fullPath)) {
      return res.redirect("/");
    }

    return res.sendFile(fullPath);
  });

  return app;
}

module.exports = {
  createApp,
  extractDocumentTitle,
  listDocuments
};

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;

  app.listen(port, () => {
    console.log(`Microsite listening on port ${port}`);
  });
}

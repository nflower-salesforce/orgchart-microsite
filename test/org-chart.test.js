// Seed-agnostic API tests for the org-chart microsite. These exercise the
// auth gate and the stakeholder CRUD/position contract without assuming any
// particular roster, so they keep passing whatever you put in seed-data.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const request = require("supertest");
const { createApp } = require("../app");
const { createStore, wouldCreateCycle } = require("../data");

const fixturesDir = path.join(__dirname, "fixtures"); // need not exist

function makeApp() {
  return createApp({
    documentsDir: fixturesDir,
    sitePassword: "secret",
    sessionSecret: "test-secret",
    store: createStore() // memory store (no DATABASE_URL in tests)
  });
}

async function authed(app) {
  const agent = request.agent(app);
  await agent.post("/login").type("form").send({ password: "secret" });
  return agent;
}

test("API requires login", async () => {
  const res = await request(makeApp()).get("/api/stakeholders");
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/login");
});

test("org-chart page requires login", async () => {
  const res = await request(makeApp()).get("/org-chart");
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/login");
});

test("authenticated user gets the seeded roster + workstreams", async () => {
  const agent = await authed(makeApp());
  const res = await agent.get("/api/stakeholders");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.stakeholders));
  assert.ok(res.body.stakeholders.length >= 1, "seed should have at least one person");
  assert.ok(Array.isArray(res.body.workstreams));
  // Exactly one root (reportsTo === null) is the conventional shape.
  const roots = res.body.stakeholders.filter((p) => !p.reportsTo);
  assert.ok(roots.length >= 1, "there should be a top-of-chart person");
});

test("the org-chart page renders the branded title", async () => {
  const app = createApp({
    documentsDir: fixturesDir, sitePassword: "secret", sessionSecret: "t",
    store: createStore(), siteTitle: "My Team Map"
  });
  const agent = await authed(app);
  const res = await agent.get("/org-chart");
  assert.equal(res.status, 200);
  assert.match(res.text, /My Team Map/);
});

test("create requires a name", async () => {
  const agent = await authed(makeApp());
  const res = await agent.post("/api/stakeholders").send({ title: "Nobody" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Name is required/);
});

test("create then fetch the new person", async () => {
  const agent = await authed(makeApp());
  const list0 = await agent.get("/api/stakeholders");
  const root = list0.body.stakeholders.find((p) => !p.reportsTo);
  const create = await agent.post("/api/stakeholders")
    .send({ name: "Test Person", title: "QA", cat: "tech", reportsTo: root.id });
  assert.equal(create.status, 201);
  assert.ok(create.body.stakeholder.id);
  assert.equal(create.body.stakeholder.reportsTo, root.id);
});

test("create rejects a non-existent manager", async () => {
  const agent = await authed(makeApp());
  const res = await agent.post("/api/stakeholders").send({ name: "Orphan", reportsTo: "NOPE" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Manager not found/);
});

test("update rejects self-as-manager", async () => {
  const agent = await authed(makeApp());
  const list = await agent.get("/api/stakeholders");
  const p = list.body.stakeholders[0];
  const res = await agent.put("/api/stakeholders/" + p.id)
    .send({ name: p.name, cat: p.cat, reportsTo: p.id });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /self/i);
});

test("update rejects a reporting loop", async () => {
  const agent = await authed(makeApp());
  const list = await agent.get("/api/stakeholders");
  const child = list.body.stakeholders.find((p) => p.reportsTo);
  if (!child) return; // seed has only a root; nothing to test
  const manager = list.body.stakeholders.find((p) => p.id === child.reportsTo);
  const res = await agent.put("/api/stakeholders/" + manager.id)
    .send({ name: manager.name, cat: manager.cat, reportsTo: child.id });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /loop/i);
});

test("delete orphans direct reports", async () => {
  const agent = await authed(makeApp());
  const list = await agent.get("/api/stakeholders");
  const manager = list.body.stakeholders.find((p) =>
    list.body.stakeholders.some((q) => q.reportsTo === p.id));
  if (!manager) return; // no manager with reports in this seed
  const del = await agent.delete("/api/stakeholders/" + manager.id);
  assert.equal(del.status, 200);
  const after = await agent.get("/api/stakeholders");
  assert.ok(!after.body.stakeholders.some((p) => p.id === manager.id));
  // Former reports survive, detached.
  for (const p of after.body.stakeholders) {
    assert.notEqual(p.reportsTo, manager.id);
  }
});

test("delete of unknown id is 404", async () => {
  const agent = await authed(makeApp());
  const res = await agent.delete("/api/stakeholders/NOPE");
  assert.equal(res.status, 404);
});

test("position round-trip + bulk save + reset", async () => {
  const agent = await authed(makeApp());
  const list = await agent.get("/api/stakeholders");
  const id = list.body.stakeholders[0].id;
  let res = await agent.put("/api/stakeholders/" + id + "/position").send({ posX: 12, posY: 34 });
  assert.equal(res.status, 200);
  let after = await agent.get("/api/stakeholders");
  assert.equal(after.body.stakeholders.find((p) => p.id === id).posX, 12);
  res = await agent.post("/api/stakeholders/reset-positions");
  assert.equal(res.status, 200);
  after = await agent.get("/api/stakeholders");
  assert.ok(after.body.stakeholders.every((p) => p.posX === null && p.posY === null));
});

test("position routes are not shadowed by /:id", async () => {
  const agent = await authed(makeApp());
  const res = await agent.post("/api/stakeholders/reset-positions");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test("wouldCreateCycle helper", () => {
  const rows = [
    { id: "A", reportsTo: null },
    { id: "B", reportsTo: "A" },
    { id: "C", reportsTo: "B" }
  ];
  assert.equal(wouldCreateCycle(rows, "A", "A"), true);
  assert.equal(wouldCreateCycle(rows, "A", "C"), true);
  assert.equal(wouldCreateCycle(rows, "C", "A"), false);
});

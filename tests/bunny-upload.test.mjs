import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlan, inventory, run, validateStorageConfig } from "../scripts/bunny-upload.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const credentials = { BUNNY_STORAGE_ZONE: "real-storage-zone",
  BUNNY_STORAGE_ENDPOINT: "https://ny.storage.bunnycdn.com",
  BUNNY_STORAGE_PASSWORD: "test-password-never-print" };

function fixture(ids = ["gn-101"], files = { "index.html": "<html><body>Game</body></html>" }) {
  const root = mkdtempSync(join(tmpdir(), "bunny-uploader-"));
  mkdirSync(join(root, "bunny-packages"));
  const packages = ids.map((id) => {
    const folder = join(root, "bunny-packages", id);
    mkdirSync(folder);
    const checksums = {};
    for (const [name, content] of Object.entries(files)) {
      const destination = join(folder, name);
      mkdirSync(join(destination, ".."), { recursive: true });
      writeFileSync(destination, content);
      checksums[name] = hash(content);
    }
    const source = `${id}.html`;
    writeFileSync(join(root, source), "reviewed source");
    return { id, source, sourceSha256: hash("reviewed source"), rightsReviewed: true,
      rightsBasis: "Owner confirmed this exact package", dependenciesReviewed: true,
      rightsEvidence: { type: "developer-permission", url: "https://example.org/permission",
        description: "Permission fixture for this exact game and its assets." },
      startupReport: false, files: checksums };
  });
  writeFileSync(join(root, "bunny-packages", "approved.json"),
    JSON.stringify({ version: 1, packages }));
  return { root, packages, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function fakeBunny({ failPutFor, stale = false, existingMismatch = false } = {}) {
  const storage = new Map();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers });
    if (options.method === "PUT") {
      if (url.includes(failPutFor || "\0")) return new Response(null, { status: 401 });
      const path = new URL(url).pathname.replace(/^\/real-storage-zone/, "");
      storage.set(path, Buffer.from(options.body));
      return new Response(null, { status: 201 });
    }
    const path = new URL(url).pathname;
    const bytes = storage.get(path);
    if (existingMismatch) return new Response("other bytes", { status: 200,
      headers: { "content-type": "text/html" } });
    if (!bytes || stale) return new Response(null, { status: 404 });
    return new Response(bytes, { status: 200,
      headers: { "content-type": path.endsWith(".html") ? "text/html" : "text/javascript" } });
  };
  return { fetchImpl, calls, storage };
}

test("real repository inventories raw games but selects only its reviewed package", () => {
  const root = join(import.meta.dirname, "..");
  assert.ok(inventory(root).sourceFileCount >= 900);
  const plan = buildPlan(root, "all");
  assert.deepEqual(plan.map((item) => item.id), ["gn-114"]);
  assert.equal(plan[0].files.find((file) => file.path === "index.html").sha256,
    "9c6411d1f22f35c3ea6399aa554ad2e1df63af4fe2d87319063debe5c71a4cb8");
});

test("batch sizes and a contiguous resume checkpoint select eligible IDs", () => {
  const data = fixture(Array.from({ length: 105 }, (_, index) => `gn-${index + 1}`).reverse());
  try {
    assert.equal(buildPlan(data.root, "10").length, 10);
    assert.equal(buildPlan(data.root, "50").length, 50);
    assert.equal(buildPlan(data.root, "100").length, 100);
    assert.equal(buildPlan(data.root, "all").length, 105);
    assert.deepEqual(buildPlan(data.root, "10", "gn-1").map((item) => item.id),
      Array.from({ length: 10 }, (_, index) => `gn-${index + 2}`));
    assert.throws(() => buildPlan(data.root, "5"), /Invalid batch/);
    assert.throws(() => buildPlan(data.root, "10", "gn-999"), /Resume ID/);
  } finally { data.cleanup(); }
});

test("rejects unclear rights, changed files, and missing referenced assets", () => {
  const data = fixture(["gn-101"]);
  try {
    data.packages[0].rightsReviewed = false;
    writeFileSync(join(data.root, "bunny-packages", "approved.json"),
      JSON.stringify({ version: 1, packages: data.packages }));
    assert.throws(() => buildPlan(data.root), /rights or dependencies/);
    data.packages[0].rightsReviewed = true;
    writeFileSync(join(data.root, "bunny-packages", "approved.json"),
      JSON.stringify({ version: 1, packages: data.packages }));
    writeFileSync(join(data.root, "bunny-packages", "gn-101", "index.html"),
      '<html><script src="js/missing.js"></script></html>');
    assert.throws(() => buildPlan(data.root), /reviewed hash/);
    data.packages[0].files["index.html"] = hash('<html><script src="js/missing.js"></script></html>');
    writeFileSync(join(data.root, "bunny-packages", "approved.json"),
      JSON.stringify({ version: 1, packages: data.packages }));
    assert.throws(() => buildPlan(data.root), /required asset js\/missing.js is missing/);
  } finally { data.cleanup(); }
});

test("requires specific rights evidence and an exact catalog source match", () => {
  const data = fixture(["gn-114"]);
  try {
    const manifest = join(data.root, "bunny-packages", "approved.json");
    delete data.packages[0].rightsEvidence;
    writeFileSync(manifest, JSON.stringify({ version: 1, packages: data.packages }));
    assert.throws(() => buildPlan(data.root), /hosting-rights evidence/);
    data.packages[0].rightsEvidence = { type: "developer-permission",
      url: "https://example.org/permission", description: "Exact game permission." };
    mkdirSync(join(data.root, "catalog"));
    writeFileSync(join(data.root, "catalog", "zones.json"),
      JSON.stringify([{ id: 114, name: "2048", url: "{HTML_URL}/different.html" }]));
    writeFileSync(manifest, JSON.stringify({ version: 1, packages: data.packages }));
    assert.throws(() => buildPlan(data.root), /source does not match/);
  } finally { data.cleanup(); }
});

test("storage endpoint validation prevents sending the password to another host", () => {
  assert.equal(validateStorageConfig("real-zone", "https://ny.storage.bunnycdn.com"),
    "https://ny.storage.bunnycdn.com/real-zone/");
  assert.throws(() => validateStorageConfig("real-zone", "https://example.com"), /BUNNY_STORAGE_ENDPOINT/);
  assert.throws(() => validateStorageConfig("real-zone", "https://storage.bunnycdn.com.evil.test"),
    /BUNNY_STORAGE_ENDPOINT/);
  assert.throws(() => validateStorageConfig("../zone", "https://storage.bunnycdn.com"),
    /BUNNY_STORAGE_ZONE/);
});

test("plan mode never touches the network or needs a secret", async () => {
  const data = fixture();
  try {
    const result = await run({ root: data.root, mode: "plan", env: {},
      fetchImpl: () => { throw new Error("network should not be used"); } });
    assert.equal(result.error, null);
    assert.deepEqual(result.report.selected, ["gn-101"]);
    assert.deepEqual(result.proposal, {});
  } finally { data.cleanup(); }
});

test("uploads, verifies public bytes, and proposes exact HTML and asset paths", async () => {
  const data = fixture(["gn-101"], { "index.html": '<html><script src="js/game.js"></script></html>',
    "js/game.js": "console.log('game');" });
  try {
    const fake = fakeBunny();
    const result = await run({ root: data.root, mode: "upload", env: credentials,
      fetchImpl: fake.fetchImpl, sleep: async () => {} });
    assert.equal(result.error, null);
    assert.deepEqual(result.report.completed, ["gn-101"]);
    assert.deepEqual(result.proposal["gn-101"], {
      url: "https://gurtsgames.b-cdn.net/games/gn-101/index.html",
      sha256: hash('<html><script src="js/game.js"></script></html>'),
      assets: ["js/game.js"], startupReport: false });
    assert.equal(fake.calls.filter((call) => call.method === "PUT").length, 2);
    assert.ok(fake.calls.filter((call) => call.method === "PUT")
      .every((call) => call.url.startsWith("https://ny.storage.bunnycdn.com/real-storage-zone/games/gn-101/")));
    for (const name of ["bunny-upload-report.json", "bunny-manifest-proposal.json",
      "bunny-source-inventory.json"]) {
      assert.ok(!readFileSync(join(data.root, "bunny-upload-results", name), "utf8")
        .includes(credentials.BUNNY_STORAGE_PASSWORD));
    }
  } finally { data.cleanup(); }
});

test("auth failure stops at a resume-safe checkpoint and never proposes the failed game", async () => {
  const data = fixture(["gn-101", "gn-102"]);
  try {
    const fake = fakeBunny({ failPutFor: "gn-102" });
    const result = await run({ root: data.root, mode: "upload", batch: "all", env: credentials,
      fetchImpl: fake.fetchImpl, sleep: async () => {} });
    assert.equal(result.report.lastCompleted, "gn-101");
    assert.equal(result.report.failed.id, "gn-102");
    assert.deepEqual(Object.keys(result.proposal), ["gn-101"]);
    const retry = fakeBunny();
    const resumed = await run({ root: data.root, mode: "upload", batch: "all",
      resumeAfter: "gn-101", env: credentials, fetchImpl: retry.fetchImpl, sleep: async () => {} });
    assert.deepEqual(resumed.report.selected, ["gn-102"]);
    assert.deepEqual(resumed.report.completed, ["gn-102"]);
  } finally { data.cleanup(); }
});

test("existing different CDN bytes are never overwritten", async () => {
  const data = fixture();
  try {
    const fake = fakeBunny({ existingMismatch: true });
    const result = await run({ root: data.root, mode: "upload", env: credentials,
      fetchImpl: fake.fetchImpl, sleep: async () => {} });
    assert.equal(result.report.failed.id, "gn-101");
    assert.deepEqual(result.proposal, {});
    assert.equal(fake.calls.filter((call) => call.method === "PUT").length, 0);
  } finally { data.cleanup(); }
});

test("CDN propagation failure leaves the uploaded game disabled", async () => {
  const data = fixture();
  try {
    const fake = fakeBunny({ stale: true });
    const result = await run({ root: data.root, mode: "upload", env: credentials,
      fetchImpl: fake.fetchImpl, sleep: async () => {} });
    assert.equal(result.report.failed.id, "gn-101");
    assert.deepEqual(result.proposal, {});
    assert.equal(fake.calls.filter((call) => call.method === "PUT").length, 1);
  } finally { data.cleanup(); }
});

test("transient storage errors are retried without leaking the password", async () => {
  const data = fixture();
  try {
    const fake = fakeBunny();
    let putAttempts = 0;
    const fetchImpl = async (url, options) => {
      if (options.method === "PUT" && putAttempts++ === 0) return new Response(null, { status: 503 });
      return fake.fetchImpl(url, options);
    };
    const result = await run({ root: data.root, mode: "upload", env: credentials,
      fetchImpl, sleep: async () => {} });
    assert.equal(result.error, null);
    assert.equal(putAttempts, 2);
    assert.deepEqual(result.report.completed, ["gn-101"]);
    assert.ok(!JSON.stringify(result.report).includes(credentials.BUNNY_STORAGE_PASSWORD));
  } finally { data.cleanup(); }
});

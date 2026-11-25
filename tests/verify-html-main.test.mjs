import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyHtmlMain } from "../scripts/verify-html-main.mjs";

test("batch verifier proposes only matching HTML with available local assets", async () => {
  const root = mkdtempSync(join(tmpdir(), "html-main-check-"));
  try {
    mkdirSync(join(root, "catalog"));
    mkdirSync(join(root, "bunny-packages"));
    writeFileSync(join(root, "bunny-packages", "approved.json"), '{"version":1,"packages":[]}');
    const rows = [2, 3, 4, 5].map((id) => ({ id, name: `Game ${id}`, url: `{HTML_URL}/${id}.html` }));
    writeFileSync(join(root, "catalog", "zones.json"), JSON.stringify(rows));
    const source = {
      2: "<html><body>working</body></html>",
      3: "<html><body>expected bytes</body></html>",
      4: '<html><script src="js/missing.js"></script></html>',
      5: '<html><script src="/js/root.js"></script></html>',
    };
    for (const [id, html] of Object.entries(source)) writeFileSync(join(root, `${id}.html`), html);
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith("/js/missing.js")) return new Response("missing", { status: 404 });
      const id = Number(new URL(url).pathname.match(/\/(\d+)\.html$/)?.[1]);
      return new Response(id === 3 ? "<html>different</html>" : source[id],
        { headers: { "content-type": "text/html" } });
    };
    const { manifest, counts } = await verifyHtmlMain({ root, fetchImpl, concurrency: 3 });
    assert.deepEqual(Object.keys(manifest), ["gn-2"]);
    assert.equal(counts["html-verified"], 1);
    assert.equal(counts["cdn-mismatch"], 1);
    assert.equal(counts["missing-asset"], 1);
    assert.equal(counts["dependency-review"], 1);
    assert.ok(calls.every((url) => url.startsWith("https://gurtsgames.b-cdn.net/html-main/")));
    assert.deepEqual(JSON.parse(readFileSync(join(root, "bunny-upload-results", "html-main-manifest-proposal.json"))), manifest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

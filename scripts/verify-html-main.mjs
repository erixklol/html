// Verify the owner's existing html-main upload without writing to Bunny Storage.
// Output is a reviewed candidate manifest for Gurt's Games, not an upload approval.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditCatalog } from "./catalog-audit.mjs";

const ORIGIN = "https://gurtsgames.b-cdn.net";
const PREFIX = `${ORIGIN}/html-main/`;
const MAX_HTML = 100_000;
const MAX_ASSETS = 64;
const MAX_ASSET_BYTES = 25_000_000;
const KNOWN_BROKEN = new Map([
  ["gn-1", "existing player reports startup errors"],
  ["gn-406", "existing host did not return usable HTML"],
  ["gn-473", "existing source contains a broken template"],
  ["gn-615", "existing host serves a download instead of HTML"],
]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalized = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));

async function getBounded(fetchImpl, url, maximum, timeoutMs) {
  const response = await fetchImpl(url, {
    method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }
  const type = response.headers.get("content-type")?.toLowerCase() || "";
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error("exceeds size limit");
    }
    chunks.push(value);
  }
  return { type, bytes: Buffer.concat(chunks, length) };
}

function relativeAssets(dependencies, html) {
  if (dependencies.baseUrl) return { paths: [], note: "base URL resolves assets outside html-main" };
  if (dependencies.rootRelativeCount) return { paths: [], note: "root-relative asset paths need review" };
  if (dependencies.relativeCount > MAX_ASSETS) return { paths: [], note: "more than 64 static assets" };
  const paths = [];
  const optionalIcon = /<link\b[^>]*\brel=["'](?:shortcut\s+)?icon["'][^>]*\bhref=["']\.\.\/favicon\.png["']/i.test(html);
  for (const raw of dependencies.relativeAssets) {
    if (raw === "../favicon.png" && optionalIcon) continue;
    const path = raw.replace(/^\.\//, "");
    if (!/^[\w./-]+$/.test(path) || path.split("/").some((part) => !part || part === "." || part === ".."))
      return { paths: [], note: "unsafe relative asset path" };
    paths.push(path);
  }
  return { paths: [...new Set(paths)], note: null };
}

async function oneGame(root, game, fetchImpl, assetCache) {
  const result = { id: game.id, source: game.source, status: "pending", reason: null };
  if (KNOWN_BROKEN.has(game.id)) {
    result.status = "known-broken";
    result.reason = KNOWN_BROKEN.get(game.id);
    return result;
  }
  if (!game.bytes || !game.dependencies?.hasHtmlElement || !game.source.endsWith(".html")) {
    result.status = "invalid-source";
    result.reason = "source is missing or is not a complete HTML document";
    return result;
  }
  if (game.bytes > MAX_HTML) {
    result.status = "too-large";
    result.reason = "source exceeds the 100 KB HTML review limit";
    return result;
  }
  const sourceHtml = normalized(readFileSync(join(root, game.source)));
  const expected = sha256(sourceHtml);
  const url = PREFIX + game.source;
  let html;
  try {
    html = await getBounded(fetchImpl, url, MAX_HTML, 12_000);
  } catch (cause) {
    result.status = "cdn-error";
    result.reason = cause.message;
    return result;
  }
  if (!html.type.includes("text/html") || sha256(html.bytes) !== expected) {
    result.status = "cdn-mismatch";
    result.reason = !html.type.includes("text/html") ? "CDN did not serve HTML" : "CDN HTML differs from reviewed source";
    return result;
  }
  const assets = relativeAssets(game.dependencies, sourceHtml.toString("utf8"));
  if (assets.note && !game.dependencies.baseUrl) {
    result.status = "dependency-review";
    result.reason = assets.note;
    return result;
  }
  for (const path of assets.paths) {
    const assetUrl = new URL(path, url);
    if (assetUrl.origin !== ORIGIN || !assetUrl.href.startsWith(PREFIX) || assetUrl.search || assetUrl.hash) {
      result.status = "dependency-review";
      result.reason = "asset resolves outside html-main";
      return result;
    }
    let check = assetCache.get(assetUrl.href);
    if (!check) {
      check = getBounded(fetchImpl, assetUrl.href, MAX_ASSET_BYTES, 12_000)
        .then((asset) => !asset.type.includes("text/html"))
        .catch(() => false);
      assetCache.set(assetUrl.href, check);
    }
    if (!await check) {
      result.status = "missing-asset";
      result.reason = `required asset ${path} is unavailable or served as HTML`;
      return result;
    }
  }
  result.status = "html-verified";
  result.url = url;
  result.sha256 = expected;
  result.assets = assets.paths;
  result.startupReport = false;
  result.note = assets.note || (game.dependencies.dynamicNetwork || game.dependencies.externalCount ||
    game.dependencies.inlineExternalUrls ? "dynamic or external dependencies need browser gameplay check" : null);
  return result;
}

export async function verifyHtmlMain({ root, fetchImpl = fetch, concurrency = 16, outputDir } = {}) {
  root = resolve(root || ".");
  outputDir = resolve(outputDir || join(root, "bunny-upload-results"));
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32)
    throw new Error("Concurrency must be between 1 and 32.");
  const audit = auditCatalog(root);
  const games = audit.games;
  const results = Array(games.length);
  const assetCache = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, games.length) }, async () => {
    while (next < games.length) {
      const index = next++;
      results[index] = await oneGame(root, games[index], fetchImpl, assetCache);
    }
  }));
  const manifest = Object.fromEntries(results.filter((item) => item.status === "html-verified")
    .map(({ id, url, sha256: hash, assets, startupReport }) =>
      [id, { url, sha256: hash, assets, startupReport }]));
  const counts = Object.fromEntries([...new Set(results.map((item) => item.status))]
    .sort().map((status) => [status, results.filter((item) => item.status === status).length]));
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "html-main-manifest-proposal.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(outputDir, "html-main-verification-report.json"),
    JSON.stringify({ checkedAt: new Date().toISOString(), cdn: PREFIX,
      catalogSha256: audit.catalogSha256, counts, results }, null, 2) + "\n");
  return { manifest, counts, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || ".");
  const { counts } = await verifyHtmlMain({ root });
  console.log(JSON.stringify(counts));
}

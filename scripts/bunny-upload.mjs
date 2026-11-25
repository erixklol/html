import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditCatalog } from "./catalog-audit.mjs";

const CDN = "https://gurtsgames.b-cdn.net";
const REGION_HOSTS = new Set([
  "storage.bunnycdn.com", "uk.storage.bunnycdn.com", "ny.storage.bunnycdn.com",
  "la.storage.bunnycdn.com", "sg.storage.bunnycdn.com", "se.storage.bunnycdn.com",
  "br.storage.bunnycdn.com", "jh.storage.bunnycdn.com", "syd.storage.bunnycdn.com",
]);
const MAX_HTML = 100_000; // Keep the Gurt's Games PR #13 review gate.
const MAX_ASSET = 25_000_000;
const MAX_ASSETS = 64;
const DEFAULT_SLEEP = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const idNumber = (id) => Number(id.slice(3));

function assertPath(path) {
  if (typeof path !== "string" || !/^[\w./-]+$/.test(path) || path.startsWith("/") ||
      path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid package-relative file path.");
  }
  return path;
}

function listFiles(folder, prefix = "") {
  const files = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    assertPath(name);
    const full = join(folder, entry.name);
    if (lstatSync(full).isSymbolicLink()) throw new Error("Package symlinks are not allowed.");
    if (entry.isDirectory()) files.push(...listFiles(full, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error("Package contains an unsupported file type.");
  }
  return files.sort();
}

function referencedAssets(html) {
  if (/<base\b/i.test(html) || /\b(?:fetch|XMLHttpRequest|importScripts|Worker)\s*\(/.test(html)) {
    throw new Error("HTML has a base URL or dynamic network dependency; review and package it first.");
  }
  const refs = new Set();
  const tag = /<(?:script|link|img|audio|video|source|track)\b[^>]*?\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
  const css = /\burl\(\s*["']?([^)'"\s]+)["']?\s*\)/gi;
  for (const regex of [tag, css]) {
    for (const match of html.matchAll(regex)) {
      const ref = match[1];
      if (!ref || ref.startsWith("data:") || ref.startsWith("#")) continue;
      if (/^[a-z][a-z\d+.-]*:/i.test(ref) || ref.startsWith("//") || ref.startsWith("/")) {
        throw new Error("HTML references an external or root-relative asset.");
      }
      const path = ref.split(/[?#]/, 1)[0];
      refs.add(assertPath(path));
    }
  }
  return refs;
}

export function validateStorageConfig(zone, endpoint) {
  if (typeof zone !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(zone)) {
    throw new Error("Set BUNNY_STORAGE_ZONE to the actual Storage Zone name.");
  }
  let url;
  try { url = new URL(endpoint); } catch { /* handled below */ }
  if (!url || url.protocol !== "https:" || !REGION_HOSTS.has(url.hostname) ||
      url.pathname !== "/" || url.search || url.hash || url.username || url.password || url.port) {
    throw new Error("Set BUNNY_STORAGE_ENDPOINT to the HTTPS endpoint shown in Bunny Storage → Access.");
  }
  return `${url.origin}/${zone}/`;
}

function mime(path) {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return {
    html: "text/html; charset=utf-8", js: "text/javascript", mjs: "text/javascript",
    css: "text/css", json: "application/json", wasm: "application/wasm",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", svg: "image/svg+xml", mp3: "audio/mpeg", ogg: "audio/ogg",
    wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", woff: "font/woff",
    woff2: "font/woff2", ttf: "font/ttf", txt: "text/plain; charset=utf-8",
  }[ext] || "application/octet-stream";
}

export function buildPlan(root, batch = "10", resumeAfter = "") {
  if (!["10", "50", "100", "all"].includes(batch)) throw new Error("Invalid batch size.");
  const config = JSON.parse(readFileSync(join(root, "bunny-packages", "approved.json"), "utf8"));
  if (config.version !== 1 || !Array.isArray(config.packages)) throw new Error("Invalid package manifest.");
  const catalogFile = join(root, "catalog", "zones.json");
  const catalog = existsSync(catalogFile) ? new Map(JSON.parse(readFileSync(catalogFile, "utf8"))
    .filter((row) => Number.isSafeInteger(row.id) && row.id >= 0 && typeof row.url === "string")
    .map((row) => [`gn-${row.id}`, row.url])) : null;
  const ids = new Set();
  const entries = config.packages.map((entry) => {
    if (!entry || !/^gn-(0|[1-9]\d{0,3})$/.test(entry.id) || ids.has(entry.id))
      throw new Error("Invalid or duplicate catalog ID in package manifest.");
    ids.add(entry.id);
    return entry;
  }).sort((a, b) => idNumber(a.id) - idNumber(b.id));
  if (resumeAfter && !ids.has(resumeAfter)) throw new Error("Resume ID is not an eligible package.");
  const after = resumeAfter ? entries.filter((item) => idNumber(item.id) > idNumber(resumeAfter)) : entries;
  return after.slice(0, batch === "all" ? undefined : Number(batch)).map((entry) => {
    if (entry.rightsReviewed !== true || !entry.rightsBasis?.trim() ||
        entry.dependenciesReviewed !== true || typeof entry.startupReport !== "boolean") {
      throw new Error(`${entry.id}: rights or dependencies have not been reviewed.`);
    }
    if (catalog && catalog.get(entry.id) !== `{HTML_URL}/${entry.source}`)
      throw new Error(`${entry.id}: source does not match the catalog ID.`);
    if (!entry.rightsEvidence || !["open-license", "developer-permission"].includes(entry.rightsEvidence.type) ||
        !/^https:\/\//.test(entry.rightsEvidence.url || "") ||
        !entry.rightsEvidence.description?.trim())
      throw new Error(`${entry.id}: specific hosting-rights evidence is required.`);
    if (entry.rightsEvidence.type === "open-license" &&
        (!entry.rightsEvidence.licenseFile || !entry.files?.[entry.rightsEvidence.licenseFile]))
      throw new Error(`${entry.id}: the original license must be included in the reviewed package.`);
    if (entry.source && (!/^[\w.-]+\.html$/.test(entry.source) ||
        !/^[a-f0-9]{64}$/.test(entry.sourceSha256 || ""))) {
      throw new Error(`${entry.id}: invalid source provenance.`);
    }
    if (entry.source) {
      if (lstatSync(join(root, entry.source)).isSymbolicLink())
        throw new Error(`${entry.id}: source symlinks are not allowed.`);
      const source = readFileSync(join(root, entry.source));
      // Windows may convert checked-out text to CRLF; the reviewed Git blob is LF.
      const normalized = Buffer.from(source.toString("utf8").replace(/\r\n/g, "\n"));
      if (sha256(source) !== entry.sourceSha256 && sha256(normalized) !== entry.sourceSha256)
        throw new Error(`${entry.id}: source file differs from its reviewed hash.`);
    }
    const folder = join(root, "bunny-packages", entry.id);
    if (!existsSync(folder) || !lstatSync(folder).isDirectory())
      throw new Error(`${entry.id}: reviewed package folder is missing.`);
    const actual = listFiles(folder);
    const expected = entry.files && typeof entry.files === "object" && !Array.isArray(entry.files)
      ? Object.keys(entry.files).sort() : [];
    if (!expected.includes("index.html") || expected.length > MAX_ASSETS + 1 ||
        JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${entry.id}: package files differ from the reviewed file list.`);
    }
    const files = expected.map((path) => {
      assertPath(path);
      const fullPath = join(folder, path);
      const bytes = readFileSync(fullPath);
      const hash = sha256(bytes);
      if (hash !== entry.files[path] || bytes.length > (path === "index.html" ? MAX_HTML : MAX_ASSET))
        throw new Error(`${entry.id}: ${path} differs from its reviewed hash or exceeds the size limit.`);
      return { path, fullPath, sha256: hash, contentType: mime(path) };
    });
    const html = readFileSync(join(folder, "index.html"), "utf8");
    if (!/<html\b/i.test(html)) throw new Error(`${entry.id}: index.html is not an HTML document.`);
    const assets = new Set(files.filter((file) => file.path !== "index.html").map((file) => file.path));
    for (const ref of referencedAssets(html)) {
      if (!assets.has(ref)) throw new Error(`${entry.id}: required asset ${ref} is missing.`);
    }
    return { id: entry.id, startupReport: entry.startupReport, files };
  });
}

export function inventory(root) {
  const sourceFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.html(?:-a)?$/i.test(entry.name))
    .map((entry) => entry.name).sort();
  return { sourceFiles, sourceFileCount: sourceFiles.length };
}

async function request(fetchImpl, sleep, url, options, { retryMissing = false } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    } catch {
      if (attempt === 4) throw new Error("Network request failed after retries.");
    }
    if (response && !([429, 500, 502, 503, 504].includes(response.status) ||
        (retryMissing && response.status === 404))) return response;
    await response?.body?.cancel();
    if (attempt === 4) return response;
    await sleep(Math.min(1000 * 2 ** attempt, 8000));
  }
  throw new Error("Network request failed.");
}

async function digestResponse(response, maxSize) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Host returned an empty response.");
  const hash = createHash("sha256");
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxSize) {
      await reader.cancel();
      throw new Error("Hosted file exceeds the review size limit.");
    }
    hash.update(value);
  }
  return hash.digest("hex");
}

async function checkCdn(file, url, fetchImpl, sleep, afterUpload = false) {
  const response = await request(fetchImpl, sleep, url, { method: "GET" }, { retryMissing: afterUpload });
  if (response.status === 404) {
    await response.body?.cancel();
    return "missing";
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`CDN returned HTTP ${response.status} for ${file.path}.`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (file.path === "index.html" ? !contentType.includes("text/html") : contentType.includes("text/html")) {
    await response.body?.cancel();
    throw new Error(`CDN served the wrong content type for ${file.path}.`);
  }
  const hash = await digestResponse(response, file.path === "index.html" ? MAX_HTML : MAX_ASSET);
  if (hash !== file.sha256) throw new Error(`CDN content differs from the reviewed ${file.path}.`);
  return "match";
}

export async function run({ root, mode = "plan", batch = "10", resumeAfter = "", outDir,
                            env = process.env, fetchImpl = fetch, sleep = DEFAULT_SLEEP }) {
  root = resolve(root);
  outDir = resolve(outDir || join(root, "bunny-upload-results"));
  mkdirSync(outDir, { recursive: true });
  const report = { mode, batch, resumeAfter, selected: [], completed: [], failed: null,
                   lastCompleted: resumeAfter || null };
  const proposal = {};
  let error = null;
  try {
    if (!["plan", "upload"].includes(mode)) throw new Error("Mode must be plan or upload.");
    const plan = buildPlan(root, batch, resumeAfter);
    report.selected = plan.map((item) => item.id);
    if (mode === "upload") {
      const storageBase = validateStorageConfig(env.BUNNY_STORAGE_ZONE, env.BUNNY_STORAGE_ENDPOINT);
      if (!env.BUNNY_STORAGE_PASSWORD) throw new Error("BUNNY_STORAGE_PASSWORD is missing in this repository.");
      for (const item of plan) {
        try {
          const files = item.files.map((file) => ({ ...file,
            publicUrl: `${CDN}/games/${item.id}/${file.path}`,
            storageUrl: `${storageBase}games/${item.id}/${file.path}` }));
          const existing = [];
          // Check every destination before writing any file in this package.
          for (const file of files) existing.push(await checkCdn(file, file.publicUrl, fetchImpl, sleep));
          for (let index = 0; index < files.length; index++) {
            if (existing[index] === "match") continue;
            const file = files[index];
            const uploadBytes = readFileSync(file.fullPath);
            if (sha256(uploadBytes) !== file.sha256)
              throw new Error(`${item.id}: ${file.path} changed after the upload plan was reviewed.`);
            const response = await request(fetchImpl, sleep, file.storageUrl, {
              method: "PUT", body: uploadBytes,
              headers: { AccessKey: env.BUNNY_STORAGE_PASSWORD, "Content-Type": file.contentType,
                         Checksum: file.sha256.toUpperCase() },
            });
            await response.body?.cancel();
            if (![200, 201].includes(response.status))
              throw new Error(`Storage upload failed for ${file.path} (HTTP ${response.status}).`);
          }
          // A proposal is created only after every public CDN file matches its reviewed bytes.
          for (const file of files) {
            if (await checkCdn(file, file.publicUrl, fetchImpl, sleep, true) !== "match")
              throw new Error(`CDN verification failed for ${file.path}; rerun after cache propagation.`);
          }
          proposal[item.id] = { url: `${CDN}/games/${item.id}/index.html`,
            sha256: files.find((file) => file.path === "index.html").sha256,
            assets: files.filter((file) => file.path !== "index.html").map((file) => file.path),
            startupReport: item.startupReport };
          report.completed.push(item.id);
          report.lastCompleted = item.id;
        } catch (cause) {
          report.failed = { id: item.id, reason: cause.message };
          error = cause;
          break; // Fail fast so resumeAfter is always a safe contiguous checkpoint.
        }
      }
    }
  } catch (cause) {
    report.failed = { id: null, reason: cause.message };
    error = cause;
  } finally {
    writeFileSync(join(outDir, "bunny-upload-report.json"), JSON.stringify(report, null, 2) + "\n");
    writeFileSync(join(outDir, "bunny-manifest-proposal.json"), JSON.stringify(proposal, null, 2) + "\n");
    writeFileSync(join(outDir, "bunny-source-inventory.json"), JSON.stringify(inventory(root), null, 2) + "\n");
    if (existsSync(join(root, "catalog", "zones.json"))) {
      writeFileSync(join(outDir, "bunny-migration-report.json"),
        JSON.stringify(auditCatalog(root), null, 2) + "\n");
    }
  }
  return { report, proposal, error };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.split("=", 2)));
  const { report, error } = await run({ root: process.cwd(), mode: args["--mode"] || "plan",
    batch: args["--batch"] || "10", resumeAfter: args["--resume-after"] || "",
    outDir: args["--out-dir"] });
  console.log(`Eligible in batch: ${report.selected.length}; verified: ${report.completed.length}.`);
  if (report.failed) console.error(`Upload stopped at ${report.failed.id || "preflight"}: ${report.failed.reason}`);
  console.log(`Resume after: ${report.lastCompleted || "(start of batch)"}.`);
  if (error) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

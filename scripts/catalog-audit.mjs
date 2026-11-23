import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const VALID_PATH = /^[\w./-]+\.html(?:-a)?$/i;
const TRACKING_PREFIX = /^<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-L7856P3VNT"><\/script>\s*<script>[\s\S]*?<\/script>/;

function catalogPath(row) {
  if (!row || !Number.isSafeInteger(row.id) || row.id < 0 || typeof row.name !== "string" ||
      typeof row.url !== "string" || !row.url.startsWith("{HTML_URL}/")) return null;
  const path = row.url.slice("{HTML_URL}/".length);
  if (!VALID_PATH.test(path) || path.split("/").some((part) => !part || part === "." || part === ".."))
    return null;
  return path;
}

function dependencies(html, root) {
  const knownTracking = TRACKING_PREFIX.test(html);
  const body = knownTracking ? html.replace(TRACKING_PREFIX, "") : html;
  const hasHtmlElement = /<html\b/i.test(body);
  const baseUrl = /<base\b/i.test(body);
  const dynamicNetwork = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|Worker|atob)\s*\(|\bserviceWorker\b|\bimport\s*\(|\b(?:window\.)?location\s*[.=]|createElement\s*\(\s*["'](?:iframe|script|link)["']|\.src\s*=|\bsrcdoc\b/i.test(body);
  const inlineExternalUrls = (body.match(/https?:\/\/[^\s"'<>]+/gi) || []).length;
  const external = new Set();
  const rootRelative = new Set();
  const relative = new Set();
  const missing = new Set();
  const tag = /<(?:script|link|img|audio|video|source|track|iframe|embed|object)\b[^>]*?\b(?:src|href|poster|data)\s*=\s*["']([^"']+)["']/gi;
  const css = /\burl\(\s*["']?([^)'"\s]+)["']?\s*\)/gi;
  for (const regex of [tag, css]) {
    for (const match of body.matchAll(regex)) {
      const url = match[1];
      if (!url || url.startsWith("data:") || url.startsWith("#")) continue;
      if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//")) {
        external.add(url.slice(0, 180));
      } else if (url.startsWith("/")) {
        rootRelative.add(url.slice(0, 180));
      } else {
        const path = url.split(/[?#]/, 1)[0];
        relative.add(path);
        if (!/^[\w./-]+$/.test(path) || path.split("/").includes("..") ||
            !existsSync(join(root, path))) missing.add(path);
      }
    }
  }
  return {
    knownTracking, hasHtmlElement, baseUrl, dynamicNetwork, inlineExternalUrls,
    externalCount: external.size, externalExamples: [...external].slice(0, 5),
    rootRelativeCount: rootRelative.size, rootRelativeExamples: [...rootRelative].slice(0, 5),
    relativeCount: relative.size, relativeAssets: [...relative].slice(0, 64),
    missingCount: missing.size, missingAssets: [...missing].slice(0, 20),
  };
}

function referencedRepository(html) {
  const match = html.match(/https?:\/\/(?:cdn\.jsdelivr\.net\/gh\/|raw\.githubusercontent\.com\/|github\.com\/)([\w.-]+)\/([\w.-]+)/i);
  return match ? `${match[1]}/${match[2].replace(/@.*$/, "")}` : null;
}

export function auditCatalog(root, { catalog = join(root, "catalog", "zones.json"),
                                      verified } = {}) {
  verified ??= existsSync(join(root, "catalog", "verified-cdn.json"))
    ? JSON.parse(readFileSync(join(root, "catalog", "verified-cdn.json"), "utf8")) : {};
  const rows = JSON.parse(readFileSync(catalog, "utf8"));
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error("Invalid catalog snapshot.");
  const approvals = JSON.parse(readFileSync(join(root, "bunny-packages", "approved.json"), "utf8"));
  const approved = new Map(approvals.packages.map((entry) => [entry.id, entry]));
  const rootHtml = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.html(?:-a)?$/i.test(entry.name))
    .map((entry) => entry.name).sort();
  const usedFiles = new Map();
  const contentHashes = new Map();
  const games = [];
  const seenIds = new Set();
  for (const row of rows) {
    const path = catalogPath(row);
    if (!path) continue; // Mirrors the site's catalog parser, including its suggestion row.
    const id = `gn-${row.id}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const game = { id, name: row.name.trim().slice(0, 160), source: path,
      rights: "review-needed" };
    const previous = usedFiles.get(path);
    if (previous) game.duplicatePathOf = previous;
    else usedFiles.set(path, id);
    const full = join(root, path);
    if (!existsSync(full)) {
      game.status = "failed";
      game.reasons = ["catalog source file missing from html repository"];
      games.push(game);
      continue;
    }
    const bytes = readFileSync(full);
    game.bytes = bytes.length;
    game.sha256 = sha256(bytes);
    const html = bytes.toString("utf8");
    game.dependencies = dependencies(html, root);
    game.referencedRepository = referencedRepository(html);
    game.structuralStandalone = game.dependencies.hasHtmlElement && !game.dependencies.baseUrl &&
      !game.dependencies.dynamicNetwork && !game.dependencies.externalCount &&
      !game.dependencies.rootRelativeCount && !game.dependencies.relativeCount &&
      !game.dependencies.inlineExternalUrls && bytes.length <= 100_000;
    const previousContent = contentHashes.get(game.sha256);
    if (previousContent) game.duplicateContentOf = previousContent;
    else contentHashes.set(game.sha256, id);
    const reasons = [];
    if (!game.dependencies.hasHtmlElement) reasons.push("source is not a complete HTML game document");
    if (game.duplicatePathOf || game.duplicateContentOf) reasons.push("duplicate file needs individual review");
    if (game.bytes > 100_000) reasons.push("HTML exceeds the 100 KB site verification limit");
    if (game.dependencies.baseUrl) reasons.push("base URL changes relative asset resolution");
    if (game.dependencies.externalCount) reasons.push("external assets need local packaging and permission review");
    if (game.dependencies.rootRelativeCount) reasons.push("root-relative assets need path review");
    if (game.dependencies.dynamicNetwork) reasons.push("dynamic network loading needs manual review");
    if (game.dependencies.inlineExternalUrls) reasons.push("inline external URLs need manual review");
    if (game.dependencies.missingCount) reasons.push("referenced local assets are missing");
    const approval = approved.get(id);
    game.rights = approval?.rightsReviewed === true ? "reviewed-for-package" : "review-needed";
    const verifiedEntry = verified[id];
    game.cdnVerified = verifiedEntry?.url === `https://gurtsgames.b-cdn.net/games/${id}/index.html` &&
      /^[a-f0-9]{64}$/.test(verifiedEntry.sha256 || "");
    if (approval?.rightsReviewed === true && verifiedEntry?.sha256 === approval.files?.["index.html"] &&
        verifiedEntry?.url === `https://gurtsgames.b-cdn.net/games/${id}/index.html`) {
      game.status = "successfully_verified";
    } else if (approval?.rightsReviewed === true) {
      game.status = "ready";
    } else if (!game.dependencies.hasHtmlElement) {
      game.status = "failed";
    } else if (game.dependencies.missingCount) {
      game.status = "missing_assets";
    } else if (reasons.length) {
      game.status = "separate_review";
    } else {
      game.status = "license_review_needed";
    }
    game.sourceIssues = [...reasons];
    if (game.rights === "review-needed") reasons.push("hosting rights not verified for this game");
    game.reasons = approval?.rightsReviewed === true ? [] : reasons;
    games.push(game);
  }
  const mappedFiles = new Set(games.map((game) => game.source));
  const counts = Object.fromEntries(["ready", "missing_assets", "license_review_needed",
    "separate_review", "failed", "successfully_verified"].map((status) =>
    [status, games.filter((game) => game.status === status).length]));
  const repositoryGroups = new Map();
  for (const game of games) {
    if (!game.referencedRepository) continue;
    const group = repositoryGroups.get(game.referencedRepository) || { repository: game.referencedRepository, ids: [] };
    group.ids.push(game.id);
    repositoryGroups.set(game.referencedRepository, group);
  }
  return {
    source: "https://github.com/erixklol/assets/blob/main/zones.json",
    catalogSha256: sha256(readFileSync(catalog)),
    catalogRows: rows.length,
    mappedGames: games.length,
    rootHtmlFiles: rootHtml.length,
    unmappedSourceFiles: rootHtml.filter((path) => !mappedFiles.has(path)),
    cdnVerifiedCount: games.filter((game) => game.cdnVerified).length,
    structuralStandaloneCount: games.filter((game) => game.structuralStandalone).length,
    repositoryGroups: [...repositoryGroups.values()].sort((a, b) => b.ids.length - a.ids.length || a.repository.localeCompare(b.repository)),
    counts,
    games,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || ".");
  const report = auditCatalog(root);
  const output = join(root, "bunny-upload-results", "bunny-migration-report.json");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(root, "bunny-upload-results"), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Mapped ${report.mappedGames} catalog games; statuses: ${JSON.stringify(report.counts)}`);
}

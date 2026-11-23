// Reproduce the reviewed gn-114 package from the original MIT-licensed source.
// Run locally after checking out ovolve/2048-AI at the pinned commit below.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const COMMIT = "226be513371ce2493843b2485c280e2389ef7dad";
const source = resolve(process.argv[2] || "");
const destination = resolve("bunny-packages/gn-114");
if (execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== COMMIT)
  throw new Error("Check out the reviewed 2048-AI commit before preparing this package.");

function original(path) {
  return execFileSync("git", ["-C", source, "show", `${COMMIT}:${path}`]);
}
function replaceExact(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Upstream ${label} changed; review it again.`);
  return text.replace(before, after);
}
function put(path, bytes) {
  mkdirSync(join(destination, path, ".."), { recursive: true });
  writeFileSync(join(destination, path), bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

let html = original("index.html").toString("utf8");
html = replaceExact(html, '  <link rel="shortcut icon" href="favicon.ico">\n', "", "favicon link");
const sharingStart = html.indexOf('    <div class="sharing">');
const sharingEnd = html.indexOf('\n  </div>\n\n  <script src="js/animframe_polyfill.js">', sharingStart);
if (sharingStart < 0 || sharingEnd < 0) throw new Error("Upstream sharing block changed.");
html = html.slice(0, sharingStart) + html.slice(sharingEnd);
const analyticsStart = html.indexOf('  <script>\n    (function(i,s,o,g,r,a,m)');
const analyticsEnd = html.indexOf('  </script>', analyticsStart);
if (analyticsStart < 0 || analyticsEnd < 0) throw new Error("Upstream analytics block changed.");
html = html.slice(0, analyticsStart) + html.slice(analyticsEnd + '  </script>'.length);
html = html.replace('</head>', '  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src data:; connect-src \'none\'; font-src \'none\'; base-uri \'none\'; form-action \'none\'">\n</head>');

let css = original("style/main.css").toString("utf8");
css = replaceExact(css, "@import url(fonts/clear-sans.css);\n", "", "font import");
css = css.replaceAll('"Clear Sans", ', "");

let keyboard = original("js/keyboard_input_manager.js").toString("utf8");
keyboard = replaceExact(keyboard, "feedbackContainer.innerHTML = '<img src=img/spinner.gif />';",
  "feedbackContainer.textContent = 'Thinking…';", "spinner");

let actuator = original("js/html_actuator.js").toString("utf8");
actuator = replaceExact(actuator, '  if (ga) ga("send", "event", "game", "restart");\n', "", "analytics call");
actuator = replaceExact(actuator,
  "  this.sharingContainer.appendChild(this.scoreTweetButton());\n  twttr.widgets.load();\n", "", "Twitter widgets");

const files = {};
files["index.html"] = put("index.html", Buffer.from(html));
files["style/main.css"] = put("style/main.css", Buffer.from(css));
files["style/ai.css"] = put("style/ai.css", original("style/ai.css"));
for (const name of ["animframe_polyfill", "hammer.min", "keyboard_input_manager", "html_actuator",
                    "grid", "tile", "ai", "game_manager", "application"]) {
  const path = `js/${name}.js`;
  files[path] = put(path, Buffer.from(name === "keyboard_input_manager" ? keyboard :
    name === "html_actuator" ? actuator : original(path)));
}
files["LICENSE.txt"] = put("LICENSE.txt", original("LICENSE.txt"));
files["ATTRIBUTION.txt"] = put("ATTRIBUTION.txt", Buffer.from(
  "2048 by Gabriele Cirulli; AI solver by Matt Overlan.\n" +
  "Original project: https://github.com/ovolve/2048-AI/tree/226be513371ce2493843b2485c280e2389ef7dad\n" +
  "Original 2048: https://github.com/gabrielecirulli/2048\n" +
  "Hammer.js by Jorik Tangelder (MIT notice retained in js/hammer.min.js).\n" +
  "MIT license: see LICENSE.txt. This package removes external analytics, sharing widgets,\n" +
  "the optional font files, favicon and spinner image. Gameplay and AI scripts remain.\n"));
console.log(JSON.stringify(Object.fromEntries(Object.entries(files).sort()), null, 2));

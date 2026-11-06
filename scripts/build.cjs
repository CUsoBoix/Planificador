const fs = require("node:fs"),
  path = require("node:path");
const root = path.join(__dirname, ".."),
  out = path.join(root, "dist");
fs.mkdirSync(out, { recursive: true });
for (const name of [
  "index.html",
  "styles.css",
  "app.js",
  "work-engine.js",
  "work-ui.js",
  "file-rules.js",
  "cloud-config.js",
  "assets",
])
  fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true });
console.log("Static application packaged in dist/");

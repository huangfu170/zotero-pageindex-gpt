const fs = require("fs");
const path = require("path");
const { config } = require("../package.json");
const { readDotEnv, resolveProjectPath } = require("./env");

const rootDir = path.resolve(__dirname, "..");
const env = readDotEnv(rootDir);
const profilePath = resolveProjectPath(env.ZOTERO_PLUGIN_PROFILE_PATH, rootDir);
const addonPath = path.join(rootDir, "builds", "addon");

if (!profilePath) {
  console.error("Missing ZOTERO_PLUGIN_PROFILE_PATH in .env.");
  process.exit(1);
}

if (!fs.existsSync(path.join(addonPath, "manifest.json"))) {
  console.error("Missing builds/addon/manifest.json. Run npm run build-dev first.");
  process.exit(1);
}

const extensionsDir = path.join(profilePath, "extensions");
fs.mkdirSync(extensionsDir, { recursive: true });

const proxyPath = path.join(extensionsDir, config.addonID);
fs.writeFileSync(proxyPath, addonPath, "utf8");

console.log(`[Dev] Installed proxy extension: ${proxyPath}`);
console.log(`[Dev] Proxy target: ${addonPath}`);

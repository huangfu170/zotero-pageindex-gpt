const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const { config } = pkg;
const { readDotEnv, resolveProjectPath } = require("./env");

const rootDir = path.resolve(__dirname, "..");
const env = readDotEnv(rootDir);
const profilePath = resolveProjectPath(env.ZOTERO_PLUGIN_PROFILE_PATH, rootDir);
const addonPath = path.join(rootDir, "builds", "addon");
const xpiPath = path.join(rootDir, "builds", `${pkg.name}.xpi`);

if (!profilePath) {
  console.error("Missing ZOTERO_PLUGIN_PROFILE_PATH in .env.");
  process.exit(1);
}

if (!fs.existsSync(path.join(addonPath, "manifest.json"))) {
  console.error("Missing builds/addon/manifest.json. Run npm run build-dev first.");
  process.exit(1);
}
if (!fs.existsSync(xpiPath)) {
  console.error(`Missing ${xpiPath}. Run npm run build-dev first.`);
  process.exit(1);
}

const extensionsDir = path.join(profilePath, "extensions");
fs.mkdirSync(extensionsDir, { recursive: true });

const proxyPath = path.join(extensionsDir, config.addonID);
const installedXpiPath = path.join(extensionsDir, `${config.addonID}.xpi`);
if (fs.existsSync(proxyPath)) {
  fs.rmSync(proxyPath, { recursive: true, force: true });
}
fs.copyFileSync(xpiPath, installedXpiPath);

for (const stalePath of [
  path.join(profilePath, "extensions.json"),
  path.join(profilePath, "extensions.ini"),
  path.join(profilePath, "compatibility.ini"),
  path.join(profilePath, "startupCache"),
]) {
  if (fs.existsSync(stalePath)) {
    fs.rmSync(stalePath, { recursive: true, force: true });
  }
}

console.log(`[Dev] Installed development XPI: ${installedXpiPath}`);

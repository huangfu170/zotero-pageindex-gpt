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

const userPrefsPath = path.join(profilePath, "user.js");
const managedPrefs = {
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "xpinstall.signatures.required": false,
  "extensions.install.requireBuiltInCerts": false,
};

function formatPref(name, value) {
  return `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`;
}

function upsertUserPrefs() {
  const existing = fs.existsSync(userPrefsPath)
    ? fs.readFileSync(userPrefsPath, "utf8")
    : "";
  const managedNames = new Set(Object.keys(managedPrefs));
  const preservedLines = existing
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^\s*user_pref\("([^"]+)"/);
      return !match || !managedNames.has(match[1]);
    })
    .filter((line) => line.trim().length > 0);

  const next = [
    ...preservedLines,
    "// Zotero PageIndex GPT development profile preferences.",
    ...Object.entries(managedPrefs).map(([name, value]) => formatPref(name, value)),
    "",
  ].join("\n");
  fs.writeFileSync(userPrefsPath, next);
}

upsertUserPrefs();

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
  path.join(profilePath, "addonStartup.json.lz4"),
  path.join(profilePath, "startupCache"),
]) {
  if (fs.existsSync(stalePath)) {
    try {
      fs.rmSync(stalePath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`[Dev] Could not remove ${stalePath}: ${error.message}`);
    }
  }
}

console.log(`[Dev] Installed development XPI: ${installedXpiPath}`);

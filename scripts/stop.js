const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const localConfigPath = path.join(__dirname, "zotero-cmd.json");
const defaultConfigPath = path.join(__dirname, "zotero-cmd-default.json");

function loadConfig() {
  if (!fs.existsSync(localConfigPath)) {
    fs.copyFileSync(defaultConfigPath, localConfigPath);
    return require(localConfigPath);
  }
  return require(localConfigPath);
}

const { killZoteroWindows, killZoteroUnix } = loadConfig();

try {
  if (process.platform === "win32") {
    execSync(killZoteroWindows);
  } else {
    execSync(killZoteroUnix);
  }
} catch (e) {}

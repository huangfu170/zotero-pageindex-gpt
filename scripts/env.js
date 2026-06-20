const fs = require("fs");
const path = require("path");

function unquote(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

function readDotEnv(rootDir = process.cwd()) {
  const envPath = path.join(rootDir, ".env");
  const result = {};
  if (!fs.existsSync(envPath)) {
    return result;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    result[match[1].trim()] = unquote(match[2].trim());
  }
  return result;
}

function resolveProjectPath(value, rootDir = process.cwd()) {
  if (!value) {
    return "";
  }
  const normalized = value.replace(/\\\\/g, "\\");
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(rootDir, normalized);
}

module.exports = {
  readDotEnv,
  resolveProjectPath,
};

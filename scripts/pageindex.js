const { spawnSync } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const serverPath = path.join(rootDir, "pageindex_service", "server.py");
const defaultPageIndexRepo = path.resolve(rootDir, "..", "PageIndex");

const candidates =
  process.platform === "win32"
    ? [
        { command: "py", args: ["-3.11"] },
        { command: "py", args: ["-3.10"] },
        { command: "py", args: ["-3.9"] },
        { command: "python3.11", args: [] },
        { command: "python3.10", args: [] },
        { command: "python3.9", args: [] },
        { command: "python", args: [] },
      ]
    : [
        { command: "python3.11", args: [] },
        { command: "python3.10", args: [] },
        { command: "python3.9", args: [] },
        { command: "python3", args: [] },
        { command: "python", args: [] },
      ];

function parseVersion(text) {
  const match = String(text).match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isSupported(version) {
  return version && (version.major > 3 || (version.major === 3 && version.minor >= 9));
}

function findPython() {
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.error) {
      continue;
    }
    const version = parseVersion(`${result.stdout}\n${result.stderr}`);
    if (isSupported(version)) {
      return candidate;
    }
  }
  return undefined;
}

const python = findPython();
if (!python) {
  console.error("PageIndex bridge requires Python 3.9 or newer.");
  console.error("Install Python 3.9+ and rerun `npm run pageindex`.");
  process.exit(1);
}

const env = {
  ...process.env,
  PAGEINDEX_REPO: process.env.PAGEINDEX_REPO || defaultPageIndexRepo,
  PAGEINDEX_WORKSPACE:
    process.env.PAGEINDEX_WORKSPACE || path.join(rootDir, ".scaffold", "pageindex_workspace"),
  OPENAI_API_BASE: process.env.OPENAI_API_BASE || "https://api.longcat.chat/openai",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "https://api.longcat.chat/openai",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  PAGEINDEX_RETRIEVE_MODEL: process.env.PAGEINDEX_RETRIEVE_MODEL || "openai/LongCat-2.0-Preview",
  PAGEINDEX_INDEX_MODEL: process.env.PAGEINDEX_INDEX_MODEL || "openai/LongCat-2.0-Preview",
};

const run = spawnSync(
  python.command,
  [...python.args, serverPath, ...process.argv.slice(2)],
  {
    cwd: rootDir,
    env,
    stdio: "inherit",
    windowsHide: false,
  },
);

if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 0);

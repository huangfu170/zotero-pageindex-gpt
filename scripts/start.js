const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { exit } = require("process");
const { readDotEnv, resolveProjectPath } = require("./env");

const localConfigPath = path.join(__dirname, "zotero-cmd.json");
const defaultConfigPath = path.join(__dirname, "zotero-cmd-default.json");
const rootDir = path.resolve(__dirname, "..");

function loadConfig() {
  if (!fs.existsSync(localConfigPath)) {
    fs.copyFileSync(defaultConfigPath, localConfigPath);
    console.error(
      `Missing scripts/zotero-cmd.json. A template was created at ${localConfigPath}. Edit it and run npm start again.`,
    );
    exit(1);
  }
  return require(localConfigPath);
}

const { exec } = loadConfig();
const env = readDotEnv(rootDir);

// Run node start.js -h for help
const args = require("minimist")(process.argv.slice(2));

if (args.help || args.h) {
  console.log("Start Zotero Args:");
  console.log(
    "--zotero(-z): Zotero exec key in zotero-cmd.json. Default the first one."
  );
  console.log("--profile(-p): Zotero profile path. Defaults to ZOTERO_PLUGIN_PROFILE_PATH in .env.");
  exit(0);
}

const zoteroPath =
  resolveProjectPath(env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH, rootDir) ||
  exec[args.zotero || args.z || Object.keys(exec)[0]];
const profile = resolveProjectPath(
  args.profile || args.p || env.ZOTERO_PLUGIN_PROFILE_PATH,
  rootDir,
);

const startZotero = `${zoteroPath} --debugger --purgecaches ${
  profile ? `-profile "${profile}"` : ""
}`;

execSync(startZotero);
exit(0);

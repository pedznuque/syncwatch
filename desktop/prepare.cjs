const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const clientDir = path.join(rootDir, "client");
const appDir = path.join(__dirname, "app");
const clientModulesDir = path.join(clientDir, "node_modules");
const viteBin = path.join(clientModulesDir, ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const serverUrl = process.env.SYNCWATCH_SERVER_URL || "https://syncwatch-tgzg.onrender.com";
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

function run(command, args, cwd, env = process.env) {
  const executable = command === "npm" ? process.execPath : command;
  const finalArgs = command === "npm" ? [npmCli, ...args] : args;
  const result = spawnSync(executable, finalArgs, {
    cwd,
    env,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function cleanDir(target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

if (!fs.existsSync(clientModulesDir) || !fs.existsSync(viteBin)) {
  run("npm", ["ci", "--prefix", "client"], rootDir);
}
run("npm", ["run", "build", "--prefix", "client", "--", "--base=./"], rootDir, {
  ...process.env,
  VITE_SERVER_URL: serverUrl
});

cleanDir(appDir);
copyDir(path.join(clientDir, "dist"), appDir);

console.log(`Desktop frontend prepared in ${appDir}`);

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Desktop users: default profile is "desktop" (not "web").
const profile = process.env.DSH_PROFILE || process.argv[2] || "desktop";
const plugins = [
  path.join(root, "plugins/memory-tools"),
  path.join(root, "plugins/whale-preset"),
];

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  return r.status ?? 1;
}

console.log(`[setup] target profile=${profile} (override with DSH_PROFILE or argv)`);
console.log(
  "[setup] Desktop tip: fully quit DeepSeek Harness Desktop first, then reopen after install.",
);

let failed = 0;
for (const plugin of plugins) {
  // Prefer installed `dsh` (desktop-bundled CLI) when present; fall back to npx.
  let code = run("dsh", ["plugin", "--profile", profile, "add", plugin]);
  if (code !== 0) {
    code = run("npx", [
      "@deepseek-ai/dsh",
      "plugin",
      "--profile",
      profile,
      "add",
      plugin,
    ]);
  }
  if (code !== 0) {
    failed = code;
    console.warn(`[setup] failed to add ${plugin}`);
    console.warn(
      `[setup] try from Desktop tray terminal:\n  dsh plugin --profile ${profile} add "${plugin}"`,
    );
  }
}

if (failed !== 0) {
  console.warn(
    "[setup] Plugin install incomplete. For Desktop: open app once, fully quit, retry, then reopen.",
  );
  process.exit(0);
}
console.log(`[setup] plugins installed into profile=${profile}`);
console.log("[setup] reopen DeepSeek Harness Desktop to load bundles.");

#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAppConfig } from "@dsh-memory-sea/shared";
import { runNightlyMaintenance } from "./jobs/nightly.js";

function findRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    if (existsSync(path.join(dir, "config.json")) || existsSync(path.join(dir, "config.example.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

async function main() {
  const root = findRoot();
  const configPath = process.argv[2] ?? path.join(root, "config.json");
  let dbPath = path.join(root, "data/memory/sea.sqlite");
  let memoryConfig = undefined;

  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    const cfg = parseAppConfig(raw);
    dbPath = path.resolve(root, cfg.memory.dbPath);
    memoryConfig = cfg.memory;
  } catch {
    // Fall back to defaults when config.json is missing.
  }

  const result = runNightlyMaintenance({ dbPath, config: memoryConfig });
  console.log(JSON.stringify({ ok: true, dbPath, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

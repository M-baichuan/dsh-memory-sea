#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync(
  "pnpm",
  ["--filter", "@dsh-memory-sea/memory-sea", "test"],
  { cwd: root, stdio: "inherit", shell: true },
);
process.exit(r.status ?? 1);

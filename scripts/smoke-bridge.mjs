#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "memory-sea-smoke-"));
  const dbPath = path.join(dir, "sea.sqlite");

  const { MemorySea } = await import(
    pathToFileURL(path.join(root, "packages/memory-sea/dist/index.js")).href
  );
  const { parseAppConfig, scopesForPrivate } = await import(
    pathToFileURL(path.join(root, "packages/shared/dist/index.js")).href
  );
  const { buildMemoryPrefix, composeUserPayload } = await import(
    pathToFileURL(path.join(root, "packages/bridge/dist/pipeline/memory-inject.js")).href
  );
  const { qqSessionKey } = await import(
    pathToFileURL(path.join(root, "packages/bridge/dist/dsh/sessions.js")).href
  );

  const cfg = parseAppConfig({
    memory: { dbPath, recallLimit: 4, injectCharLimit: 400 },
  });
  const sea = new MemorySea({ dbPath, config: cfg.memory });
  sea.remember(
    { kind: "user", userId: "42" },
    {
      content: "我叫Alice",
      category: "identity",
      importance: 0.95,
      confidence: 0.95,
    },
  );

  const { block, evidenceIds } = buildMemoryPrefix(sea, cfg, {
    userId: "42",
    query: "我叫什么",
  });
  const payload = composeUserPayload(block, "我叫什么");
  if (!block.includes("Alice")) throw new Error("memory inject failed");
  if (!payload.includes("[用户消息]")) throw new Error("payload compose failed");
  sea.reinforce(evidenceIds);

  const key = qqSessionKey({ userId: "42" });
  if (key !== "private:42") throw new Error("session key mismatch");

  const scopes = scopesForPrivate("42");
  if (scopes[0]?.kind !== "user") throw new Error("scope helper failed");

  sea.close();
  rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, evidenceIds, key }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

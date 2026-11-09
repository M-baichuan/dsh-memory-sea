#!/usr/bin/env node
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemorySea } from "@dsh-memory-sea/memory-sea";
import {
  parseAppConfig,
  parseScopeKey,
  type MemoryVisibility,
  type RecallChannel,
} from "@dsh-memory-sea/shared";
import {
  handleSetupApply,
  handleSetupBootstrap,
  handleSetupState,
  handleSetupValidate,
} from "./setup-api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../public");

export const name = "@dsh-memory-sea/console";

export function apply() {
  // Cordis host half: standalone console is preferred for V1.
}

/** Walk up from cwd (or start) to the monorepo root that owns config.json. */
function resolveRepoRoot(start = process.cwd()): string {
  let cur = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(cur, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (raw.name === "dsh-memory-sea") return cur;
      } catch {
        // continue walking
      }
    }
    if (existsSync(path.join(cur, "packages/bridge")) && existsSync(path.join(cur, "config.json"))) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(start);
}

async function loadConfig(root: string) {
  try {
    const raw = JSON.parse(await readFile(path.join(root, "config.json"), "utf8")) as unknown;
    return parseAppConfig(raw);
  } catch {
    return parseAppConfig({});
  }
}

function requireToken(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
): boolean {
  if (token && req.headers["x-console-token"] !== token) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return false;
  }
  return true;
}

async function main() {
  const root = resolveRepoRoot();
  const cfg = await loadConfig(root);
  const token = cfg.bridge.consoleToken || process.env.MEMORY_SEA_CONSOLE_TOKEN || "";
  const port = cfg.bridge.consolePort;
  const sea = new MemorySea({
    dbPath: path.resolve(root, cfg.memory.dbPath),
    config: cfg.memory,
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const html = await readFile(path.join(publicDir, "index.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (url.pathname === "/setup" || url.pathname === "/setup.html") {
        const html = await readFile(path.join(publicDir, "setup.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (url.pathname.startsWith("/api/setup/")) {
        if (!requireToken(req, res, token)) return;

        if (req.method === "GET" && url.pathname === "/api/setup/state") {
          json(res, await handleSetupState(root));
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/setup/validate") {
          const body = await readJson(req);
          json(res, await handleSetupValidate(root, body));
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/setup/apply") {
          const body = await readJson(req);
          json(res, await handleSetupApply(root, body));
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/setup/bootstrap") {
          const body = await readJson(req);
          const steps = Array.isArray(body.steps) ? body.steps.map(String) : undefined;
          handleSetupBootstrap(root, res, steps);
          return;
        }

        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        if (!requireToken(req, res, token)) return;
        const body = await readJson(req);
        if (url.pathname === "/api/recall") {
          const scope = parseScopeKey(String(body.scopeKey ?? "user:demo"));
          const channel = (body.channel as RecallChannel | undefined) ?? "private";
          const evidence = sea.recall(scope, String(body.query ?? ""), {
            limit: 8,
            context: {
              channel,
              groupId: body.groupId != null ? String(body.groupId) : undefined,
              userId: body.userId != null ? String(body.userId) : undefined,
            },
          });
          json(res, { evidence });
          return;
        }
        if (url.pathname === "/api/pending") {
          json(res, { pending: sea.listPending() });
          return;
        }
        if (url.pathname === "/api/graph") {
          json(res, { nodes: sea.listGraph(Number(body.limit ?? 80)) });
          return;
        }
        if (url.pathname === "/api/pin") {
          sea.pin(String(body.id ?? ""), body.pin !== false);
          json(res, { ok: true });
          return;
        }
        if (url.pathname === "/api/visibility") {
          sea.setVisibility(
            String(body.id ?? ""),
            String(body.visibility ?? "private") as MemoryVisibility,
          );
          json(res, { ok: true });
          return;
        }
        if (url.pathname === "/api/maintenance") {
          json(res, sea.runMaintenance());
          return;
        }
        res.writeHead(404);
        res.end("not found");
        return;
      }

      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[console] root=${root}`);
    console.log(`[console] http://127.0.0.1:${port}`);
    console.log(`[console] setup  http://127.0.0.1:${port}/setup`);
  });

  const shutdown = () => {
    server.close();
    sea.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function json(res: http.ServerResponse, data: unknown) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

if (process.env.DSH_MEMORY_SEA_CONSOLE_NO_AUTO !== "1") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

#!/usr/bin/env node
import http from "node:http";
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

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../public");

export const name = "@dsh-memory-sea/console";

export function apply() {
  // Cordis host half: standalone console is preferred for V1.
}

async function loadConfig(root: string) {
  try {
    const raw = JSON.parse(await readFile(path.join(root, "config.json"), "utf8")) as unknown;
    return parseAppConfig(raw);
  } catch {
    return parseAppConfig({});
  }
}

async function main() {
  const root = process.cwd();
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

      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        if (token && req.headers["x-console-token"] !== token) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
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
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[console] http://127.0.0.1:${port}`);
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

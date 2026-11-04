#!/usr/bin/env node
/**
 * Probe likely DeepSeek Harness Desktop local HTTP ports on 127.0.0.1.
 * Desktop often binds an OS-assigned port; update config.json dsh.baseUrl accordingly.
 *
 * Magpie gateway (often :3425) also answers HTTP — we deprioritize known non-DSH ports.
 */
import { execSync } from "node:child_process";

const SKIP_PORTS = new Set([
  3000, 3001, 3100, 3120, // onebot / consoles
  3425, // common Magpie gateway from ~/.dsh/settings.yaml
  8790, 8791, // mind-sea style memory servers
]);

function candidatePortsFromNetstat() {
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
    const ports = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (!m) continue;
      const port = Number(m[1]);
      if (port >= 1024 && !SKIP_PORTS.has(port)) ports.add(port);
    }
    return [...ports].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function probe(port) {
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(new URL("/api/healthz", base), {
      signal: AbortSignal.timeout(800),
    });
    return { base, path: "/api/healthz", status: res.status };
  } catch {
    try {
      const res = await fetch(new URL("/", base), {
        signal: AbortSignal.timeout(800),
      });
      return { base, path: "/", status: res.status };
    } catch {
      return null;
    }
  }
}

/** Prefer authenticated DSH host (401) over open/other services (200/404). */
function rank(hit) {
  if (hit.status === 401) return 0;
  if (hit.status === 200) return 1;
  if (hit.status === 400) return 2;
  return 3;
}

async function main() {
  const ports = candidatePortsFromNetstat();
  if (ports.length === 0) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          hint: "No 127.0.0.1 LISTENING candidates. Is DeepSeek Harness Desktop running?",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const hits = [];
  for (const port of ports) {
    const hit = await probe(port);
    if (hit) hits.push(hit);
  }

  if (hits.length === 0) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          candidates: ports,
          hint: "Ports are listening but none answered HTTP. Reopen Desktop or fix dsh-desktop.port.",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  hits.sort((a, b) => rank(a) - rank(b));
  console.log(
    JSON.stringify(
      {
        ok: true,
        recommendedBaseUrl: hits[0].base,
        note:
          "Prefer status 401 (DSH cookie auth). Ignore Magpie :3425. Confirm in Desktop if unsure.",
        hits,
        tip: "Put recommendedBaseUrl into config.json → dsh.baseUrl, then restart pnpm bridge.",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

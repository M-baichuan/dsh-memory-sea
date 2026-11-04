import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Keep a single bridge process. Stale lock (dead pid) is overwritten.
 */
export function acquireBridgeLock(lockPath: string): { ok: true } | { ok: false; pid: number } {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    try {
      const raw = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
      const pid = Number(raw.pid);
      if (pid && isPidAlive(pid) && pid !== process.pid) {
        return { ok: false, pid };
      }
    } catch {
      // replace corrupt lock
    }
  }
  writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, at: new Date().toISOString() }, null, 2),
    "utf8",
  );
  const release = () => {
    try {
      if (!existsSync(lockPath)) return;
      const raw = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
      if (Number(raw.pid) === process.pid) unlinkSync(lockPath);
    } catch {
      // ignore
    }
  };
  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(0);
  });
  return { ok: true };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

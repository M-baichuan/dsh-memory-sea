/** Drop duplicate OneBot deliveries (same id or same content burst). */
const seen = new Map<string, number>();
const MAX = 500;

export function rememberMessageOnce(
  key: string,
  ttlMs = 60_000,
  now = Date.now(),
): boolean {
  if (!key) return true;
  prune(now);
  const prev = seen.get(key);
  if (prev != null && now - prev < ttlMs) return false;
  seen.set(key, now);
  return true;
}

function prune(now: number): void {
  for (const [k, t] of seen) {
    if (now - t > 120_000) seen.delete(k);
  }
  if (seen.size <= MAX) return;
  const ordered = [...seen.entries()].sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < ordered.length - MAX; i++) {
    seen.delete(ordered[i]![0]);
  }
}

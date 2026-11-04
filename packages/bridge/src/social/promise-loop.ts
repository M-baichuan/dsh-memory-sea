import type { OneBotClient } from "../onebot/client.js";
import { deliverNotice } from "../pipeline/egress.js";
import type { PromiseStore } from "./promises.js";

/** Fire due promises via private notice. */
export function startPromiseLoop(opts: {
  store: PromiseStore;
  client: OneBotClient;
  tickMs?: number;
}): () => void {
  const tickMs = opts.tickMs ?? 20_000;
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const due = opts.store.dueNow();
      for (const item of due) {
        if (stopped) break;
        try {
          await deliverNotice(opts.client, {
            userId: item.userId,
            text: `小约定到点了：${item.text}`,
            chunkLimit: 400,
          });
          // Only mark after successful send — failed delivery stays due for retry.
          opts.store.markFired(item.id);
          console.log(`[bridge] promise fired id=${item.id} user=${item.userId}`);
        } catch (err) {
          console.warn(
            `[bridge] promise fire failed id=${item.id} (will retry):`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, tickMs);
  void tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

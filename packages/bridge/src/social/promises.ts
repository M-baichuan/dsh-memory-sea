import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface PromiseItem {
  id: string;
  userId: string;
  /** Prefer private remind; keep origin for context. */
  groupId?: string;
  text: string;
  dueAt: string;
  createdAt: string;
  firedAt?: string;
}

const LIST_RE = /^(?:看看约定|\/约定|约定列表)\s*$/;
const CANCEL_RE = /^(?:取消约定|删约定)\s*(\d+)?\s*$/;
const ADD_RE = /^(?:小约定|约定|提醒我)\s+(.+)$/s;

export function isPromiseCommand(text: string): boolean {
  const t = text.trim();
  return LIST_RE.test(t) || CANCEL_RE.test(t) || ADD_RE.test(t);
}

export class PromiseStore {
  private items: PromiseItem[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  listActive(userId?: string): PromiseItem[] {
    const now = Date.now();
    return this.items.filter((p) => {
      if (p.firedAt) return false;
      if (userId && p.userId !== userId) return false;
      return true;
    }).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  }

  dueNow(now = Date.now()): PromiseItem[] {
    return this.items.filter(
      (p) => !p.firedAt && Date.parse(p.dueAt) <= now,
    );
  }

  add(item: Omit<PromiseItem, "id" | "createdAt"> & { id?: string }): PromiseItem {
    const row: PromiseItem = {
      id: item.id ?? randomUUID().slice(0, 8),
      userId: item.userId,
      groupId: item.groupId,
      text: item.text,
      dueAt: item.dueAt,
      createdAt: new Date().toISOString(),
    };
    this.items.push(row);
    this.save();
    return row;
  }

  cancel(userId: string, index1Based?: number): PromiseItem | null {
    const active = this.listActive(userId);
    if (!active.length) return null;
    const target =
      index1Based != null && index1Based >= 1
        ? active[index1Based - 1]
        : active[active.length - 1];
    if (!target) return null;
    this.items = this.items.filter((p) => p.id !== target.id);
    this.save();
    return target;
  }

  markFired(id: string): void {
    const row = this.items.find((p) => p.id === id);
    if (!row || row.firedAt) return;
    row.firedAt = new Date().toISOString();
    this.save();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as PromiseItem[];
      this.items = Array.isArray(raw) ? raw.filter((r) => r?.id && r?.userId) : [];
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Keep last 80 rows (incl. fired) for light history.
    const trimmed = this.items.slice(-80);
    this.items = trimmed;
    writeFileSync(this.filePath, JSON.stringify(trimmed, null, 2), "utf8");
  }
}

const WEEKDAY: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

const HM =
  /(\d{1,2})\s*(?:[:：点]\s*(\d{1,2})?)?\s*(?:分)?/;

function atLocalTime(base: Date, hour: number, minute: number): Date {
  const due = new Date(base);
  due.setSeconds(0, 0);
  due.setHours(hour, minute, 0, 0);
  return due;
}

/**
 * Parse due time from Chinese-ish reminder text.
 * Supports: N分钟后 / N小时后 / 今天20:00 / 20:00 / 明天 / 周五（含当日未过点）。
 */
export function parsePromiseDue(
  raw: string,
  now = new Date(),
): { dueAt: Date; text: string } | null {
  const body = raw.trim();
  if (!body) return null;

  const minM = body.match(/^(\d+)\s*分钟后\s*(.+)$/);
  if (minM) {
    const due = new Date(now.getTime() + Number(minM[1]) * 60_000);
    return { dueAt: due, text: minM[2]!.trim() };
  }

  const hourM = body.match(/^(\d+)\s*小时后\s*(.+)$/);
  if (hourM) {
    const due = new Date(now.getTime() + Number(hourM[1]) * 3_600_000);
    return { dueAt: due, text: hourM[2]!.trim() };
  }

  const todayM = body.match(new RegExp(`^今天\\s*${HM.source}\\s*(.+)$`));
  if (todayM) {
    const due = atLocalTime(now, Number(todayM[1]), Number(todayM[2] || 0));
    if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
    return { dueAt: due, text: todayM[3]!.trim() };
  }

  // Bare clock today: 「20:00 交材料」「20点半」不支持半；「20点 交材料」
  const clockM = body.match(new RegExp(`^${HM.source}\\s+(.+)$`));
  if (clockM && !/^(分钟|小时)/.test(body)) {
    const h = Number(clockM[1]);
    if (h >= 0 && h <= 23) {
      const due = atLocalTime(now, h, Number(clockM[2] || 0));
      if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
      return { dueAt: due, text: clockM[3]!.trim() };
    }
  }

  const tomM = body.match(
    new RegExp(`^明天\\s*(?:${HM.source})?\\s*(.+)$`),
  );
  if (tomM) {
    const due = new Date(now);
    due.setDate(due.getDate() + 1);
    const hour = tomM[1] != null ? Number(tomM[1]) : 10;
    const minute = tomM[2] != null ? Number(tomM[2]) : 0;
    return { dueAt: atLocalTime(due, hour, minute), text: tomM[3]!.trim() };
  }

  const weekM = body.match(
    new RegExp(`^周([一二三四五六日天])\\s*(?:${HM.source})?\\s*(.+)$`),
  );
  if (weekM) {
    const target = WEEKDAY[weekM[1]!] ?? 1;
    const hour = weekM[2] != null ? Number(weekM[2]) : 10;
    const minute = weekM[3] != null ? Number(weekM[3]) : 0;
    const due = new Date(now);
    let delta = (target - due.getDay() + 7) % 7;
    // Same weekday: keep today if that clock is still ahead; else next week.
    if (delta === 0) {
      const candidate = atLocalTime(now, hour, minute);
      if (candidate.getTime() > now.getTime()) {
        return { dueAt: candidate, text: weekM[4]!.trim() };
      }
      delta = 7;
    }
    due.setDate(due.getDate() + delta);
    return { dueAt: atLocalTime(due, hour, minute), text: weekM[4]!.trim() };
  }

  // 「约定 交材料」无时间 → 默认 1 小时后
  const due = new Date(now.getTime() + 60 * 60_000);
  return { dueAt: due, text: body };
}

export function handlePromiseCommand(opts: {
  store: PromiseStore;
  userId: string;
  groupId?: string;
  text: string;
}): { handled: true; reply: string } | { handled: false } {
  const text = opts.text.trim();
  if (!isPromiseCommand(text)) return { handled: false };

  if (LIST_RE.test(text)) {
    const rows = opts.store.listActive(opts.userId);
    if (!rows.length) {
      return {
        handled: true,
        reply:
          "现在没有未到期的小约定。\n例：约定 30分钟后 喝水\n约定 明天20:00 交材料\n约定 周五 记得打电话",
      };
    }
    const lines = rows.map((p, i) => {
      const when = formatLocal(p.dueAt);
      return `${i + 1}. ${when} · ${p.text}`;
    });
    return {
      handled: true,
      reply: `你的小约定：\n${lines.join("\n")}\n取消：取消约定 / 取消约定 1`,
    };
  }

  const cancel = text.match(CANCEL_RE);
  if (cancel) {
    const idx = cancel[1] ? Number(cancel[1]) : undefined;
    const removed = opts.store.cancel(opts.userId, idx);
    if (!removed) return { handled: true, reply: "没有可取消的约定。" };
    return { handled: true, reply: `已取消：${removed.text}` };
  }

  const add = text.match(ADD_RE);
  if (!add?.[1]) return { handled: false };
  const parsed = parsePromiseDue(add[1]);
  if (!parsed?.text) {
    return { handled: true, reply: "约定内容空了。例：约定 20分钟后 起身活动一下" };
  }
  const row = opts.store.add({
    userId: opts.userId,
    groupId: opts.groupId,
    text: parsed.text.slice(0, 80),
    dueAt: parsed.dueAt.toISOString(),
  });
  const assumed = !/分钟后|小时后|今天|明天|周[一二三四五六日天]|\d{1,2}\s*[:：点]/.test(
    add[1],
  );
  return {
    handled: true,
    reply:
      `记下了。${formatLocal(row.dueAt)} 我会私聊提醒你：${row.text}` +
      (assumed ? "\n（没写时间，先按 1 小时后；可取消重设）" : ""),
  };
}

function formatLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

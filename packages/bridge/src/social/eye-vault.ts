import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface EyeVaultEntryMeta {
  id: string;
  createdAt: string;
  note?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

interface VaultIndex {
  version: 1;
  entries: EyeVaultEntryMeta[];
}

const ALGO = "aes-256-gcm";
const INDEX_NAME = "index.aes";
const SALT_NAME = "salt.bin";
const FRAMES_DIR = "frames";

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function loadOrCreateSalt(vaultDir: string): Buffer {
  ensureDir(vaultDir);
  const saltPath = path.join(vaultDir, SALT_NAME);
  if (existsSync(saltPath)) {
    return readFileSync(saltPath);
  }
  const salt = randomBytes(16);
  writeFileSync(saltPath, salt);
  return salt;
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });
}

/** blob = iv(12) + tag(16) + ciphertext */
function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function open(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < 12 + 16 + 1) throw new Error("密文损坏");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export class EyeVault {
  constructor(
    private readonly vaultDir: string,
    private readonly maxEntries = 30,
  ) {
    ensureDir(this.framesDir());
  }

  private framesDir(): string {
    return path.join(this.vaultDir, FRAMES_DIR);
  }

  private keyFor(secret: string): Buffer {
    const salt = loadOrCreateSalt(this.vaultDir);
    return deriveKey(secret, salt);
  }

  private readIndex(key: Buffer): VaultIndex {
    const indexPath = path.join(this.vaultDir, INDEX_NAME);
    if (!existsSync(indexPath)) {
      return { version: 1, entries: [] };
    }
    try {
      const plain = open(key, readFileSync(indexPath));
      const raw = JSON.parse(plain.toString("utf8")) as VaultIndex;
      if (!raw || raw.version !== 1 || !Array.isArray(raw.entries)) {
        return { version: 1, entries: [] };
      }
      return raw;
    } catch {
      throw new Error("保险柜口令不对，或索引已损坏");
    }
  }

  private writeIndex(key: Buffer, index: VaultIndex): void {
    ensureDir(this.vaultDir);
    const plain = Buffer.from(JSON.stringify(index), "utf8");
    writeFileSync(path.join(this.vaultDir, INDEX_NAME), seal(key, plain));
  }

  list(secret: string): EyeVaultEntryMeta[] {
    const key = this.keyFor(secret);
    const index = this.readIndex(key);
    return [...index.entries].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  add(
    secret: string,
    opts: {
      jpeg: Buffer;
      note?: string;
      width?: number;
      height?: number;
    },
  ): EyeVaultEntryMeta {
    const key = this.keyFor(secret);
    const index = this.readIndex(key);
    const id = randomUUID().slice(0, 8);
    const meta: EyeVaultEntryMeta = {
      id,
      createdAt: new Date().toISOString(),
      note: opts.note?.replace(/\s+/g, " ").trim().slice(0, 48) || undefined,
      width: opts.width,
      height: opts.height,
      bytes: opts.jpeg.length,
    };

    ensureDir(this.framesDir());
    writeFileSync(path.join(this.framesDir(), `${id}.aes`), seal(key, opts.jpeg));

    index.entries.push(meta);
    while (index.entries.length > this.maxEntries) {
      const old = index.entries.shift();
      if (old) this.deleteFrameFile(old.id);
    }
    this.writeIndex(key, index);
    return meta;
  }

  getJpeg(secret: string, idOrIndex: string): { meta: EyeVaultEntryMeta; jpeg: Buffer } {
    const key = this.keyFor(secret);
    const index = this.readIndex(key);
    const meta = resolveEntry(index.entries, idOrIndex);
    if (!meta) throw new Error("没有这张照片");
    const file = path.join(this.framesDir(), `${meta.id}.aes`);
    if (!existsSync(file)) throw new Error("照片文件缺失");
    const jpeg = open(key, readFileSync(file));
    return { meta, jpeg };
  }

  delete(secret: string, idOrIndex: string): EyeVaultEntryMeta {
    const key = this.keyFor(secret);
    const index = this.readIndex(key);
    const meta = resolveEntry(index.entries, idOrIndex);
    if (!meta) throw new Error("没有这张照片");
    index.entries = index.entries.filter((e) => e.id !== meta.id);
    this.writeIndex(key, index);
    this.deleteFrameFile(meta.id);
    return meta;
  }

  clear(secret: string): number {
    const key = this.keyFor(secret);
    const index = this.readIndex(key);
    const n = index.entries.length;
    for (const e of index.entries) this.deleteFrameFile(e.id);
    this.writeIndex(key, { version: 1, entries: [] });
    return n;
  }

  /** Verify secret can open existing vault (or empty vault). */
  unlock(secret: string): boolean {
    try {
      this.readIndex(this.keyFor(secret));
      return true;
    } catch {
      return false;
    }
  }

  private deleteFrameFile(id: string): void {
    const file = path.join(this.framesDir(), `${id}.aes`);
    if (existsSync(file)) {
      try {
        rmSync(file);
      } catch {
        /* ignore */
      }
    }
  }
}

function resolveEntry(
  entries: EyeVaultEntryMeta[],
  idOrIndex: string,
): EyeVaultEntryMeta | undefined {
  const key = String(idOrIndex ?? "").trim();
  if (!key) return undefined;
  const sorted = [...entries].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
  if (/^\d+$/.test(key)) {
    const i = Number(key) - 1;
    return sorted[i];
  }
  return sorted.find((e) => e.id === key || e.id.startsWith(key));
}

export function formatVaultList(entries: EyeVaultEntryMeta[]): string {
  if (!entries.length) {
    return "保险柜是空的。下次「看看外面 口令」成功后会自动锁进这里。";
  }
  const lines = entries.map((e, i) => {
    const when = e.createdAt.replace("T", " ").slice(0, 16);
    const note = e.note ? ` · ${e.note}` : "";
    return `${i + 1}. ${e.id}  ${when}${note}`;
  });
  return (
    `眼睛保险柜（加密，仅你可见）共 ${entries.length} 张：\n` +
    `${lines.join("\n")}\n` +
    `再看一眼 1 口令\n` +
    `删除眼睛 1 口令\n` +
    `清空眼睛相册 口令`
  );
}

/** Exported for tests — constant-time-ish compare helper. */
export function eyeSecretsMatch(a: string, b: string): boolean {
  return secretsEqual(a, b);
}

export function listOrphanFrameFiles(vaultDir: string): string[] {
  const dir = path.join(vaultDir, FRAMES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".aes"));
}

import { MemorySea } from "../engine.js";
import type { MemoryConfig } from "@dsh-memory-sea/shared";

export interface NightlyOptions {
  dbPath: string;
  config?: Partial<MemoryConfig>;
}

export function runNightlyMaintenance(options: NightlyOptions) {
  const sea = new MemorySea({
    dbPath: options.dbPath,
    config: options.config,
  });
  try {
    return sea.runMaintenance();
  } finally {
    sea.close();
  }
}

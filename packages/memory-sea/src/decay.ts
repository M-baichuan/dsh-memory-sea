import type { CategoryConfig, MemoryConfig } from "@dsh-memory-sea/shared";

export interface StrengthInput {
  importance: number;
  recallCount: number;
  activeDays: number;
  baseLambda: number;
}

/**
 * Ebbinghaus-style strength.
 *
 * λ_eff   = base_λ × (1 − importance × 0.8)
 * strength = clamp(importance × e^(−λ_eff × active_days) × (1 + recall_count × 0.2), 0, 1)
 */
export function computeStrength(input: StrengthInput): number {
  const importance = clamp(input.importance, 0, 1);
  const lambdaEff = input.baseLambda * (1 - importance * 0.8);
  const raw =
    importance *
    Math.exp(-lambdaEff * Math.max(0, input.activeDays)) *
    (1 + Math.max(0, input.recallCount) * 0.2);
  return clamp(raw, 0, 1);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, (to - from) / (1000 * 60 * 60 * 24));
}

export function resolveCategoryConfig(
  memoryConfig: MemoryConfig,
  category: string,
): CategoryConfig {
  const found = memoryConfig.categories[category];
  if (found) return found;
  return memoryConfig.categories.fact ?? {
    baseLambda: 0.018,
    defaultImportance: 0.7,
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

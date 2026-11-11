import { isHardDomainPrompt } from "@/lib/goals";
import { resolveModel } from "@/lib/models";

export { isHardDomainPrompt } from "@/lib/goals";

/**
 * Base credits per turn — prefer NEXT_PUBLIC_ so Studio (client) and API agree.
 * Falls back to CREDITS_PER_JOB then 5.
 */
export const CREDITS_PER_JOB_PRICED = Number(
  process.env.NEXT_PUBLIC_CREDITS_PER_JOB ??
    process.env.CREDITS_PER_JOB ??
    5,
);

/** Extra credits when the prompt looks like a hard niche domain (e.g. ChiaLisp). */
export const CREDITS_HARD_DOMAIN = Number(
  process.env.NEXT_PUBLIC_CREDITS_HARD_DOMAIN ??
    process.env.CREDITS_HARD_DOMAIN ??
    10,
);

/**
 * Larger models cost a multiple of the base job price.
 * 32B occupies the 24GB GPU (5× = 25 credits).
 * Grok is a paid API with a finite balance (8× = 40 credits).
 */
export function modelCreditMultiplier(resolvedOllamaTag: string): number {
  const tag = String(resolvedOllamaTag || "").toLowerCase();
  if (tag === "grok" || tag.startsWith("grok-")) return 8;
  if (/\b(32b|70b|72b)\b/.test(tag)) return 5;
  if (/\b14b\b/.test(tag)) return 2;
  return 1;
}

export type JobPriceBreakdown = {
  base: number;
  modelMultiplier: number;
  modelCredits: number;
  hardDomain: boolean;
  hardDomainCredits: number;
  total: number;
  lines: string[];
};

/**
 * Sticker price charged up front at enqueue.
 * total = base * modelMultiplier + (hardDomain ? CREDITS_HARD_DOMAIN : 0)
 */
export function priceJob(input: {
  prompt: string;
  modelId?: string | null;
}): JobPriceBreakdown {
  const resolved = resolveModel(input.modelId, input.prompt);
  const base = CREDITS_PER_JOB_PRICED;
  const modelMultiplier = modelCreditMultiplier(resolved.resolved);
  const modelCredits = base * modelMultiplier;
  const hardDomain = isHardDomainPrompt(input.prompt);
  const hardDomainCredits = hardDomain ? CREDITS_HARD_DOMAIN : 0;
  const total = modelCredits + hardDomainCredits;

  const lines = [
    `Base ${base} cr`,
    modelMultiplier > 1
      ? `Model ${resolved.resolved} ×${modelMultiplier} → ${modelCredits} cr`
      : `Model ${resolved.resolved}`,
  ];
  if (hardDomain) {
    lines.push(`Hard task +${hardDomainCredits} cr`);
  }
  lines.push(`Total ${total} cr`);

  return {
    base,
    modelMultiplier,
    modelCredits,
    hardDomain,
    hardDomainCredits,
    total,
    lines,
  };
}

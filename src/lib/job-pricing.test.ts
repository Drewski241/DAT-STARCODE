import assert from "node:assert/strict";
import { CREDITS_PER_JOB } from "@/lib/config";
import {
  CREDITS_HARD_DOMAIN,
  isHardDomainPrompt,
  modelCreditMultiplier,
  priceJob,
} from "@/lib/job-pricing";

assert.equal(isHardDomainPrompt("fix a typo"), false);
assert.equal(isHardDomainPrompt("write puzzles/mtt_pool.clsp"), true);

assert.equal(modelCreditMultiplier("qwen2.5-coder:7b"), 1);
assert.equal(modelCreditMultiplier("qwen2.5-coder:14b"), 2);

const cheap = priceJob({
  prompt: "Add a README section",
  modelId: "qwen2.5-coder:7b",
});
assert.equal(cheap.total, CREDITS_PER_JOB);
assert.equal(cheap.hardDomain, false);

const fourteen = priceJob({
  prompt: "Add a README section",
  modelId: "qwen2.5-coder:14b",
});
assert.equal(fourteen.total, CREDITS_PER_JOB * 2);

const hard = priceJob({
  prompt: "Write puzzles/mtt_pool.clsp for ChiaLisp",
  modelId: "qwen2.5-coder:14b",
});
assert.equal(hard.total, CREDITS_PER_JOB * 2 + CREDITS_HARD_DOMAIN);
assert.equal(hard.hardDomain, true);

console.log("job-pricing.test.ts ok");

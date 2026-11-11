import assert from "node:assert/strict";
import {
  CREDITS_HARD_DOMAIN,
  CREDITS_PER_JOB_PRICED,
  isHardDomainPrompt,
  modelCreditMultiplier,
  priceJob,
} from "../src/lib/job-pricing";

assert.equal(isHardDomainPrompt("fix a typo"), false);
assert.equal(isHardDomainPrompt("write puzzles/mtt_pool.clsp"), true);
assert.equal(isHardDomainPrompt("Write a small Rust CLI"), true);
assert.equal(isHardDomainPrompt("Write hello.rue in Rue"), true);
assert.equal(isHardDomainPrompt("I trust this code"), false);

assert.equal(modelCreditMultiplier("qwen2.5-coder:7b"), 1);
assert.equal(modelCreditMultiplier("qwen2.5-coder:14b"), 2);
assert.equal(modelCreditMultiplier("qwen2.5-coder:32b"), 5);
assert.equal(modelCreditMultiplier("qwen2.5-coder:70b"), 5);
assert.equal(modelCreditMultiplier("grok"), 8);
assert.equal(modelCreditMultiplier("grok-4.7"), 8);

const cheap = priceJob({
  prompt: "Add a README section",
  modelId: "qwen2.5-coder:7b",
});
assert.equal(cheap.total, CREDITS_PER_JOB_PRICED);
assert.equal(cheap.hardDomain, false);

const fourteen = priceJob({
  prompt: "Add a README section",
  modelId: "qwen2.5-coder:14b",
});
assert.equal(fourteen.total, CREDITS_PER_JOB_PRICED * 2);

const thirtyTwo = priceJob({
  prompt: "Add a README section",
  modelId: "qwen2.5-coder:32b",
});
assert.equal(thirtyTwo.total, CREDITS_PER_JOB_PRICED * 5);

const grok = priceJob({
  prompt: "Add a README section",
  modelId: "grok-4.7",
});
assert.equal(grok.total, CREDITS_PER_JOB_PRICED * 8);
assert.equal(grok.hardDomain, false);

const hard = priceJob({
  prompt: "Write puzzles/mtt_pool.clsp for ChiaLisp",
  modelId: "qwen2.5-coder:14b",
});
assert.equal(hard.total, CREDITS_PER_JOB_PRICED * 2 + CREDITS_HARD_DOMAIN);
assert.equal(hard.hardDomain, true);

const rustPrice = priceJob({
  prompt: "Write a small Rust CLI",
  modelId: "qwen2.5-coder:32b",
});
assert.equal(rustPrice.hardDomain, true);
assert.equal(
  rustPrice.total,
  CREDITS_PER_JOB_PRICED * 5 + CREDITS_HARD_DOMAIN,
);

const grokHard = priceJob({
  prompt: "Write puzzles/mtt_pool.clsp for ChiaLisp",
  modelId: "grok-4.7",
});
assert.equal(grokHard.hardDomain, true);
assert.equal(
  grokHard.total,
  CREDITS_PER_JOB_PRICED * 8 + CREDITS_HARD_DOMAIN,
);

const autoGrok = priceJob({
  prompt: "Security audit this login function for a vulnerability",
  modelId: "auto",
});
assert.equal(autoGrok.hardDomain, false);
assert.equal(autoGrok.total, CREDITS_PER_JOB_PRICED * 8);

const autoGrokFix = priceJob({
  prompt: "Fix this race condition in the login service. Stack trace follows.",
  modelId: "auto",
});
assert.equal(autoGrokFix.hardDomain, true);
assert.equal(
  autoGrokFix.total,
  CREDITS_PER_JOB_PRICED * 8 + CREDITS_HARD_DOMAIN,
);

console.log("job-pricing.test.ts ok");

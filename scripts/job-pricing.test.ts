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
assert.equal(modelCreditMultiplier("qwen2.5-coder:32b"), 3);

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
assert.equal(thirtyTwo.total, CREDITS_PER_JOB_PRICED * 3);

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
  CREDITS_PER_JOB_PRICED * 3 + CREDITS_HARD_DOMAIN,
);

console.log("job-pricing.test.ts ok");

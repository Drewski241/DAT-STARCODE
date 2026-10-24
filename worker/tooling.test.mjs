import assert from "node:assert/strict";
import {
  chialispToolingRequired,
  toolingFailureLines,
} from "./tooling.mjs";

const prev = process.env.REQUIRE_CHIALISP_TOOLING;
try {
  delete process.env.REQUIRE_CHIALISP_TOOLING;
  assert.equal(chialispToolingRequired(), true);

  process.env.REQUIRE_CHIALISP_TOOLING = "0";
  assert.equal(chialispToolingRequired(), false);

  process.env.REQUIRE_CHIALISP_TOOLING = "false";
  assert.equal(chialispToolingRequired(), false);

  process.env.REQUIRE_CHIALISP_TOOLING = "1";
  assert.equal(chialispToolingRequired(), true);

  const lines = toolingFailureLines({
    required: true,
    cdv: false,
    clvmTools: true,
    ok: false,
    missing: ["cdv"],
    installHints: ["Install chia-dev-tools"],
  });
  assert.ok(lines.some((l) => /missing/i.test(l)));
  assert.ok(lines.some((l) => /chia-dev-tools/i.test(l)));
} finally {
  if (prev === undefined) delete process.env.REQUIRE_CHIALISP_TOOLING;
  else process.env.REQUIRE_CHIALISP_TOOLING = prev;
}

console.log("tooling.test.mjs ok");

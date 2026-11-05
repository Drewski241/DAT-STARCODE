import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { checkPlayablePage, judgePlayProbe } from "./play-check.mjs";
import { loadPlaywright } from "./screenshot.mjs";

assert.deepEqual(
  judgePlayProbe({
    clicked: true,
    before: "Player 1: 0 Player 2: 0",
    after: "Player 1: 26 Player 2: 26 winner",
  }).ok,
  true,
);
assert.match(
  judgePlayProbe({
    clicked: true,
    before: "Player 1: 0",
    after: "Player 1: 0",
  }).reason,
  /did nothing/i,
);
assert.match(
  judgePlayProbe({ clicked: false, before: "idle", after: "idle" }).reason,
  /No Start/i,
);
assert.equal(
  judgePlayProbe({ skipped: true, reason: "Playwright not installed" }).ok,
  true,
);

const pw = await loadPlaywright();
if (pw) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-play-"));
  await fs.writeFile(
    path.join(root, "index.html"),
    `<!DOCTYPE html><body>
      <button id="startGame">Start Game</button>
      <div id="out">Player 1: 0</div>
      <script>
        document.getElementById("startGame").onclick = () => {
          document.getElementById("out").textContent = "Player 1: 26 winner";
        };
      </script>
    </body>`,
    "utf8",
  );
  const live = await checkPlayablePage(root);
  if (!live.ok && /Executable doesn't exist|playwright install|browser/i.test(live.reason || "")) {
    console.log("play-check.test.mjs ok (judge only, browser missing)");
    await fs.rm(root, { recursive: true, force: true });
    process.exit(0);
  }
  assert.equal(live.ok, true, live.reason);
  await fs.writeFile(
    path.join(root, "index.html"),
    `<!DOCTYPE html><body>
      <button id="startGame">Start Game</button>
      <div id="out">Player 1: 0</div>
      <script>function playGame(){ }</script>
    </body>`,
    "utf8",
  );
  const dead = await checkPlayablePage(root);
  assert.equal(dead.ok, false, dead.reason);
  assert.match(dead.reason, /did nothing/i);
  await fs.rm(root, { recursive: true, force: true });
  console.log("play-check.test.mjs ok (playwright)");
} else {
  console.log("play-check.test.mjs ok (judge only)");
}

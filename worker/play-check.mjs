/**
 * Click Start / Play on a workspace page and require the board to change.
 */
import { promises as fs } from "fs";
import path from "path";
import { loadPlaywright } from "./screenshot.mjs";

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {{ clicked?: boolean, before?: string, after?: string, skipped?: boolean, reason?: string }} probe
 */
export function judgePlayProbe(probe) {
  if (probe?.skipped) {
    return { ok: true, skipped: true, reason: probe.reason || "skipped" };
  }
  if (!probe?.clicked) {
    return { ok: false, reason: "No Start, Play, or Deal button to click" };
  }
  const before = normalize(probe.before);
  const after = normalize(probe.after);
  if (!after || before === after) {
    return { ok: false, reason: "Click did nothing" };
  }
  const numbersBefore = (before.match(/\d+/g) || []).join(",");
  const numbersAfter = (after.match(/\d+/g) || []).join(",");
  const shows =
    /winner|you win|\bwins\b|dealt|\bcard\b|♥|♦|♣|♠|hearts|diamonds|clubs|spades/i.test(
      after,
    );
  if (numbersBefore !== numbersAfter || shows) {
    return {
      ok: true,
      reason: "Click changed the page and showed a card, score, or winner",
    };
  }
  return {
    ok: false,
    reason:
      "Click changed the page but did not show a card, score, or winner",
  };
}

/**
 * @param {string} root
 */
export async function findPlayableHtml(root) {
  for (const rel of ["index.html", "src/index.html"]) {
    try {
      await fs.access(path.join(root, rel));
      return rel;
    } catch {
      /* try the next path */
    }
  }
  return null;
}

/**
 * @param {string} root
 */
export async function checkPlayablePage(root) {
  const rel = await findPlayableHtml(root);
  if (!rel) return { ok: false, reason: "No index.html to play" };
  const pw = await loadPlaywright();
  if (!pw) {
    return {
      ok: true,
      skipped: true,
      reason: "Playwright not installed on the worker",
    };
  }

  const full = path.resolve(root, rel);
  let browser;
  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.goto(`file://${full}`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    const before = await page.locator("body").innerText();
    const buttons = page.getByRole("button", { name: /start|play|deal/i });
    if ((await buttons.count()) === 0) {
      return judgePlayProbe({ clicked: false, before, after: before });
    }
    await buttons.first().click({ timeout: 3_000 });
    await page.waitForTimeout(700);
    const after = await page.locator("body").innerText();
    return {
      ...judgePlayProbe({ clicked: true, before, after }),
      rel,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

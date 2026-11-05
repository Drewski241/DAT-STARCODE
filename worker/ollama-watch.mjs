/**
 * Deadlines and idle-GPU detection for one Ollama chat call.
 */
import { execFile } from "child_process";

/**
 * @param {string} model
 */
export function chatWatchLimits(model) {
  const name = String(model || "");
  if (/(70b|72b)/i.test(name)) {
    return { stallMs: 180_000, deadlineMs: 12 * 60_000, heartbeatMs: 30_000 };
  }
  if (/32b/i.test(name)) {
    return { stallMs: 150_000, deadlineMs: 8 * 60_000, heartbeatMs: 30_000 };
  }
  if (/14b/i.test(name)) {
    return { stallMs: 120_000, deadlineMs: 6 * 60_000, heartbeatMs: 30_000 };
  }
  return { stallMs: 90_000, deadlineMs: 4 * 60_000, heartbeatMs: 30_000 };
}

/**
 * nvidia-smi CSV: "util, watts". Unknown readings are not treated as idle.
 * @param {string} text
 */
export function parseGpuSample(text) {
  const line = String(text || "").trim().split("\n")[0] || "";
  const parts = line.split(",").map((part) => part.trim());
  if (parts.length < 2) return null;
  const util = Number(parts[0]);
  if (!Number.isFinite(util)) return null;
  if (/n\/a|not supported/i.test(parts[1])) {
    return { util, watts: null, idle: false };
  }
  const watts = Number(String(parts[1]).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(watts)) return null;
  return { util, watts, idle: util < 15 && watts < 80 };
}

/**
 * @param {number} lastByteAt
 * @param {number} now
 * @param {{ stallMs: number, deadlineMs: number, heartbeatMs: number }} limits
 * @param {number} startedAt
 * @param {number} lastBeatAt
 */
export function watchDecision(startedAt, lastByteAt, lastBeatAt, now, limits) {
  if (now - startedAt >= limits.deadlineMs) {
    return { abort: `Ollama chat exceeded ${Math.round(limits.deadlineMs / 1000)}s` };
  }
  if (now - lastByteAt >= limits.stallMs) {
    return {
      abort: `Ollama chat stalled for ${Math.round(limits.stallMs / 1000)}s with no tokens`,
    };
  }
  const heartbeat = now - lastBeatAt >= limits.heartbeatMs;
  const gpuCheck = heartbeat && now - lastByteAt >= 45_000;
  return { abort: null, heartbeat, gpuCheck };
}

/** True when the card is idle, false when it is busy, null when unknown. */
export function sampleGpuIdle() {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      [
        "--query-gpu=utilization.gpu,power.draw",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 2500 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const sample = parseGpuSample(stdout);
        resolve(sample ? sample.idle : null);
      },
    );
  });
}

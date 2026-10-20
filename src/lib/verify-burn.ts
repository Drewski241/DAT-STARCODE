import { createHash } from "crypto";
import { DAT_BURN_ADDRESS } from "@/lib/config";
import { datToMojos } from "@/lib/dat-units";
import {
  DAT_BURN_CAT_PUZZLE_HASH,
  coinAmountNumber,
  getCoinRecordByName,
  getCoinRecordsByPuzzleHash,
  getPeakHeight,
  getPuzzleAndSolution,
  type CoinRecord,
} from "@/lib/chia-coinset";
import type { PaymentIntent } from "@/lib/types";

export type BurnVerification = {
  ok: true;
  coinId: string;
  amountMojos: string;
  height: number;
  timestamp: number;
  memoMatched: boolean;
  explorerUrl: string;
};

export type BurnVerificationPending = {
  ok: false;
  pending: true;
  message: string;
};

function utf8ToHex(value: string): string {
  return Array.from(new TextEncoder().encode(value))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeHex(value: string): string {
  const h = value.toLowerCase().replace(/^0x/, "");
  return h;
}

/** CLVM-style int bytes used in Chia coin_id (not fixed-width u64). */
function clvmIntToHex(value: bigint): string {
  if (value === BigInt(0)) return "00";
  const bitLen = value.toString(2).length;
  let byteCount = Math.floor((bitLen + 8) / 8);
  let buf = Buffer.alloc(byteCount);
  let x = value;
  const mask = BigInt(255);
  const eight = BigInt(8);
  for (let i = byteCount - 1; i >= 0; i--) {
    buf[i] = Number(x & mask);
    x = x >> eight;
  }
  if (buf[0] & 0x80) {
    buf = Buffer.concat([Buffer.from([0]), buf]);
  }
  return buf.toString("hex");
}

/** Deterministic coin id from parent + puzzle hash + amount (Chia coin_id). */
export function computeCoinId(coin: CoinRecord["coin"]): string {
  const parent = normalizeHex(coin.parent_coin_info).padStart(64, "0");
  const ph = normalizeHex(coin.puzzle_hash).padStart(64, "0");
  const amountHex = clvmIntToHex(BigInt(coinAmountNumber(coin.amount)));
  const id = createHash("sha256")
    .update(Buffer.from(parent + ph + amountHex, "hex"))
    .digest("hex");
  return `0x${id}`;
}

function createdAtToMinHeight(createdAt: string, peak: number): number {
  const createdMs = Date.parse(createdAt);
  const ageSec = Number.isFinite(createdMs)
    ? Math.max(0, (Date.now() - createdMs) / 1000)
    : 3600;
  // ~18s blocks; look back with generous slack for retries / slow inclusion.
  const blocks = Math.ceil(ageSec / 18) + 200;
  return Math.max(0, peak - Math.min(blocks, 5000));
}

async function memoInParentSpend(
  coin: CoinRecord["coin"],
  memo: string,
  confirmedHeight: number,
): Promise<boolean> {
  const parent = coin.parent_coin_info;
  const parentRec = await getCoinRecordByName(parent);
  const height = parentRec?.spent_block_index || confirmedHeight;
  const puzSol = await getPuzzleAndSolution({ coinId: parent, height });
  if (!puzSol) return false;
  const blob = `${puzSol.puzzle_reveal ?? ""}${puzSol.solution ?? ""}`.toLowerCase();
  const memoHex = utf8ToHex(memo).toLowerCase();
  return blob.includes(memoHex) || blob.includes(Buffer.from(memo, "utf8").toString("hex"));
}

/**
 * Verify a DAT payment burned on-chain to the official burn address.
 * Matches CAT puzzle hash + amount, and prefers memo match in the parent spend.
 */
export async function verifyDatBurnOnChain(
  payment: PaymentIntent,
  opts?: { usedCoinIds?: Set<string> },
): Promise<BurnVerification | BurnVerificationPending> {
  const expectedMojos = Number(datToMojos(payment.datAmount));
  const peak = await getPeakHeight();
  const startHeight = createdAtToMinHeight(payment.createdAt, peak);

  const records = await getCoinRecordsByPuzzleHash({
    puzzleHash: DAT_BURN_CAT_PUZZLE_HASH,
    startHeight,
    includeSpent: false,
  });

  const candidates = records.filter(
    (r) => coinAmountNumber(r.coin.amount) === expectedMojos,
  );

  if (candidates.length === 0) {
    return {
      ok: false,
      pending: true,
      message:
        "Burn not visible on-chain yet. Wait for the next blocks and retry confirm.",
    };
  }

  // Prefer coins whose parent spend carries our payment memo.
  const ranked: { rec: CoinRecord; coinId: string; memoMatched: boolean }[] =
    [];
  for (const rec of candidates) {
    const coinId = computeCoinId(rec.coin);
    if (
      opts?.usedCoinIds?.has(coinId) ||
      opts?.usedCoinIds?.has(coinId.slice(2))
    ) {
      continue;
    }
    let memoMatched = false;
    try {
      memoMatched = await memoInParentSpend(
        rec.coin,
        payment.memo,
        rec.confirmed_block_index,
      );
    } catch {
      memoMatched = false;
    }
    ranked.push({ rec, coinId, memoMatched });
  }

  if (ranked.length === 0) {
    return {
      ok: false,
      pending: true,
      message:
        "Matching burn coin already used or still confirming. Retry shortly.",
    };
  }

  ranked.sort((a, b) => {
    if (a.memoMatched !== b.memoMatched) return a.memoMatched ? -1 : 1;
    return b.rec.confirmed_block_index - a.rec.confirmed_block_index;
  });

  const best = ranked[0]!;
  // Require memo match when we can read parent spends; if none matched but
  // there is exactly one unused candidate for this amount in-window, accept it.
  if (!best.memoMatched && ranked.filter((r) => !r.memoMatched).length > 1) {
    return {
      ok: false,
      pending: true,
      message:
        "Found DAT burns for this amount but none matched this payment memo yet. Retry shortly.",
    };
  }

  return {
    ok: true,
    coinId: best.coinId,
    amountMojos: String(expectedMojos),
    height: best.rec.confirmed_block_index,
    timestamp: best.rec.timestamp,
    memoMatched: best.memoMatched,
    explorerUrl: `https://www.spacescan.io/coin/${best.coinId}`,
  };
}

export function burnAddressForDisplay() {
  return DAT_BURN_ADDRESS;
}

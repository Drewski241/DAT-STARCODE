/**
 * Lightweight client for a Chia full-node HTTP API (coinset.org compatible).
 */

export const COINSET_API_BASE = (
  process.env.CHIA_FULLNODE_API ?? "https://api.coinset.org"
).replace(/\/$/, "");

/**
 * CAT2 outer puzzle hash for DAT sent to the official burn address
 * (inner puzzle hash 0x00…dead). Derived from on-chain DAT burns.
 */
export const DAT_BURN_CAT_PUZZLE_HASH =
  process.env.DAT_BURN_CAT_PUZZLE_HASH ??
  "0x8ba73a509c23617d825adef4144e57ac6fc63144c2c531788ae09d8b71d16f5b";

export const BURN_INNER_PUZZLE_HASH =
  "0x000000000000000000000000000000000000000000000000000000000000dead";

export type CoinRecord = {
  coin: {
    parent_coin_info: string;
    puzzle_hash: string;
    amount: number | string;
  };
  coinbase: boolean;
  confirmed_block_index: number;
  spent: boolean;
  spent_block_index: number;
  timestamp: number;
};

async function coinsetPost<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${COINSET_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Coinset ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function getPeakHeight(): Promise<number> {
  const data = await coinsetPost<{
    blockchain_state: { peak: { height: number } };
  }>("/get_blockchain_state", {});
  return data.blockchain_state.peak.height;
}

export async function getCoinRecordsByPuzzleHash(input: {
  puzzleHash: string;
  startHeight?: number;
  includeSpent?: boolean;
}): Promise<CoinRecord[]> {
  const data = await coinsetPost<{ coin_records: CoinRecord[] }>(
    "/get_coin_records_by_puzzle_hash",
    {
      puzzle_hash: input.puzzleHash,
      include_spent_coins: input.includeSpent ?? false,
      start_height: input.startHeight ?? 0,
    },
  );
  return data.coin_records ?? [];
}

export async function getCoinRecordByName(
  name: string,
): Promise<CoinRecord | null> {
  const data = await coinsetPost<{ coin_record?: CoinRecord | null }>(
    "/get_coin_record_by_name",
    { name },
  );
  return data.coin_record ?? null;
}

export async function getPuzzleAndSolution(input: {
  coinId: string;
  height: number;
}): Promise<{ puzzle_reveal?: string; solution?: string } | null> {
  const data = await coinsetPost<{
    coin_solution?: {
      puzzle_reveal?: string;
      solution?: string;
    } | null;
  }>("/get_puzzle_and_solution", {
    coin_id: input.coinId,
    height: input.height,
  });
  return data.coin_solution ?? null;
}

/** SHA256 tree hash style coin id is not needed — coinset accepts parent+ph+amount via name lookup of parent. */
export function coinAmountNumber(amount: number | string): number {
  return typeof amount === "number" ? amount : Number(amount);
}

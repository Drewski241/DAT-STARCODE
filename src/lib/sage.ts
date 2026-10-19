import {
  APP_NAME,
  DAT_ASSET_ID,
  DAT_BURN_ADDRESS,
  DAT_SYMBOL,
  WALLETCONNECT_PROJECT_ID,
} from "@/lib/config";

/**
 * Sage connects to dApps over WalletConnect (and Chia WC methods).
 * Full spend-bundle signing needs a WC project id + CAT coin selection.
 * This module exposes the connect metadata and a client-side demo path
 * so the product works before mainnet settlement is wired.
 */

export type SageConnectionMode = "demo" | "walletconnect";

export function getSageConfig() {
  const mode: SageConnectionMode = WALLETCONNECT_PROJECT_ID
    ? "walletconnect"
    : "demo";
  return {
    mode,
    projectId: WALLETCONNECT_PROJECT_ID || null,
    chain: "chia:mainnet",
    datAssetId: DAT_ASSET_ID,
    datSymbol: DAT_SYMBOL,
    burnAddress: DAT_BURN_ADDRESS,
    metadata: {
      name: APP_NAME,
      description: "Coding agent paid with DAT via Sage — DAT is burned",
      url:
        typeof window !== "undefined"
          ? window.location.origin
          : "https://dat-starcoder.local",
      icons: [] as string[],
    },
  };
}

/** Truncate a Chia address for UI. */
export function shortAddress(address: string) {
  if (address.length < 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

/**
 * Build the WalletConnect session proposal namespaces for Sage.
 * Kept as pure data so we can plug @walletconnect/sign-client later
 * without rewriting the payment UI.
 */
export function sageRequiredNamespaces() {
  return {
    chia: {
      methods: [
        "chia_getAddress",
        "chia_getPublicKeys",
        "chia_signMessageByAddress",
        "chia_sendTransaction",
        "chia_getAssetCoins",
        "chia_signCoinSpends",
      ],
      chains: ["chia:mainnet"],
      events: [],
    },
  };
}

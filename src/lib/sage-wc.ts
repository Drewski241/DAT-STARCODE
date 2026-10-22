"use client";

import SignClient from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";
import {
  APP_NAME,
  DAT_ASSET_ID,
  DAT_BURN_ADDRESS,
  WALLETCONNECT_PROJECT_ID,
} from "@/lib/config";
import { DEFAULT_XCH_FEE_MOJOS, datToMojos } from "@/lib/dat-units";
import { sageOptionalNamespaces, sageRequiredNamespaces } from "@/lib/sage";

const CHAIN = "chia:mainnet";
const SESSION_KEY = "dat-starcoder-wc-session";
const INIT_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 25_000;

let clientPromise: Promise<InstanceType<typeof SignClient>> | null = null;
let activeSession: SessionTypes.Struct | null = null;

function requireProjectId() {
  const id = WALLETCONNECT_PROJECT_ID?.trim();
  if (!id) {
    throw new Error(
      "Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in Amplify (from cloud.walletconnect.com), redeploy, then Connect Sage again.",
    );
  }
  return id;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(ms / 1000)}s. Check your network, disable VPN blockers for wss://relay.walletconnect.com, confirm the WalletConnect project id, then try again.`,
        ),
      );
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Drop cached client so the next connect gets a fresh relay socket. */
export async function resetSageWalletConnect() {
  activeSession = null;
  clientPromise = null;
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(SESSION_KEY);
  }
}

async function getClient() {
  if (!clientPromise) {
    const projectId = requireProjectId();
    clientPromise = withTimeout(
      SignClient.init({
        projectId,
        // Explicit relay — some environments fail open-ended discovery.
        relayUrl: "wss://relay.walletconnect.com",
        metadata: {
          name: APP_NAME,
          description:
            "Burn DAT for coding credits — permanently out of circulation",
          url:
            typeof window !== "undefined"
              ? window.location.origin
              : "https://datstarcoder.com",
          icons: ["https://datstarcoder.com/favicon.ico"],
        },
      }),
      INIT_TIMEOUT_MS,
      "WalletConnect relay connect",
    ).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

function topicFromSession(session: SessionTypes.Struct) {
  return session.topic;
}

function saveSession(session: SessionTypes.Struct | null) {
  activeSession = session;
  if (typeof window === "undefined") return;
  if (session) {
    window.sessionStorage.setItem(SESSION_KEY, session.topic);
  } else {
    window.sessionStorage.removeItem(SESSION_KEY);
  }
}

export async function restoreSageSession(): Promise<SessionTypes.Struct | null> {
  if (typeof window === "undefined") return null;
  if (!WALLETCONNECT_PROJECT_ID?.trim()) return null;
  try {
    const client = await getClient();
    const topic = window.sessionStorage.getItem(SESSION_KEY);
    const sessions = client.session.getAll();
    const found =
      (topic ? sessions.find((s) => s.topic === topic) : undefined) ??
      sessions[sessions.length - 1] ??
      null;
    saveSession(found);
    return found;
  } catch {
    return null;
  }
}

export type SageConnectResult = {
  uri: string;
  approval: Promise<{ address: string; session: SessionTypes.Struct }>;
};

/** Start WalletConnect pairing — show `uri` as a QR for Sage to scan. */
export async function connectSageWallet(): Promise<SageConnectResult> {
  // Always start clean — a half-open relay from a prior attempt hangs forever.
  await resetSageWalletConnect();

  let client: InstanceType<typeof SignClient>;
  try {
    client = await getClient();
  } catch (err) {
    await resetSageWalletConnect();
    throw err;
  }

  let uri: string | undefined;
  let approval: () => Promise<SessionTypes.Struct>;
  try {
    const connected = await withTimeout(
      client.connect({
        requiredNamespaces: sageRequiredNamespaces(),
        optionalNamespaces: sageOptionalNamespaces(),
      }),
      CONNECT_TIMEOUT_MS,
      "WalletConnect pairing",
    );
    uri = connected.uri;
    approval = connected.approval;
  } catch (err) {
    await resetSageWalletConnect();
    throw err;
  }

  if (!uri) {
    await resetSageWalletConnect();
    throw new Error("WalletConnect did not return a pairing URI");
  }

  const approvalPromise = approval().then(async (session) => {
    saveSession(session);
    const address = await requestAddress(session);
    return { address, session };
  });

  return { uri, approval: approvalPromise };
}

export async function disconnectSageWallet() {
  if (!WALLETCONNECT_PROJECT_ID?.trim()) {
    await resetSageWalletConnect();
    return;
  }
  try {
    const client = await getClient();
    const session = activeSession ?? (await restoreSageSession());
    if (session) {
      try {
        await client.disconnect({
          topic: topicFromSession(session),
          reason: { code: 6000, message: "User disconnected" },
        });
      } catch {
        // session may already be gone
      }
    }
  } catch {
    // init / restore failed — still drop local handle
  }
  await resetSageWalletConnect();
}

async function requestAddress(session: SessionTypes.Struct) {
  const client = await getClient();
  const result = (await client.request({
    topic: topicFromSession(session),
    chainId: CHAIN,
    request: {
      method: "chia_getAddress",
      params: {},
    },
  })) as { address?: string } | string;

  const address = typeof result === "string" ? result : result?.address;
  if (!address || typeof address !== "string") {
    throw new Error("Sage did not return a receive address");
  }
  return address;
}

export async function getSageAddress(): Promise<string> {
  const session = activeSession ?? (await restoreSageSession());
  if (!session) throw new Error("Connect Sage first");
  return requestAddress(session);
}

export async function getDatBalanceMojos(): Promise<string> {
  const client = await getClient();
  const session = activeSession ?? (await restoreSageSession());
  if (!session) throw new Error("Connect Sage first");
  const result = (await client.request({
    topic: topicFromSession(session),
    chainId: CHAIN,
    request: {
      method: "chip0002_getAssetBalance",
      params: { type: "cat", assetId: DAT_ASSET_ID },
    },
  })) as { spendable?: string; confirmed?: string };

  return result.spendable ?? result.confirmed ?? "0";
}

export type BurnDatParams = {
  datAmount: number;
  memo: string;
  feeMojos?: number;
};

/** Sage expects memo strings as hex (even-length), not raw UTF-8 text. */
function utf8ToHex(value: string): string {
  return Array.from(new TextEncoder().encode(value))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Ask Sage to send DAT to the official burn address (auto-submitted on-chain).
 * User must approve the send in Sage.
 */
export async function burnDatWithSage(input: BurnDatParams): Promise<{
  txId: string;
  amountMojos: string;
  to: string;
}> {
  const client = await getClient();
  const session = activeSession ?? (await restoreSageSession());
  if (!session) throw new Error("Connect Sage first");

  const amountMojos = datToMojos(input.datAmount);
  const fee = String(input.feeMojos ?? DEFAULT_XCH_FEE_MOJOS);
  const memoHex = utf8ToHex(input.memo);

  await client.request({
    topic: topicFromSession(session),
    chainId: CHAIN,
    request: {
      method: "chia_send",
      params: {
        assetId: DAT_ASSET_ID,
        amount: amountMojos,
        fee,
        address: DAT_BURN_ADDRESS,
        memos: [memoHex],
      },
    },
  });

  return {
    txId: `sage-burn:${input.memo}:${Date.now()}`,
    amountMojos,
    to: DAT_BURN_ADDRESS,
  };
}

export function hasWalletConnectProjectId() {
  return Boolean(WALLETCONNECT_PROJECT_ID?.trim());
}

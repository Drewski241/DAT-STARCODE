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

let clientPromise: Promise<InstanceType<typeof SignClient>> | null = null;
let activeSession: SessionTypes.Struct | null = null;

function requireProjectId() {
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error(
      "Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env (from cloud.walletconnect.com), then restart the dev server.",
    );
  }
  return WALLETCONNECT_PROJECT_ID;
}

async function getClient() {
  if (!clientPromise) {
    const projectId = requireProjectId();
    clientPromise = SignClient.init({
      projectId,
      metadata: {
        name: APP_NAME,
        description: "Burn DAT for coding credits — permanently out of circulation",
        url: typeof window !== "undefined" ? window.location.origin : "https://localhost",
        icons: [],
      },
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
  if (!WALLETCONNECT_PROJECT_ID) return null;
  const client = await getClient();
  const topic = window.sessionStorage.getItem(SESSION_KEY);
  const sessions = client.session.getAll();
  const found =
    (topic ? sessions.find((s) => s.topic === topic) : undefined) ??
    sessions[sessions.length - 1] ??
    null;
  saveSession(found);
  return found;
}

export type SageConnectResult = {
  uri: string;
  approval: Promise<{ address: string; session: SessionTypes.Struct }>;
};

/** Start WalletConnect pairing — show `uri` as a QR for Sage to scan. */
export async function connectSageWallet(): Promise<SageConnectResult> {
  const client = await getClient();
  const { uri, approval } = await client.connect({
    requiredNamespaces: sageRequiredNamespaces(),
    optionalNamespaces: sageOptionalNamespaces(),
  });
  if (!uri) throw new Error("WalletConnect did not return a pairing URI");

  const approvalPromise = approval().then(async (session) => {
    saveSession(session);
    const address = await requestAddress(session);
    return { address, session };
  });

  return { uri, approval: approvalPromise };
}

export async function disconnectSageWallet() {
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
  saveSession(null);
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

  const address =
    typeof result === "string" ? result : result?.address;
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
  const fee = input.feeMojos ?? DEFAULT_XCH_FEE_MOJOS;

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
        memos: [input.memo],
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
  return Boolean(WALLETCONNECT_PROJECT_ID);
}

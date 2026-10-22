"use client";

import { useEffect, useState } from "react";
import { DAT_BURN_ADDRESS, DAT_SYMBOL } from "@/lib/config";
import { economyBlurb, getCreditPacks } from "@/lib/economy";
import { mojosToDat } from "@/lib/dat-units";
import { formatDat } from "@/lib/utils";
import { getSageConfig, shortAddress } from "@/lib/sage";
import {
  burnDatWithSage,
  connectSageWallet,
  disconnectSageWallet,
  getDatBalanceMojos,
  hasWalletConnectProjectId,
  restoreSageSession,
} from "@/lib/sage-wc";

type Account = {
  id: string;
  walletAddress: string | null;
  credits: number;
};

export function WalletPanel({
  account,
  onAccount,
}: {
  account: Account | null;
  onAccount: (a: Account) => void;
}) {
  const sage = getSageConfig();
  const packs = getCreditPacks();
  const live = hasWalletConnectProjectId();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [datBalance, setDatBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!live) return;
    void (async () => {
      try {
        const session = await restoreSageSession();
        if (!session) return;
        const bal = await getDatBalanceMojos();
        setDatBalance(mojosToDat(bal));
      } catch {
        // no restored session
      }
    })();
  }, [live]);

  useEffect(() => {
    if (!wcUri) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void import("qrcode").then((QR) =>
      QR.toDataURL(wcUri, { width: 280, margin: 1, color: { dark: "#1a1208", light: "#f5efe4" } }).then(
        (url) => {
          if (!cancelled) setQrDataUrl(url);
        },
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [wcUri]);

  async function refreshAccount() {
    const res = await fetch("/api/session", { credentials: "same-origin" });
    const data = await res.json();
    if (res.ok && data.account) {
      onAccount(data.account);
      return data.account as Account;
    }
    return null;
  }

  async function linkAddress(walletAddress: string) {
    const res = await fetch("/api/session", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not link wallet");
    onAccount(data.account);
    return data.account as Account;
  }

  async function connectSage() {
    setBusy("connect");
    setMessage(null);
    setWcUri(null);
    try {
      const session = await refreshAccount();
      if (!session) {
        setMessage("Sign in required — open Account to create or sign in.");
        window.location.href = "/account";
        return;
      }

      if (!live) {
        setMessage(
          "WalletConnect is not configured on this deploy. In Amplify set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (free at cloud.walletconnect.com), redeploy, then Connect Sage again.",
        );
        return;
      }

      setMessage("Opening WalletConnect — approve the connection in Sage…");
      const { uri, approval } = await connectSageWallet();
      setWcUri(uri);
      setMessage(
        "Scan this QR with Sage (WalletConnect), or paste the URI into Sage.",
      );

      const { address } = await approval;
      setWcUri(null);
      await linkAddress(address);
      try {
        const bal = await getDatBalanceMojos();
        setDatBalance(mojosToDat(bal));
      } catch {
        setDatBalance(null);
      }
      setMessage(`Sage connected: ${shortAddress(address)}. Ready to burn DAT.`);
    } catch (err) {
      setWcUri(null);
      setMessage(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setMessage(null);
    try {
      await disconnectSageWallet();
      setDatBalance(null);
      setWcUri(null);
      // Always clear the saved linked address so Reconnect is available.
      const res = await fetch("/api/session", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlinkWallet: true }),
      });
      const data = await res.json();
      if (res.ok && data.account) {
        onAccount(data.account);
      }
      setMessage(
        live
          ? "Sage disconnected. Click Connect Sage to pair again."
          : "Wallet unlinked. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in Amplify, redeploy, then Connect Sage.",
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmBurnWithRetry(paymentId: string) {
    const maxAttempts = 40;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      setMessage(
        `Checking burn on-chain… (${attempt}/${maxAttempts})`,
      );
      const confirmRes = await fetch("/api/payments/confirm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, demo: false }),
      });
      const confirmed = await confirmRes.json();
      if (confirmRes.ok && confirmed.verified) {
        return confirmed as {
          payment: { credits: number; datAmount: number };
          account: Account;
          verification?: { explorerUrl?: string };
        };
      }
      if (confirmRes.status === 202 || confirmed.pending) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw new Error(confirmed.error ?? "Confirm failed");
    }
    throw new Error(
      "Burn submitted but not confirmed on-chain yet. Wait a minute and press Burn again only if credits did not arrive — do not approve a second Sage send.",
    );
  }

  async function buyPack(packId: string) {
    setBusy(packId);
    setMessage("Starting burn…");
    try {
      const session = await refreshAccount();
      if (!session) {
        setMessage("Sign in required — open Account to create or sign in.");
        window.location.href = "/account";
        return;
      }

      const intentRes = await fetch("/api/payments/intent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const intent = await intentRes.json();
      if (!intentRes.ok) throw new Error(intent.error ?? "Intent failed");

      const pack = packs.find((p) => p.id === packId);
      if (!pack) throw new Error("Unknown pack");

      if (live && session.walletAddress) {
        setMessage(
          `Approve in Sage: burn ${formatDat(pack.dat)} ${DAT_SYMBOL} to the burn address…`,
        );
        await burnDatWithSage({
          datAmount: pack.dat,
          memo: intent.payment.memo as string,
        });
        setMessage(
          "Burn submitted from Sage. Waiting for on-chain confirmation…",
        );
      } else if (!live) {
        throw new Error(
          "Live Sage burns need NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. Set it in .env and Connect Sage first.",
        );
      } else {
        throw new Error("Connect Sage before burning DAT.");
      }

      const confirmed = await confirmBurnWithRetry(intent.payment.id as string);
      const synced = (await refreshAccount()) ?? confirmed.account;
      onAccount(synced);
      try {
        const bal = await getDatBalanceMojos();
        setDatBalance(mojosToDat(bal));
      } catch {
        /* ignore */
      }

      const added = confirmed.payment.credits as number;
      const explorer = confirmed.verification?.explorerUrl as string | undefined;
      setMessage(
        `On-chain burn verified. ${formatDat(confirmed.payment.datAmount)} ${DAT_SYMBOL} (+${added} credits). Balance: ${synced.credits}. Sent to ${shortAddress(DAT_BURN_ADDRESS)}.${explorer ? ` ${explorer}` : ""}`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      id="pay"
      className="relative z-20 mx-auto max-w-5xl scroll-mt-8 px-5 py-20 md:px-10"
    >
      <div className="mb-10 max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-copper-400">
          Pay with DAT · Sage wallet
        </p>
        <h2 className="mt-3 font-display text-4xl tracking-tight text-copper-50 md:text-5xl">
          Fuel the forge
        </h2>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-steel-300">
          Connect Sage and burn DAT for credits. Every payment goes to the Chia
          burn address — permanently out of circulation.
        </p>
        <p className="mt-4 font-mono text-[11px] leading-relaxed text-steel-500">
          {economyBlurb()}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-y border-copper-800/40 py-4">
        <button
          type="button"
          onClick={() => void connectSage()}
          disabled={busy === "connect"}
          className="relative z-20 inline-flex h-12 cursor-pointer items-center rounded-none bg-copper-500 px-5 font-mono text-xs uppercase tracking-widest text-ink-950 transition hover:bg-copper-400 disabled:cursor-wait disabled:opacity-60"
        >
          {busy === "connect"
            ? "Connecting…"
            : account?.walletAddress
              ? "Reconnect Sage"
              : "Connect Sage"}
        </button>
        {account?.walletAddress && (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={!!busy}
            className="font-mono text-xs uppercase tracking-widest text-steel-400 hover:text-copper-100"
          >
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
        )}
        <div className="font-mono text-xs text-steel-400">
          {account?.walletAddress ? (
            <span>
              Linked{" "}
              <span className="text-copper-200">
                {shortAddress(account.walletAddress)}
              </span>
              {!live && (
                <span className="text-rose-300"> · WalletConnect offline</span>
              )}
            </span>
          ) : (
            <span>Mode: {sage.mode}</span>
          )}
          <span className="mx-2 text-steel-600">·</span>
          <span className="text-copper-200">{account?.credits ?? 0} credits</span>
          {datBalance != null && (
            <>
              <span className="mx-2 text-steel-600">·</span>
              <span className="text-copper-200">
                {formatDat(datBalance)} {DAT_SYMBOL} in Sage
              </span>
            </>
          )}
        </div>
      </div>

      {!live && (
        <p className="mt-4 max-w-3xl border-l-2 border-amber-500/80 bg-ink-900/60 py-3 pl-4 font-mono text-xs leading-relaxed text-amber-100">
          Live burns need{" "}
          <span className="text-copper-200">
            NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
          </span>{" "}
          in Amplify env (from{" "}
          <a
            href="https://cloud.walletconnect.com/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-amber-700 underline-offset-2"
          >
            cloud.walletconnect.com
          </a>
          ), then a redeploy. Until then Disconnect still clears the saved
          address.
        </p>
      )}

      <p className="mt-4 font-mono text-[11px] leading-relaxed text-steel-500">
        Burn address{" "}
        <span className="break-all text-steel-400">{DAT_BURN_ADDRESS}</span>
      </p>

      {qrDataUrl && (
        <div className="mt-6 max-w-sm border border-copper-800/50 bg-ink-900/50 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="WalletConnect QR for Sage" className="mx-auto" />
          <p className="mt-3 font-mono text-[10px] leading-relaxed break-all text-steel-500">
            {wcUri}
          </p>
        </div>
      )}

      {message && (
        <p
          role="status"
          aria-live="polite"
          className="mt-6 max-w-3xl border-l-2 border-copper-500 bg-ink-900/60 py-3 pl-4 font-mono text-xs leading-relaxed text-copper-100"
        >
          {message}
        </p>
      )}

      <div className="relative z-20 mt-10 grid gap-8 md:grid-cols-3">
        {packs.map((pack) => (
          <div
            key={pack.id}
            className="relative z-20 border-t border-copper-600/50 pt-5"
          >
            <h3 className="font-display text-2xl text-copper-100">{pack.label}</h3>
            <p className="mt-1 font-mono text-sm text-copper-300">
              {formatDat(pack.dat)} {DAT_SYMBOL} burned → {pack.credits} credits
            </p>
            <p className="mt-3 text-sm text-steel-400">{pack.blurb}</p>
            <button
              type="button"
              data-pack={pack.id}
              className="relative z-20 mt-6 inline-flex h-12 w-full cursor-pointer items-center justify-center rounded-none border border-copper-600/60 bg-ink-900 px-4 font-mono text-xs uppercase tracking-widest text-copper-100 transition hover:border-copper-400 hover:bg-copper-900/50 hover:text-copper-50 disabled:cursor-wait disabled:opacity-60"
              disabled={!!busy}
              onClick={() => void buyPack(pack.id)}
            >
              {busy === pack.id ? "Burning…" : "Burn DAT"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

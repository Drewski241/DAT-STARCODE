"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CREDIT_PACKS, DAT_SYMBOL } from "@/lib/config";
import { formatDat } from "@/lib/utils";
import { getSageConfig, shortAddress } from "@/lib/sage";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function connectSage() {
    setBusy("connect");
    setMessage(null);
    try {
      if (sage.mode === "demo") {
        const demoAddress =
          "xch1demo" + Math.random().toString(16).slice(2, 14).padEnd(50, "0");
        const res = await fetch("/api/session", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: demoAddress }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Connect failed");
        onAccount(data.account);
        setMessage(
          "Demo Sage session linked. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID for live WalletConnect.",
        );
      } else {
        setMessage(
          "WalletConnect project configured — wire Sign Client in production deploy.",
        );
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setBusy(null);
    }
  }

  async function buyPack(packId: string) {
    setBusy(packId);
    setMessage(null);
    try {
      const intentRes = await fetch("/api/payments/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const intent = await intentRes.json();
      if (!intentRes.ok) throw new Error(intent.error ?? "Intent failed");

      // Demo path: skip chain broadcast and credit immediately.
      // Live path: open Sage WC, send DAT CAT to merchant, then confirm with tx id.
      const confirmRes = await fetch("/api/payments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: intent.payment.id,
          demo: true,
        }),
      });
      const confirmed = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmed.error ?? "Confirm failed");
      onAccount(confirmed.account);
      setMessage(
        `Added ${confirmed.payment.credits} credits (${formatDat(confirmed.payment.datAmount)} ${DAT_SYMBOL}). Memo: ${intent.payment.memo}`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="pay" className="relative mx-auto max-w-5xl px-5 py-20 md:px-10">
      <div className="mb-10 max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-copper-400">
          Pay with DAT · Sage wallet
        </p>
        <h2 className="mt-3 font-display text-4xl tracking-tight text-copper-50 md:text-5xl">
          Fuel the forge
        </h2>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-steel-300">
          Connect Sage, send DAT to the merchant address, and unlock credits for
          GPU coding jobs on the P720 worker. Demo mode credits instantly so you
          can try the studio before mainnet settlement.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-y border-copper-800/40 py-4">
        <Button
          type="button"
          onClick={connectSage}
          disabled={busy === "connect"}
          className="rounded-none bg-copper-500 font-mono text-xs uppercase tracking-widest text-ink-950 hover:bg-copper-400"
        >
          {busy === "connect"
            ? "Connecting…"
            : account?.walletAddress
              ? "Reconnect Sage"
              : "Connect Sage"}
        </Button>
        <div className="font-mono text-xs text-steel-400">
          {account?.walletAddress ? (
            <span>
              Linked{" "}
              <span className="text-copper-200">
                {shortAddress(account.walletAddress)}
              </span>
            </span>
          ) : (
            <span>Mode: {sage.mode}</span>
          )}
          <span className="mx-2 text-steel-600">·</span>
          <span>{account?.credits ?? 0} credits</span>
        </div>
      </div>

      <div className="mt-10 grid gap-8 md:grid-cols-3">
        {CREDIT_PACKS.map((pack) => (
          <div key={pack.id} className="border-t border-copper-600/50 pt-5">
            <h3 className="font-display text-2xl text-copper-100">{pack.label}</h3>
            <p className="mt-1 font-mono text-sm text-copper-300">
              {formatDat(pack.dat)} {DAT_SYMBOL}
            </p>
            <p className="mt-3 text-sm text-steel-400">{pack.blurb}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-6 rounded-none border-copper-600/60 bg-transparent font-mono text-xs uppercase tracking-widest text-copper-200 hover:bg-copper-900/40 hover:text-copper-50"
              disabled={!!busy}
              onClick={() => buyPack(pack.id)}
            >
              {busy === pack.id ? "Settling…" : "Pay with DAT"}
            </Button>
          </div>
        ))}
      </div>

      {message && (
        <p className="mt-8 max-w-3xl border-l-2 border-copper-500 pl-4 font-mono text-xs leading-relaxed text-steel-300">
          {message}
        </p>
      )}
    </section>
  );
}

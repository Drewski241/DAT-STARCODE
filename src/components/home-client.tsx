"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { WalletPanel } from "@/components/wallet-panel";

type Account = {
  id: string;
  walletAddress: string | null;
  credits: number;
};

export function HomeClient() {
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    void fetch("/api/session")
      .then((r) => r.json())
      .then((d) => setAccount(d.account))
      .catch(() => undefined);
  }, []);

  return (
    <div className="relative min-h-screen bg-ink-950 text-copper-50">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-grid opacity-50"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-radial-forge"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -right-24 top-10 z-0 h-[70vh] w-[55vw] bg-hero-metal opacity-80 mix-blend-screen"
      />

      <div className="relative z-10">
        <SiteHeader credits={account?.credits} />

        <section className="flex min-h-[calc(100vh-5.5rem)] flex-col justify-end px-5 pb-16 pt-10 md:px-10 md:pb-24">
          <div className="max-w-3xl animate-rise">
            <h1 className="font-display text-[clamp(2.6rem,9vw,5.5rem)] leading-[0.92] tracking-tight text-copper-50">
              DAT STARCODER
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-steel-200 md:text-xl">
              An AI coding agent you pay for with DAT through Sage. Burn DAT,
              unlock credits, ship the change.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/studio"
                className="inline-flex items-center rounded-none bg-copper-500 px-5 py-3 font-mono text-xs uppercase tracking-widest text-ink-950 transition hover:bg-copper-400"
              >
                Open studio
              </Link>
              <a
                href="#pay"
                className="inline-flex items-center rounded-none border border-copper-600/70 px-5 py-3 font-mono text-xs uppercase tracking-widest text-copper-100 transition hover:border-copper-400 hover:bg-copper-950/40"
              >
                Buy credits
              </a>
            </div>
          </div>
        </section>

        <section className="border-t border-copper-800/40 bg-ink-950/80 px-5 py-16 md:px-10">
          <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-2">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-copper-400">
                How it works
              </p>
              <h2 className="mt-3 font-display text-3xl text-copper-50 md:text-4xl">
                Burn DAT. Get work done.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-steel-300">
                Connect Sage, choose a credit pack, and burn DAT permanently to
                the Chia burn address. Credits unlock the studio — describe the
                change, and the agent takes it from there.
              </p>
            </div>
            <dl className="space-y-5 font-mono text-sm">
              <div className="border-t border-copper-800/50 pt-4">
                <dt className="text-steel-500">Pay</dt>
                <dd className="mt-1 text-copper-100">
                  DAT via Sage · sent to the burn address · never recovered
                </dd>
              </div>
              <div className="border-t border-copper-800/50 pt-4">
                <dt className="text-steel-500">Credits</dt>
                <dd className="mt-1 text-copper-100">
                  Packs unlock studio time · spend credits per coding job
                </dd>
              </div>
              <div className="border-t border-copper-800/50 pt-4">
                <dt className="text-steel-500">Agent</dt>
                <dd className="mt-1 text-copper-100">
                  Describe the task · get a plan, patches, and next steps
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <WalletPanel account={account} onAccount={setAccount} />

        <footer className="border-t border-copper-900/60 px-5 py-8 md:px-10">
          <p className="font-mono text-[11px] uppercase tracking-widest text-steel-600">
            DAT STARCODER · DAT burned for credits · Sage wallet
          </p>
        </footer>
      </div>
    </div>
  );
}

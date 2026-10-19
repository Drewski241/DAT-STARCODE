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
          <h1 className="font-display text-[clamp(3.4rem,12vw,7.5rem)] leading-[0.88] tracking-tight text-copper-50">
            Anvil
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-steel-200 md:text-xl">
            A coding agent that runs on your ThinkStation P720 and RTX 3090.
            Customers pay in DAT through Sage. AWS hosts the storefront; the
            forge stays on your desk.
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
              Hybrid layout
            </p>
            <h2 className="mt-3 font-display text-3xl text-copper-50 md:text-4xl">
              AWS face. Local fire.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-steel-300">
              Amplify serves the website. DynamoDB (or the local JSON store in
              demo) tracks credits and jobs. Your P720 worker polls over HTTPS
              with a worker key, claims work, and runs Ollama or vLLM on the
              3090 — start with what fits today, then grow into more system RAM
              and NVMe headroom for larger models.
            </p>
          </div>
          <dl className="space-y-5 font-mono text-sm">
            <div className="border-t border-copper-800/50 pt-4">
              <dt className="text-steel-500">Workstation</dt>
              <dd className="mt-1 text-copper-100">
                Lenovo P720 · RTX 3090 · 16 GB system RAM (upgrade path) ·
                2×1 TB NVMe · 16 TB HDD for model/archive storage
              </dd>
            </div>
            <div className="border-t border-copper-800/50 pt-4">
              <dt className="text-steel-500">Payment</dt>
              <dd className="mt-1 text-copper-100">
                DAT CAT via Sage WalletConnect · merchant xch address · credit packs
              </dd>
            </div>
            <div className="border-t border-copper-800/50 pt-4">
              <dt className="text-steel-500">Agent path</dt>
              <dd className="mt-1 text-copper-100">
                Browser → AWS API → job queue → P720 worker → local LLM → result stream
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <WalletPanel account={account} onAccount={setAccount} />

      <footer className="border-t border-copper-900/60 px-5 py-8 md:px-10">
        <p className="font-mono text-[11px] uppercase tracking-widest text-steel-600">
          Anvil · DAT governance token asset configured · see docs/architecture
        </p>
      </footer>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SiteHeader({ credits }: { credits?: number | null }) {
  const pathname = usePathname();

  return (
    <header className="relative z-20 flex items-center justify-between px-5 py-5 md:px-10">
      <Link href="/" className="group flex items-baseline gap-2">
        <span className="font-display text-2xl tracking-tight text-copper-100 md:text-3xl">
          Anvil
        </span>
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-steel-400 transition group-hover:text-copper-300 sm:inline">
          DAT · Sage · GPU
        </span>
      </Link>
      <nav className="flex items-center gap-2 md:gap-4">
        <Link
          href="/studio"
          className={cn(
            "font-mono text-xs uppercase tracking-widest transition",
            pathname?.startsWith("/studio")
              ? "text-copper-200"
              : "text-steel-400 hover:text-copper-100",
          )}
        >
          Studio
        </Link>
        <Link
          href="/#pay"
          className="font-mono text-xs uppercase tracking-widest text-steel-400 transition hover:text-copper-100"
        >
          Buy DAT credits
        </Link>
        {typeof credits === "number" && (
          <span className="rounded-sm border border-copper-700/40 bg-ink-900/70 px-2.5 py-1 font-mono text-xs text-copper-200">
            {credits} cr
          </span>
        )}
      </nav>
    </header>
  );
}

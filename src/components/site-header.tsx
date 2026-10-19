"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Account = {
  id: string;
  username: string | null;
  credits: number;
};

export function SiteHeader({ credits }: { credits?: number | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    void fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setAccount(d.account ?? null))
      .catch(() => setAccount(null));
  }, [pathname, credits]);

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    setAccount(null);
    router.push("/account");
    router.refresh();
  }

  const shownCredits =
    typeof credits === "number" ? credits : account?.credits;

  return (
    <header className="relative z-20 flex items-center justify-between px-5 py-5 md:px-10">
      <Link href="/" className="group flex items-baseline gap-2">
        <span className="font-display text-xl tracking-tight text-copper-100 md:text-2xl">
          DAT STARCODER
        </span>
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-steel-400 transition group-hover:text-copper-300 sm:inline">
          DAT · Sage · burn
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
        {account?.username ? (
          <>
            <span className="hidden font-mono text-xs text-steel-400 sm:inline">
              @{account.username}
            </span>
            {typeof shownCredits === "number" && (
              <span className="rounded-sm border border-copper-700/40 bg-ink-900/70 px-2.5 py-1 font-mono text-xs text-copper-200">
                {shownCredits} cr
              </span>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="font-mono text-xs uppercase tracking-widest text-steel-400 hover:text-copper-100"
            >
              Sign out
            </button>
          </>
        ) : (
          <Link
            href="/account"
            className={cn(
              "font-mono text-xs uppercase tracking-widest transition",
              pathname?.startsWith("/account")
                ? "text-copper-200"
                : "text-steel-400 hover:text-copper-100",
            )}
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}

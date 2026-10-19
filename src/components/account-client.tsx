"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { Button } from "@/components/ui/button";

type Me = {
  id: string;
  username: string | null;
  credits: number;
  source?: string;
};

export function AccountClient() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    void fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setMe(d.account ?? null))
      .catch(() => setMe(null));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    setMe(null);
  }

  if (me === undefined) {
    return (
      <p className="font-mono text-sm text-steel-500">Checking session…</p>
    );
  }

  if (me?.username) {
    return (
      <div className="space-y-6 border border-copper-800/50 bg-ink-900/40 p-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-copper-400">
            Signed in
          </p>
          <h2 className="mt-2 font-display text-2xl text-copper-50">
            @{me.username}
          </h2>
          <p className="mt-2 font-mono text-sm text-steel-300">
            {me.credits} credits
            {me.source === "spirit-poker" ? " · Spirit Poker linked" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/studio"
            className="inline-flex items-center rounded-none bg-copper-500 px-5 py-3 font-mono text-xs uppercase tracking-widest text-ink-950 transition hover:bg-copper-400"
          >
            Open studio
          </Link>
          <Button
            type="button"
            variant="outline"
            onClick={() => void logout()}
            className="rounded-none border-copper-700 font-mono text-xs uppercase tracking-widest text-copper-100"
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return <AuthForm onAuthed={(account) => setMe(account)} />;
}

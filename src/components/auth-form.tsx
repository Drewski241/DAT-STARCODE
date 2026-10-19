"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublicAccount } from "@/lib/types";

type Mode = "login" | "register";

export function AuthForm({
  onAuthed,
  initialMode = "login",
}: {
  onAuthed?: (account: PublicAccount) => void;
  initialMode?: Mode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [preferPoker, setPreferPoker] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body =
        mode === "register"
          ? { username, password, email: email || undefined }
          : { username, password, countryCode, preferPoker };

      const res = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Auth failed");

      onAuthed?.(data.account);
      const via =
        data.via === "spirit-poker"
          ? "Signed in with your DAT Spirit Poker account."
          : mode === "register"
            ? "Account created. Welcome to DAT STARCODER."
            : "Signed in.";
      setMessage(via);
      router.refresh();
      router.push("/studio");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-md space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          className={`flex-1 border px-3 py-2 font-mono text-xs uppercase tracking-widest ${
            mode === "login"
              ? "border-copper-400 text-copper-100"
              : "border-copper-800 text-steel-500"
          }`}
          onClick={() => setMode("login")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`flex-1 border px-3 py-2 font-mono text-xs uppercase tracking-widest ${
            mode === "register"
              ? "border-copper-400 text-copper-100"
              : "border-copper-800 text-steel-500"
          }`}
          onClick={() => setMode("register")}
        >
          Create account
        </button>
      </div>

      <p className="font-mono text-[11px] leading-relaxed text-steel-500">
        {mode === "login"
          ? "Use a DAT STARCODER account or your existing datspiritpoker.com username and password."
          : "Create a DAT STARCODER account. Already on Spirit Poker? Sign in instead."}
      </p>

      <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
        Username
      </label>
      <Input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        minLength={3}
        maxLength={20}
        className="rounded-none border-copper-800/50 bg-ink-900/80 font-mono"
        autoComplete="username"
      />

      <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
        Password
      </label>
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        className="rounded-none border-copper-800/50 bg-ink-900/80 font-mono"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
      />

      {mode === "register" && (
        <>
          <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
            Email (optional)
          </label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-none border-copper-800/50 bg-ink-900/80 font-mono"
            autoComplete="email"
          />
        </>
      )}

      {mode === "login" && (
        <>
          <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
            Country (for Spirit Poker sign-in)
          </label>
          <Input
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            maxLength={2}
            className="rounded-none border-copper-800/50 bg-ink-900/80 font-mono uppercase"
          />
          <label className="flex items-center gap-2 font-mono text-[11px] text-steel-400">
            <input
              type="checkbox"
              checked={preferPoker}
              onChange={(e) => setPreferPoker(e.target.checked)}
            />
            Prefer DAT Spirit Poker account when available
          </label>
        </>
      )}

      <Button
        type="submit"
        disabled={busy}
        className="w-full rounded-none bg-copper-500 font-mono text-xs uppercase tracking-widest text-ink-950 hover:bg-copper-400"
      >
        {busy
          ? "Working…"
          : mode === "register"
            ? "Create account"
            : "Sign in"}
      </Button>

      {error && (
        <p className="border-l-2 border-rose-500 pl-3 font-mono text-xs text-rose-300">
          {error}
        </p>
      )}
      {message && (
        <p className="border-l-2 border-copper-500 pl-3 font-mono text-xs text-copper-200">
          {message}
        </p>
      )}

      <p className="font-mono text-[11px] text-steel-600">
        Spirit Poker:{" "}
        <a
          href="https://datspiritpoker.com"
          className="text-copper-300 underline-offset-2 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          datspiritpoker.com
        </a>
      </p>
    </form>
  );
}

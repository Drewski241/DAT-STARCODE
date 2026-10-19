"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COUNTRIES,
  DEFAULT_COUNTRY_CODE,
  SPIRIT_POKER_BLOCKED_COUNTRIES,
} from "@/lib/countries";
import type { PublicAccount } from "@/lib/types";

type Mode = "login" | "register" | "reset";

const blocked = new Set<string>(SPIRIT_POKER_BLOCKED_COUNTRIES);

const BAD_CREDENTIALS_HINT =
  "Check your DAT username and DAT password.";

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
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [resetCode, setResetCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [offerReset, setOfferReset] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setMessage(null);
    setOfferReset(false);
    if (next !== "reset") {
      setCodeSent(false);
      setResetCode("");
      setConfirmPassword("");
    }
  }

  async function sendResetCode() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!username.trim() || !email.trim()) {
        throw new Error("Enter your DAT username and the email on the account.");
      }
      const res = await fetch("/api/auth/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not send reset code");
      setCodeSent(true);
      setMessage(
        data.message ??
          "Check your inbox for the reset code (expires in 15 minutes).",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset code");
    } finally {
      setBusy(false);
    }
  }

  async function setNewPassword() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (password !== confirmPassword) {
        throw new Error("New passwords do not match");
      }
      if (password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          resetCode,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not reset password");
      setPassword("");
      setConfirmPassword("");
      setResetCode("");
      setCodeSent(false);
      setMode("login");
      setError(null);
      setMessage(
        data.message ?? "Password updated. Sign in with your DAT password.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "reset") {
      if (codeSent && resetCode.trim()) {
        await setNewPassword();
      } else {
        await sendResetCode();
      }
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    setOfferReset(false);
    try {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body =
        mode === "register"
          ? { username, password, email: email || undefined }
          : { username, password, countryCode, preferPoker: true };

      const res = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const raw = (data.error as string | undefined) ?? "Auth failed";
        if (
          mode === "login" &&
          /unknown|invalid|incorrect|password|failed|unauthorized|401|check your dat/i.test(
            raw,
          )
        ) {
          setOfferReset(true);
          throw new Error(BAD_CREDENTIALS_HINT);
        }
        throw new Error(raw);
      }

      onAuthed?.(data.account);
      setMessage(
        mode === "register"
          ? "Account created with 20 starter credits. Opening studio…"
          : "Signed in.",
      );
      router.refresh();
      window.setTimeout(() => router.push("/studio"), 400);
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
          onClick={() => switchMode("login")}
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
          onClick={() => switchMode("register")}
        >
          Create account
        </button>
      </div>

      <p className="font-mono text-[11px] leading-relaxed text-steel-500">
        {mode === "login"
          ? "Sign in with your DAT username and DAT password."
          : mode === "register"
            ? "Create a DAT STARCODER account. New accounts start with 20 credits."
            : "Reset your DAT password with the email on your account."}
      </p>

      <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
        DAT username
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

      {mode !== "reset" && (
        <>
          <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
            DAT password
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
        </>
      )}

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
          <label
            htmlFor="country-code"
            className="block font-mono text-[11px] uppercase tracking-widest text-steel-400"
          >
            Country
          </label>
          <select
            id="country-code"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            className="flex h-9 w-full rounded-none border border-copper-800/50 bg-ink-900/80 px-3 py-1 font-mono text-sm text-copper-50 outline-none focus-visible:border-copper-500"
          >
            {COUNTRIES.map((c) => (
              <option
                key={c.code}
                value={c.code}
                disabled={blocked.has(c.code)}
              >
                {c.name} ({c.code})
                {blocked.has(c.code) ? " — unavailable" : ""}
              </option>
            ))}
          </select>
        </>
      )}

      {mode === "reset" && (
        <>
          <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
            Email on the account
          </label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-none border-copper-800/50 bg-ink-900/80 font-mono"
            autoComplete="email"
          />
          <p className="font-mono text-[11px] text-steel-500">
            Use the verified email on your DAT account. Reset codes are only sent
            by email and expire in 15 minutes.
          </p>

          {codeSent && (
            <>
              <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
                Reset code
              </label>
              <Input
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                required
                className="rounded-none border-copper-800/50 bg-ink-900/80 font-mono"
                autoComplete="one-time-code"
                spellCheck={false}
              />
              <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
                New DAT password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="rounded-none border-copper-800/50 bg-ink-900/80 font-mono"
                autoComplete="new-password"
              />
              <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
                Confirm new password
              </label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="rounded-none border-copper-800/50 bg-ink-900/80 font-mono"
                autoComplete="new-password"
              />
            </>
          )}
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
            : mode === "reset"
              ? codeSent
                ? "Set new password"
                : "Email reset code"
              : "Sign in"}
      </Button>

      {mode === "reset" && (
        <button
          type="button"
          className="w-full font-mono text-[11px] text-steel-400 underline-offset-2 hover:text-copper-200 hover:underline"
          onClick={() => switchMode("login")}
        >
          Back to sign in
        </button>
      )}

      {error && (
        <div className="space-y-3 border-l-2 border-rose-500 pl-3">
          <p className="font-mono text-xs text-rose-300">{error}</p>
          {offerReset && mode === "login" && (
            <button
              type="button"
              onClick={() => switchMode("reset")}
              className="inline-flex w-full items-center justify-center border border-copper-500 bg-copper-900/40 px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-copper-100 transition hover:border-copper-300 hover:bg-copper-800/50"
            >
              Reset password
            </button>
          )}
        </div>
      )}
      {message && (
        <p className="border-l-2 border-copper-500 pl-3 font-mono text-xs text-copper-200">
          {message}
        </p>
      )}

      {mode === "login" && !offerReset && (
        <button
          type="button"
          className="w-full font-mono text-[11px] text-steel-500 underline-offset-2 hover:text-copper-200 hover:underline"
          onClick={() => switchMode("reset")}
        >
          Reset password
        </button>
      )}
    </form>
  );
}

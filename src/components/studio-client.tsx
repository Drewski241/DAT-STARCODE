"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { SiteHeader } from "@/components/site-header";
import { CREDITS_PER_JOB } from "@/lib/config";
import { cn } from "@/lib/utils";

type Account = {
  id: string;
  walletAddress: string | null;
  credits: number;
};

type Job = {
  id: string;
  prompt: string;
  repoHint: string | null;
  status: string;
  creditsCharged: number;
  result: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export function StudioClient() {
  const [account, setAccount] = useState<Account | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [prompt, setPrompt] = useState(
    "Add a typed CLI flag --dry-run that prints the planned agent steps without executing them.",
  );
  const [repoHint, setRepoHint] = useState("worker/");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    if (res.ok) {
      setAccount(data.account);
      setJobs(data.jobs);
      if (!selectedId && data.jobs[0]) setSelectedId(data.jobs[0].id);
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [refresh]);

  async function submitJob() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, repoHint }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to enqueue");
      setAccount(data.account);
      setSelectedId(data.job.id);
      // Kick the inline demo worker so the UI completes without a P720 online.
      void fetch("/api/worker/inline", { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null;

  return (
    <div className="relative min-h-screen bg-ink-950 text-copper-50">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-grid opacity-40" />
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-radial-forge" />
      <div className="relative z-10">
      <SiteHeader credits={account?.credits} />

      <main className="mx-auto grid max-w-6xl gap-8 px-5 pb-16 pt-4 md:grid-cols-[1fr_1.2fr] md:px-10">
        <section>
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-copper-400">
            Coding studio
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tight md:text-5xl">
            Dispatch a job
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-steel-300">
            Describe the change you want. Each job costs {CREDITS_PER_JOB}{" "}
            credits — buy more by burning DAT.
          </p>

          <label className="mt-8 block font-mono text-[11px] uppercase tracking-widest text-steel-400">
            Prompt
          </label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={8}
            className="mt-2 rounded-none border-copper-800/50 bg-ink-900/80 font-mono text-sm text-copper-50"
          />

          <label className="mt-5 block font-mono text-[11px] uppercase tracking-widest text-steel-400">
            Repo / path hint
          </label>
          <Input
            value={repoHint}
            onChange={(e) => setRepoHint(e.target.value)}
            className="mt-2 rounded-none border-copper-800/50 bg-ink-900/80 font-mono text-sm"
          />

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={submitJob}
              disabled={busy}
              className="rounded-none bg-copper-500 font-mono text-xs uppercase tracking-widest text-ink-950 hover:bg-copper-400"
            >
              {busy ? "Queuing…" : `Run · ${CREDITS_PER_JOB} cr`}
            </Button>
            <Link
              href="/#pay"
              className="font-mono text-xs uppercase tracking-widest text-steel-400 hover:text-copper-200"
            >
              Top up DAT
            </Link>
          </div>
          {error && (
            <p className="mt-4 border-l-2 border-rose-500 pl-3 font-mono text-xs text-rose-300">
              {error}
            </p>
          )}

          <ul className="mt-10 space-y-2">
            {jobs.length === 0 && (
              <li className="font-mono text-xs text-steel-500">No jobs yet.</li>
            )}
            {jobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(job.id)}
                  className={cn(
                    "w-full border-l-2 px-3 py-2 text-left transition",
                    selected?.id === job.id
                      ? "border-copper-400 bg-ink-900/80"
                      : "border-transparent hover:border-copper-800 hover:bg-ink-900/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-xs text-copper-100">
                      {job.prompt.slice(0, 64)}
                    </span>
                    <StatusPill status={job.status} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="min-h-[28rem] border border-copper-800/40 bg-ink-900/50 p-5 md:p-6">
          {!selected ? (
            <p className="font-mono text-sm text-steel-500">
              Submit a job to see agent output.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-copper-800/40 pb-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-widest text-steel-500">
                    Job {selected.id.slice(0, 8)}
                  </p>
                  <p className="mt-1 text-sm text-copper-100">{selected.prompt}</p>
                </div>
                <StatusPill status={selected.status} />
              </div>
              <div className="mt-5 max-h-[32rem] overflow-auto">
                {selected.status === "queued" ||
                selected.status === "claimed" ||
                selected.status === "running" ? (
                  <p className="animate-pulse-soft font-mono text-sm text-copper-300">
                    Worker is on it…
                  </p>
                ) : selected.error ? (
                  <pre className="whitespace-pre-wrap font-mono text-xs text-rose-300">
                    {selected.error}
                  </pre>
                ) : (
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-steel-200">
                    {selected.result}
                  </pre>
                )}
              </div>
            </>
          )}
        </section>
      </main>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "text-emerald-300"
      : status === "failed"
        ? "text-rose-300"
        : "text-copper-300";
  return (
    <span className={cn("shrink-0 font-mono text-[10px] uppercase tracking-widest", tone)}>
      {status}
    </span>
  );
}

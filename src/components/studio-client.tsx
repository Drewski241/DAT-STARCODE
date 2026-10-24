"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { SiteHeader } from "@/components/site-header";
import { CREDITS_PER_JOB } from "@/lib/config";
import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from "@/lib/models";
import { cn } from "@/lib/utils";

type Account = {
  id: string;
  username?: string | null;
  walletAddress: string | null;
  credits: number;
};

type Job = {
  id: string;
  prompt: string;
  repoHint: string | null;
  modelRequested?: string;
  modelResolved?: string;
  modelReason?: string;
  kind?: string;
  agentProfile?: string;
  projectId?: string | null;
  toolSteps?: number;
  status: string;
  creditsCharged: number;
  result: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

type ProjectStep = {
  id: string;
  title: string;
  prompt: string;
  status: string;
  jobId: string | null;
  resultSummary: string | null;
};

type Project = {
  id: string;
  title: string;
  goal: string;
  status: string;
  steps: ProjectStep[];
  modelRequested: string;
  agentProfile: string;
  planJobId: string | null;
  createdAt: string;
};

type Mode = "job" | "project";

export function StudioClient() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mode, setMode] = useState<Mode>("job");
  const [prompt, setPrompt] = useState(
    "Add a typed CLI flag --dry-run that prints the planned agent steps without executing them.",
  );
  const [projectGoal, setProjectGoal] = useState(
    "Help a new teammate: how to install the DAT STARCODER worker on Windows, macOS, or Linux, plus a short Chromebook note and ChiaLisp specialty routing.",
  );
  const [repoHint, setRepoHint] = useState("");
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [planCredits, setPlanCredits] = useState(
    Math.max(1, Math.floor(CREDITS_PER_JOB / 2)),
  );

  const refresh = useCallback(async () => {
    const [jobsRes, projectsRes] = await Promise.all([
      fetch("/api/jobs", { credentials: "same-origin" }),
      fetch("/api/projects", { credentials: "same-origin" }),
    ]);

    if (jobsRes.status === 401 || projectsRes.status === 401) {
      setAuthed(false);
      router.replace("/account");
      return;
    }

    const jobsData = await jobsRes.json();
    const projectsData = await projectsRes.json();

    if (jobsRes.ok) {
      setAuthed(true);
      setAccount(jobsData.account);
      setJobs(jobsData.jobs);
      if (!selectedId && jobsData.jobs[0]) setSelectedId(jobsData.jobs[0].id);
    }
    if (projectsRes.ok) {
      setProjects(projectsData.projects);
      if (typeof projectsData.planCredits === "number") {
        setPlanCredits(projectsData.planCredits);
      }
      if (!selectedProjectId && projectsData.projects[0]) {
        setSelectedProjectId(projectsData.projects[0].id);
      } else if (selectedProjectId) {
        const fresh = projectsData.projects.find(
          (p: Project) => p.id === selectedProjectId,
        );
        if (fresh) setSelectedProjectId(fresh.id);
      }
    }
  }, [selectedId, selectedProjectId, router]);

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
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, repoHint, model: modelId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to enqueue");
      setAccount(data.account);
      setSelectedId(data.job.id);
      setMode("job");
      if (process.env.NEXT_PUBLIC_USE_INLINE_WORKER === "1") {
        void fetch("/api/worker/inline", { method: "POST" });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitProject() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: projectGoal, model: modelId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create project");
      setAccount(data.account);
      setSelectedProjectId(data.project.id);
      if (data.job?.id) setSelectedId(data.job.id);
      setMode("project");
      if (process.env.NEXT_PUBLIC_USE_INLINE_WORKER === "1") {
        void fetch("/api/worker/inline", { method: "POST" });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project failed");
    } finally {
      setBusy(false);
    }
  }

  async function runNextStep(projectId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/run-next`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start next step");
      if (data.account) setAccount(data.account);
      if (data.job?.id) setSelectedId(data.job.id);
      if (process.env.NEXT_PUBLIC_USE_INLINE_WORKER === "1") {
        void fetch("/api/worker/inline", { method: "POST" });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run next failed");
    } finally {
      setBusy(false);
    }
  }

  async function skipStep(projectId: string, stepId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/steps/${stepId}/skip`,
        { method: "POST", credentials: "same-origin" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Skip failed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skip failed");
    } finally {
      setBusy(false);
    }
  }

  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null;
  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;
  const selectedModel = MODEL_OPTIONS.find((m) => m.id === modelId);
  const pendingCount =
    selectedProject?.steps.filter((s) => s.status === "pending").length ?? 0;

  if (authed === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 font-mono text-sm text-steel-400">
        Redirecting to sign in…
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-ink-950 text-copper-50">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-grid opacity-40"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-radial-forge"
      />
      <div className="relative z-10">
        <SiteHeader credits={account?.credits} />

        <main className="mx-auto grid max-w-6xl gap-8 px-5 pb-16 pt-4 md:grid-cols-[1fr_1.2fr] md:px-10">
          <section>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-copper-400">
              Coding studio
            </p>
            <h1 className="mt-2 font-display text-4xl tracking-tight md:text-5xl">
              Dispatch work
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-steel-300">
              Single jobs or multi-step projects. The worker can search the web,
              guide Windows / macOS / ChromeOS / Linux tasks, use ChiaLisp packs,
              and route hard work to stronger models.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {(
                [
                  ["job", "Single job"],
                  ["project", "Project"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={cn(
                    "rounded-none border px-3 py-2 font-mono text-[11px] uppercase tracking-widest transition",
                    mode === id
                      ? "border-copper-400 bg-copper-900/50 text-copper-100"
                      : "border-copper-800/60 text-steel-400 hover:border-copper-600 hover:text-copper-200",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="mt-8 block font-mono text-[11px] uppercase tracking-widest text-steel-400">
              Model
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModelId(m.id)}
                  className={cn(
                    "rounded-none border px-3 py-2 text-left font-mono text-[11px] uppercase tracking-widest transition",
                    modelId === m.id
                      ? "border-copper-400 bg-copper-900/50 text-copper-100"
                      : "border-copper-800/60 text-steel-400 hover:border-copper-600 hover:text-copper-200",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {selectedModel && (
              <p className="mt-2 font-mono text-[11px] text-steel-500">
                {selectedModel.blurb}
              </p>
            )}

            {mode === "job" ? (
              <form
                className="mt-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitJob();
                }}
              >
                <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
                  Prompt
                </label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={8}
                  className="mt-2 rounded-none border-copper-800/50 bg-ink-900/80 font-mono text-sm text-copper-50"
                />

                <label className="mt-5 block font-mono text-[11px] uppercase tracking-widest text-steel-400">
                  Repo / path hint (optional)
                </label>
                <Input
                  value={repoHint}
                  onChange={(e) => setRepoHint(e.target.value)}
                  placeholder="e.g. worker/"
                  className="mt-2 rounded-none border-copper-800/50 bg-ink-900/80 font-mono text-sm"
                />

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button
                    type="submit"
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
              </form>
            ) : (
              <form
                className="mt-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitProject();
                }}
              >
                <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-400">
                  Project goal
                </label>
                <Textarea
                  value={projectGoal}
                  onChange={(e) => setProjectGoal(e.target.value)}
                  rows={8}
                  className="mt-2 rounded-none border-copper-800/50 bg-ink-900/80 font-mono text-sm text-copper-50"
                />
                <p className="mt-2 font-mono text-[11px] text-steel-500">
                  Plans cost {planCredits} cr · each step costs{" "}
                  {CREDITS_PER_JOB} cr. Approve the checklist, then run steps
                  one at a time.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button
                    type="submit"
                    disabled={busy}
                    data-testid="plan-project"
                    className="rounded-none bg-copper-500 font-mono text-xs uppercase tracking-widest text-ink-950 hover:bg-copper-400"
                  >
                    {busy ? "Planning…" : `Plan project · ${planCredits} cr`}
                  </Button>
                  <Link
                    href="/#pay"
                    className="font-mono text-xs uppercase tracking-widest text-steel-400 hover:text-copper-200"
                  >
                    Top up DAT
                  </Link>
                </div>
              </form>
            )}

            {error && (
              <p className="mt-4 border-l-2 border-rose-500 pl-3 font-mono text-xs text-rose-300">
                {error}
              </p>
            )}

            {mode === "project" && (
              <div className="mt-10 space-y-3">
                <p className="font-mono text-[11px] uppercase tracking-widest text-steel-400">
                  Projects
                </p>
                {projects.length === 0 && (
                  <p className="font-mono text-xs text-steel-500">
                    No projects yet.
                  </p>
                )}
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setMode("project");
                    }}
                    className={cn(
                      "w-full border-l-2 px-3 py-2 text-left transition",
                      selectedProject?.id === project.id
                        ? "border-copper-400 bg-ink-900/80"
                        : "border-transparent hover:border-copper-800 hover:bg-ink-900/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-mono text-xs text-copper-100">
                        {project.title}
                      </span>
                      <StatusPill status={project.status} />
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] text-steel-500">
                      {project.agentProfile} · {project.steps.length} steps
                    </p>
                  </button>
                ))}
              </div>
            )}

            <ul className="mt-10 space-y-2">
              <p className="font-mono text-[11px] uppercase tracking-widest text-steel-400">
                Jobs
              </p>
              {jobs.length === 0 && (
                <li className="font-mono text-xs text-steel-500">No jobs yet.</li>
              )}
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(job.id);
                      setMode("job");
                    }}
                    className={cn(
                      "w-full border-l-2 px-3 py-2 text-left transition",
                      selected?.id === job.id && mode === "job"
                        ? "border-copper-400 bg-ink-900/80"
                        : "border-transparent hover:border-copper-800 hover:bg-ink-900/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-mono text-xs text-copper-100">
                        {job.kind && job.kind !== "task"
                          ? `[${job.kind}] `
                          : ""}
                        {job.prompt.slice(0, 64)}
                      </span>
                      <StatusPill status={job.status} />
                    </div>
                    {job.modelResolved && (
                      <p className="mt-1 truncate font-mono text-[10px] text-steel-500">
                        {job.agentProfile ? `${job.agentProfile} · ` : ""}
                        {job.modelRequested === "auto" ? "auto → " : ""}
                        {job.modelResolved}
                        {typeof job.toolSteps === "number" && job.toolSteps > 0
                          ? ` · ${job.toolSteps} tools`
                          : ""}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="min-h-[28rem] border border-copper-800/40 bg-ink-900/50 p-5 md:p-6">
            {mode === "project" && selectedProject ? (
              <ProjectPanel
                project={selectedProject}
                busy={busy}
                pendingCount={pendingCount}
                onRunNext={() => void runNextStep(selectedProject.id)}
                onSkip={(stepId) =>
                  void skipStep(selectedProject.id, stepId)
                }
                onOpenJob={(jobId) => {
                  setSelectedId(jobId);
                  setMode("job");
                }}
              />
            ) : !selected ? (
              <p className="font-mono text-sm text-steel-500">
                Submit a job or plan a project to see agent output.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-copper-800/40 pb-4">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-widest text-steel-500">
                      Job {selected.id.slice(0, 8)}
                      {selected.modelResolved
                        ? ` · ${selected.modelResolved}`
                        : ""}
                      {selected.agentProfile
                        ? ` · ${selected.agentProfile}`
                        : ""}
                    </p>
                    <p className="mt-1 text-sm text-copper-100">
                      {selected.prompt.slice(0, 280)}
                      {selected.prompt.length > 280 ? "…" : ""}
                    </p>
                    {selected.modelReason && (
                      <p className="mt-1 font-mono text-[10px] text-steel-500">
                        {selected.modelReason}
                      </p>
                    )}
                  </div>
                  <StatusPill status={selected.status} />
                </div>
                <div className="mt-5 max-h-[32rem] overflow-auto">
                  {selected.status === "queued" ||
                  selected.status === "claimed" ||
                  selected.status === "running" ? (
                    <p className="animate-pulse-soft font-mono text-sm text-copper-300">
                      Worker is on it
                      {selected.modelResolved
                        ? ` (${selected.modelResolved})`
                        : ""}
                      …
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

function ProjectPanel({
  project,
  busy,
  pendingCount,
  onRunNext,
  onSkip,
  onOpenJob,
}: {
  project: Project;
  busy: boolean;
  pendingCount: number;
  onRunNext: () => void;
  onSkip: (stepId: string) => void;
  onOpenJob: (jobId: string) => void;
}) {
  const inFlight =
    project.status === "planning" || project.status === "running";

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-copper-800/40 pb-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-steel-500">
            Project · {project.agentProfile}
          </p>
          <h2 className="mt-1 font-display text-2xl text-copper-50">
            {project.title}
          </h2>
          <p className="mt-2 text-sm text-steel-300">{project.goal}</p>
        </div>
        <StatusPill status={project.status} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={onRunNext}
          disabled={busy || inFlight || pendingCount === 0}
          className="rounded-none bg-copper-500 font-mono text-xs uppercase tracking-widest text-ink-950 hover:bg-copper-400 disabled:opacity-40"
        >
          {project.status === "planning"
            ? "Planning…"
            : pendingCount === 0
              ? "All steps done"
              : `Run next step · ${CREDITS_PER_JOB} cr`}
        </Button>
        <p className="font-mono text-[11px] text-steel-500">
          {project.steps.filter((s) => s.status === "completed").length}/
          {project.steps.length || "?"} complete
        </p>
      </div>

      <ol className="mt-6 space-y-3">
        {project.steps.length === 0 && (
          <li className="font-mono text-xs text-steel-500">
            {project.status === "planning"
              ? "Waiting for plan job…"
              : "No steps yet."}
          </li>
        )}
        {project.steps.map((step, index) => (
          <li
            key={step.id}
            className="border border-copper-800/40 bg-ink-950/40 px-3 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs text-copper-100">
                <StepMark status={step.status} /> {index + 1}. {step.title}
              </p>
              <StatusPill status={step.status} />
            </div>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-steel-400">
              {step.prompt}
            </p>
            {step.resultSummary && (
              <p className="mt-2 border-l border-copper-700/50 pl-2 font-mono text-[11px] text-steel-300">
                {step.resultSummary}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              {step.jobId && (
                <button
                  type="button"
                  onClick={() => onOpenJob(step.jobId!)}
                  className="font-mono text-[10px] uppercase tracking-widest text-copper-300 hover:text-copper-100"
                >
                  Open job
                </button>
              )}
              {step.status === "pending" && (
                <button
                  type="button"
                  disabled={busy || inFlight}
                  onClick={() => onSkip(step.id)}
                  className="font-mono text-[10px] uppercase tracking-widest text-steel-500 hover:text-steel-300 disabled:opacity-40"
                >
                  Skip
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function StepMark({ status }: { status: string }) {
  if (status === "completed")
    return <span className="text-emerald-300">[done]</span>;
  if (status === "running" || status === "queued")
    return <span className="text-copper-300">[run]</span>;
  if (status === "failed") return <span className="text-rose-300">[fail]</span>;
  if (status === "skipped")
    return <span className="text-steel-500">[skip]</span>;
  return <span className="text-steel-500">[ ]</span>;
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed" || status === "planned"
      ? "text-emerald-300"
      : status === "failed"
        ? "text-rose-300"
        : "text-copper-300";
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[10px] uppercase tracking-widest",
        tone,
      )}
    >
      {status}
    </span>
  );
}

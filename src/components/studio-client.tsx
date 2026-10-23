"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { SiteHeader } from "@/components/site-header";
import { priceJob } from "@/lib/job-pricing";
import { DEFAULT_MODEL_ID, MODEL_OPTIONS, resolveModel } from "@/lib/models";
import { cn } from "@/lib/utils";

type Account = {
  id: string;
  username?: string | null;
  walletAddress: string | null;
  credits: number;
  githubConnected?: boolean;
  githubLogin?: string | null;
};

type Project = {
  id: string;
  title: string;
  githubUrl?: string | null;
  githubRepo?: string | null;
  githubDefaultBranch?: string | null;
  githubOpenPr?: boolean;
  createdAt: string;
  updatedAt: string;
};

type Job = {
  id: string;
  projectId?: string | null;
  prompt: string;
  repoHint: string | null;
  modelRequested?: string;
  modelResolved?: string;
  modelReason?: string;
  status: string;
  creditsCharged: number;
  result: string | null;
  error: string | null;
  workspaceId?: string | null;
  workspaceFileCount?: number;
  githubBranch?: string | null;
  githubPrUrl?: string | null;
  createdAt: string;
  completedAt: string | null;
};

type GithubRepo = {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
};

type WorkspaceFile = { path: string; size: number };

export function StudioClient() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [prompt, setPrompt] = useState(
    "Scaffold a TypeScript CLI in this repo with README, package.json, src/index.ts, and a basic test. Make it a solid starter for future DAT STARCODER turns.",
  );
  const [repoHint, setRepoHint] = useState("");
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const authedRef = useRef<boolean | null>(null);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [panel, setPanel] = useState<"output" | "workspace">("output");
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [repoPick, setRepoPick] = useState("");
  const [githubUrlDraft, setGithubUrlDraft] = useState("");

  const refresh = useCallback(async () => {
    // Retry briefly — Amplify/S3 can return a transient 401 while a job
    // is being claimed/written.
    let res: Response | null = null;
    let data: { account?: Account; jobs?: Job[]; error?: string } = {};
    const jobsUrl = projectId
      ? `/api/jobs?projectId=${encodeURIComponent(projectId)}`
      : "/api/jobs";
    for (let i = 0; i < 4; i++) {
      res = await fetch(jobsUrl, { credentials: "same-origin" });
      data = await res.json();
      if (res.status !== 401) break;
      await new Promise((r) => window.setTimeout(r, 250));
    }
    if (!res || res.status === 401) {
      // Never kick mid-typing. Only force login on the initial load.
      if (authedRef.current !== true) {
        setAuthed(false);
        authedRef.current = false;
        router.replace("/account");
      } else {
        setSessionWarning(
          "Connection blip — still signed in. Retrying in the background…",
        );
      }
      return;
    }
    if (res.ok) {
      setSessionWarning(null);
      setAuthed(true);
      authedRef.current = true;
      setAccount(data.account ?? null);
      setJobs(data.jobs ?? []);
      if (!selectedId && data.jobs?.[0]) setSelectedId(data.jobs[0].id);
    }

    const pref = await fetch("/api/projects", { credentials: "same-origin" });
    if (pref.ok) {
      const pdata = await pref.json();
      setProjects(pdata.projects ?? []);
      if (!projectId && pdata.projects?.[0]) {
        setProjectId(pdata.projects[0].id);
      }
      if (pdata.account) setAccount(pdata.account);
    }

    const gh = await fetch("/api/github/status", { credentials: "same-origin" });
    if (gh.ok) {
      const gdata = await gh.json();
      setGithubConfigured(Boolean(gdata.configured));
      if (gdata.account) setAccount(gdata.account);
    }
  }, [selectedId, router, projectId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gh = params.get("github");
    if (!gh) return;
    if (gh === "connected") setSessionWarning("GitHub connected.");
    else if (gh === "denied") setError("GitHub authorization was denied.");
    else if (gh === "state" || gh === "error") {
      setError("GitHub connect failed — try again.");
    }
    router.replace("/studio");
  }, [router]);

  useEffect(() => {
    if (!account?.githubConnected) {
      setRepos([]);
      return;
    }
    void (async () => {
      const res = await fetch("/api/github/repos", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      setRepos(data.repos ?? []);
    })();
  }, [account?.githubConnected, account?.githubLogin]);

  const activeProject = projects.find((p) => p.id === projectId) ?? null;

  useEffect(() => {
    setGithubUrlDraft(activeProject?.githubUrl || activeProject?.githubRepo || "");
  }, [activeProject?.id, activeProject?.githubUrl, activeProject?.githubRepo]);

  async function saveGithubUrl(raw: string) {
    if (!projectId) {
      setError("Create or select a project before linking a GitHub repo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmed = raw.trim();
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUrl: trimmed || null,
          ...(trimmed ? {} : { githubRepo: null }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save GitHub URL");
      setProjects((prev) =>
        prev.map((p) => (p.id === data.project.id ? data.project : p)),
      );
      setGithubUrlDraft(
        data.project.githubUrl || data.project.githubRepo || "",
      );
      setSessionWarning(
        trimmed
          ? "GitHub repo saved. After each turn you'll get push commands in the result."
          : "GitHub repo cleared.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save GitHub URL failed");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectGithub() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/github/disconnect", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Disconnect failed");
      setAccount(data.account);
      setRepos([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  async function linkRepoToProject(fullName: string) {
    if (!projectId || !fullName) return;
    setBusy(true);
    setError(null);
    try {
      const repo = repos.find((r) => r.fullName === fullName);
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubRepo: fullName,
          githubDefaultBranch: repo?.defaultBranch || "main",
          githubOpenPr: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not link repo");
      setProjects((prev) =>
        prev.map((p) => (p.id === data.project.id ? data.project : p)),
      );
      setRepoPick(fullName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link repo failed");
    } finally {
      setBusy(false);
    }
  }

  async function createPlaygroundRepo() {
    setBusy(true);
    setError(null);
    try {
      let activeProjectId = projectId;
      if (!activeProjectId) {
        const created = await fetch("/api/projects", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "GitHub playground" }),
        });
        const pdata = await created.json();
        if (!created.ok) {
          throw new Error(pdata.error ?? "Could not create project");
        }
        activeProjectId = pdata.project.id as string;
        setProjectId(activeProjectId);
        setProjects((prev) => [pdata.project, ...prev]);
      }

      const res = await fetch("/api/github/repos", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `dat-starcoder-playground-${Date.now().toString(36).slice(-5)}`,
          projectId: activeProjectId,
          private: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create repo");
      if (data.project) {
        setProjects((prev) =>
          prev.map((p) => (p.id === data.project.id ? data.project : p)),
        );
      }
      setRepos((prev) => {
        const next = [data.repo, ...prev.filter((r) => r.fullName !== data.repo.fullName)];
        return next;
      });
      setRepoPick(data.repo.fullName);
      setSessionWarning(`Created and linked ${data.repo.fullName}`);
      setPrompt(
        "Turn this playground into a real TypeScript project: package.json, src/index.ts, README with How to run, and a small feature I can extend in follow-up turns. Open a clean PR-ready structure.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create repo failed");
    } finally {
      setBusy(false);
    }
  }

  const loadWorkspace = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}/workspace`, {
      credentials: "same-origin",
    });
    if (!res.ok) {
      setWorkspaceFiles([]);
      return;
    }
    const data = await res.json();
    setWorkspaceFiles(data.files ?? []);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setWorkspaceFiles([]);
      setPreviewPath(null);
      setPreviewContent(null);
      return;
    }
    void loadWorkspace(selectedId);
  }, [selectedId, jobs, loadWorkspace]);

  async function openFile(jobId: string, filePath: string) {
    setPreviewPath(filePath);
    setPreviewContent("Loading…");
    setPanel("workspace");
    const res = await fetch(
      `/api/jobs/${jobId}/workspace/file?path=${encodeURIComponent(filePath)}`,
      { credentials: "same-origin" },
    );
    const data = await res.json();
    if (!res.ok) {
      setPreviewContent(data.error ?? "Could not read file");
      return;
    }
    setPreviewContent(data.content);
  }

  async function createProject() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newProjectTitle.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create project");
      setNewProjectTitle("");
      setProjectId(data.project.id);
      setSelectedId(null);
      setJobs([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create project failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitJob() {
    setBusy(true);
    setError(null);
    try {
      let activeProjectId = projectId;
      if (!activeProjectId) {
        const created = await fetch("/api/projects", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: prompt.trim().slice(0, 48) || "New project",
          }),
        });
        const pdata = await created.json();
        if (!created.ok) {
          throw new Error(pdata.error ?? "Could not create project");
        }
        activeProjectId = pdata.project.id as string;
        setProjectId(activeProjectId);
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          repoHint,
          model: modelId,
          projectId: activeProjectId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to enqueue");
      setAccount(data.account);
      setSelectedId(data.job.id);
      setPanel("workspace");
      setPrompt("");
      // Optional demo fallback — only when explicitly enabled.
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

  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null;
  const selectedModel = MODEL_OPTIONS.find((m) => m.id === modelId);
  const resolvedForPrice = resolveModel(modelId, prompt);
  const turnPrice = priceJob({
    prompt,
    modelId: resolvedForPrice.resolved,
  });

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
        {sessionWarning && (
          <p className="mx-auto max-w-6xl px-5 pt-3 font-mono text-xs text-copper-300 md:px-10">
            {sessionWarning}
          </p>
        )}

        <main className="mx-auto grid max-w-6xl gap-8 px-5 pb-16 pt-4 md:grid-cols-[1fr_1.2fr] md:px-10">
          <section>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-copper-400">
              Coding studio
            </p>
            <h1 className="mt-2 font-display text-4xl tracking-tight md:text-5xl">
              Project agent
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-steel-300">
              Work in a persistent project. Each message is a turn — the agent
              can list, read, edit, and run commands in the same workspace.
              Paste a GitHub repo URL to clone it and get terminal push / PR
              commands when the turn finishes.
              {githubConfigured
                ? " Or connect GitHub for one-click pull requests."
                : ""}{" "}
              Cost depends on model and task difficulty (shown on Send).
            </p>

            {githubConfigured && (
              <div className="mt-8 border border-copper-800/50 bg-ink-900/60 p-4">
                <p className="font-mono text-[11px] uppercase tracking-widest text-steel-400">
                  GitHub
                </p>
                {!account?.githubConnected ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      asChild
                      className="rounded-none bg-copper-500 font-mono text-xs uppercase tracking-widest text-ink-950 hover:bg-copper-400"
                    >
                      <a href="/api/github/connect">Connect GitHub</a>
                    </Button>
                    <span className="font-mono text-[11px] text-steel-500">
                      Link a repo so the agent can open pull requests for you.
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <p className="font-mono text-xs text-copper-200">
                      Connected as @{account.githubLogin}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void createPlaygroundRepo()}
                        className="rounded-none border-copper-700 font-mono text-xs uppercase tracking-widest text-copper-100"
                      >
                        Create playground repo
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void disconnectGithub()}
                        className="rounded-none border-copper-800 font-mono text-xs uppercase tracking-widest text-steel-400"
                      >
                        Disconnect
                      </Button>
                    </div>
                    {projectId && (
                      <div>
                        <label className="block font-mono text-[11px] uppercase tracking-widest text-steel-500">
                          Link repo to this project
                        </label>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <select
                            value={repoPick || activeProject?.githubRepo || ""}
                            onChange={(e) => {
                              setRepoPick(e.target.value);
                              void linkRepoToProject(e.target.value);
                            }}
                            className="max-w-full rounded-none border border-copper-800/50 bg-ink-950 px-3 py-2 font-mono text-xs text-copper-100"
                          >
                            <option value="">Select a repository…</option>
                            {repos.map((r) => (
                              <option key={r.fullName} value={r.fullName}>
                                {r.fullName}
                                {r.private ? " (private)" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                        {activeProject?.githubRepo && (
                          <p className="mt-2 font-mono text-[11px] text-steel-400">
                            Linked: {activeProject.githubRepo} · base{" "}
                            {activeProject.githubDefaultBranch || "main"} · PR
                            on complete
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <label className="mt-8 block font-mono text-[11px] uppercase tracking-widest text-steel-400">
              Project
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProjectId(p.id);
                    setSelectedId(null);
                  }}
                  className={cn(
                    "rounded-none border px-3 py-2 font-mono text-[11px] uppercase tracking-widest transition",
                    projectId === p.id
                      ? "border-copper-400 bg-copper-900/50 text-copper-100"
                      : "border-copper-800/60 text-steel-400 hover:border-copper-600 hover:text-copper-200",
                  )}
                >
                  {p.title.slice(0, 28)}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input
                value={newProjectTitle}
                onChange={(e) => setNewProjectTitle(e.target.value)}
                placeholder="New project name"
                className="max-w-xs rounded-none border-copper-800/50 bg-ink-900/80 font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void createProject()}
                className="rounded-none border-copper-700 font-mono text-xs uppercase tracking-widest text-copper-100"
              >
                New project
              </Button>
            </div>

            <label className="mt-8 block font-mono text-[11px] uppercase tracking-widest text-steel-400">
              GitHub repo URL
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <Input
                value={githubUrlDraft}
                onChange={(e) => setGithubUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveGithubUrl(githubUrlDraft);
                  }
                }}
                placeholder="https://github.com/owner/repo or owner/repo"
                disabled={!projectId || busy}
                className="min-w-[16rem] flex-1 rounded-none border-copper-800/50 bg-ink-900/80 font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!projectId || busy}
                onClick={() => void saveGithubUrl(githubUrlDraft)}
                className="rounded-none border-copper-700 font-mono text-xs uppercase tracking-widest text-copper-100"
              >
                Save
              </Button>
            </div>
            <p className="mt-2 font-mono text-[11px] text-steel-500">
              Public repos are cloned for the agent. After each turn the result
              includes exact <code className="text-copper-300">git</code> /{" "}
              <code className="text-copper-300">gh</code> commands to push a
              branch and open a PR (plus Workspace zip). Private repos: paste
              the URL anyway — build in Studio, push from your machine.
            </p>
            {activeProject?.githubUrl && (
              <p className="mt-1 font-mono text-[11px] text-steel-400">
                Linked: {activeProject.githubUrl}
                {activeProject.githubDefaultBranch
                  ? ` · base ${activeProject.githubDefaultBranch}`
                  : ""}
              </p>
            )}

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

            <label className="mt-6 block font-mono text-[11px] uppercase tracking-widest text-steel-400">
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

            <p className="mt-4 font-mono text-[11px] text-steel-500">
              Turns in this project share one workspace. Ask follow-ups like
              “how do I play?” or “add a score” without starting over.
            </p>

            <p className="mt-4 font-mono text-[11px] text-steel-400">
              This turn:{" "}
              <span className="text-copper-200">{turnPrice.total} credits</span>
              {turnPrice.hardDomain ? " · hard domain" : ""}
              {turnPrice.modelMultiplier > 1
                ? ` · ${resolvedForPrice.resolved} ×${turnPrice.modelMultiplier}`
                : ""}
              {account != null && account.credits < turnPrice.total ? (
                <span className="text-rose-300">
                  {" "}
                  · need {turnPrice.total - account.credits} more
                </span>
              ) : null}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={submitJob}
                disabled={busy || (account != null && account.credits < turnPrice.total)}
                className="rounded-none bg-copper-500 font-mono text-xs uppercase tracking-widest text-ink-950 hover:bg-copper-400"
              >
                {busy ? "Queuing…" : `Send turn · ${turnPrice.total} cr`}
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
                    <p className="mt-1 truncate font-mono text-[10px] text-steel-500">
                      {job.creditsCharged ? `${job.creditsCharged} cr` : ""}
                      {job.modelResolved
                        ? `${job.creditsCharged ? " · " : ""}${job.modelRequested === "auto" ? "auto → " : ""}${job.modelResolved}`
                        : ""}
                      {typeof job.workspaceFileCount === "number" &&
                      job.workspaceFileCount > 0
                        ? ` · ${job.workspaceFileCount} files`
                        : ""}
                      {typeof job.stepsUsed === "number"
                        ? ` · ${job.stepsUsed} steps`
                        : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="min-h-[28rem] border border-copper-800/40 bg-ink-900/50 p-5 md:p-6">
            {!selected ? (
              <p className="font-mono text-sm text-steel-500">
                Submit a job to see agent output and your workspace.
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
                    </p>
                    <p className="mt-1 text-sm text-copper-100">
                      {selected.prompt}
                    </p>
                    {selected.modelReason && (
                      <p className="mt-1 font-mono text-[10px] text-steel-500">
                        {selected.modelReason}
                      </p>
                    )}
                  </div>
                  <StatusPill status={selected.status} />
                </div>
                {(selected.githubPrUrl || selected.githubBranch) && (
                  <p className="mt-3 font-mono text-xs text-copper-300">
                    {selected.githubPrUrl ? (
                      <a
                        href={selected.githubPrUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-copper-700 underline-offset-4 hover:text-copper-100"
                      >
                        Open pull request
                      </a>
                    ) : (
                      <>Branch {selected.githubBranch}</>
                    )}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPanel("output")}
                    className={cn(
                      "font-mono text-[11px] uppercase tracking-widest",
                      panel === "output"
                        ? "text-copper-200"
                        : "text-steel-500 hover:text-copper-300",
                    )}
                  >
                    Output
                  </button>
                  <span className="text-steel-700">·</span>
                  <button
                    type="button"
                    onClick={() => setPanel("workspace")}
                    className={cn(
                      "font-mono text-[11px] uppercase tracking-widest",
                      panel === "workspace"
                        ? "text-copper-200"
                        : "text-steel-500 hover:text-copper-300",
                    )}
                  >
                    Workspace ({workspaceFiles.length})
                  </button>
                  {workspaceFiles.length > 0 && (
                    <a
                      href={`/api/jobs/${selected.id}/workspace/download`}
                      className="ml-auto font-mono text-[11px] uppercase tracking-widest text-copper-400 hover:text-copper-200"
                    >
                      Download zip
                    </a>
                  )}
                </div>

                <div className="mt-5 max-h-[32rem] overflow-auto">
                  {panel === "output" ? (
                    selected.status === "queued" ||
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
                    )
                  ) : (
                    <div className="grid gap-4 md:grid-cols-[11rem_1fr]">
                      <ul className="space-y-1 border-r border-copper-900/60 pr-3">
                        {workspaceFiles.length === 0 && (
                          <li className="font-mono text-[11px] text-steel-500">
                            Workspace seeding…
                          </li>
                        )}
                        {workspaceFiles.map((file) => (
                          <li key={file.path}>
                            <button
                              type="button"
                              onClick={() => openFile(selected.id, file.path)}
                              className={cn(
                                "w-full truncate text-left font-mono text-[11px]",
                                previewPath === file.path
                                  ? "text-copper-200"
                                  : "text-steel-400 hover:text-copper-300",
                              )}
                              title={file.path}
                            >
                              {file.path}
                            </button>
                          </li>
                        ))}
                      </ul>
                      <pre className="min-h-[12rem] whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-steel-200">
                        {previewContent ??
                          "Select a file to preview. Download the zip to use the full project locally."}
                      </pre>
                    </div>
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

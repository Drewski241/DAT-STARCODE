import { decryptSecret } from "@/lib/github-crypto";
import type { Account, Project } from "@/lib/types";

export type GithubRepoSummary = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  description: string | null;
};

export type GithubJobContext = {
  token: string;
  login: string;
  repoFullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  openPr: boolean;
};

export function githubConfigured() {
  return Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() &&
      process.env.GITHUB_CLIENT_SECRET?.trim(),
  );
}

export function githubClientId() {
  return process.env.GITHUB_CLIENT_ID?.trim() || "";
}

export function githubClientSecret() {
  return process.env.GITHUB_CLIENT_SECRET?.trim() || "";
}

export function githubRedirectUri(reqUrl: string) {
  const configured = process.env.GITHUB_REDIRECT_URI?.trim();
  if (configured) return configured;
  const u = new URL(reqUrl);
  return `${u.origin}/api/github/callback`;
}

export function githubAuthorizeUrl(input: {
  state: string;
  redirectUri: string;
}) {
  const params = new URLSearchParams({
    client_id: githubClientId(),
    redirect_uri: input.redirectUri,
    scope: "repo read:user",
    state: input.state,
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeGithubCode(input: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; scope: string }> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: githubClientId(),
      client_secret: githubClientSecret(),
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "GitHub token exchange failed",
    );
  }
  return { accessToken: data.access_token, scope: data.scope || "" };
}

async function ghFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DAT-STARCODER",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text };
  }
  if (!res.ok) {
    const msg =
      typeof json === "object" &&
      json &&
      "message" in json &&
      typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : `GitHub API ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export async function githubGetUser(token: string) {
  return ghFetch<{ login: string; id: number; html_url: string; name: string | null }>(
    token,
    "/user",
  );
}

export async function githubListRepos(token: string): Promise<GithubRepoSummary[]> {
  const rows = await ghFetch<
    {
      id: number;
      name: string;
      full_name: string;
      private: boolean;
      default_branch: string;
      html_url: string;
      description: string | null;
      owner: { login: string };
    }[]
  >(token, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator");
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    defaultBranch: r.default_branch,
    htmlUrl: r.html_url,
    description: r.description,
  }));
}

export async function githubCreateRepo(
  token: string,
  input: { name: string; description?: string; private?: boolean },
) {
  const created = await ghFetch<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
    html_url: string;
    description: string | null;
    owner: { login: string };
  }>(token, "/user/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      description:
        input.description ||
        "DAT STARCODER playground — agent opens PRs against this repo",
      private: Boolean(input.private),
      auto_init: true,
    }),
  });
  return {
    id: created.id,
    fullName: created.full_name,
    name: created.name,
    owner: created.owner.login,
    private: created.private,
    defaultBranch: created.default_branch || "main",
    htmlUrl: created.html_url,
    description: created.description,
  } satisfies GithubRepoSummary;
}

export function parseRepoFullName(fullName: string): {
  owner: string;
  name: string;
} | null {
  const m = fullName.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}

/** Accepts owner/name or https://github.com/owner/repo(.git) */
export function parseGithubRepoInput(raw: string): {
  owner: string;
  name: string;
  httpsUrl: string;
  fullName: string;
} | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  let owner = "";
  let name = "";
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/i,
  );
  if (urlMatch) {
    owner = urlMatch[1];
    name = urlMatch[2];
  } else {
    const simple = parseRepoFullName(trimmed);
    if (!simple) return null;
    owner = simple.owner;
    name = simple.name;
  }
  if (!owner || !name) return null;
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    httpsUrl: `https://github.com/${owner}/${name}.git`,
  };
}

export function normalizeGithubUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const parsed = parseGithubRepoInput(raw);
  return parsed ? `https://github.com/${parsed.fullName}` : null;
}

/** Clone hint for the worker when the user pasted a URL (no OAuth token). */
export function buildGithubCloneHint(
  project: Project | null,
  jobGithubUrl?: string | null,
): {
  httpsUrl: string;
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
} | null {
  const raw = jobGithubUrl || project?.githubUrl || project?.githubRepo;
  if (!raw) return null;
  const parsed = parseGithubRepoInput(raw);
  if (!parsed) return null;
  return {
    httpsUrl: parsed.httpsUrl,
    fullName: parsed.fullName,
    owner: parsed.owner,
    name: parsed.name,
    defaultBranch: project?.githubDefaultBranch || "main",
  };
}

/** Build worker-facing GitHub context for a claimed job (token decrypted). */
export function buildGithubJobContext(
  account: Account,
  project: Project | null,
): GithubJobContext | null {
  if (!account.githubTokenEnc || !account.githubLogin) return null;
  if (!project?.githubRepo) return null;
  const parsed = parseRepoFullName(project.githubRepo);
  if (!parsed) return null;
  let token: string;
  try {
    token = decryptSecret(account.githubTokenEnc);
  } catch {
    return null;
  }
  return {
    token,
    login: account.githubLogin,
    repoFullName: project.githubRepo,
    owner: parsed.owner,
    name: parsed.name,
    defaultBranch: project.githubDefaultBranch || "main",
    openPr: project.githubOpenPr !== false,
  };
}

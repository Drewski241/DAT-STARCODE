import { NextRequest, NextResponse } from "next/server";
import { decryptSecret } from "@/lib/github-crypto";
import {
  githubCreateRepo,
  githubListRepos,
  parseRepoFullName,
} from "@/lib/github";
import { toPublicAccount } from "@/lib/account-public";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { updateProjectGithub } from "@/lib/store";

export async function GET() {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  if (!auth.account.githubTokenEnc) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 400 });
  }
  try {
    const token = decryptSecret(auth.account.githubTokenEnc);
    const repos = await githubListRepos(token);
    return NextResponse.json({
      account: toPublicAccount(auth.account),
      repos,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "List repos failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Create a playground repo on the user's GitHub and optionally link a project. */
export async function POST(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  if (!auth.account.githubTokenEnc) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    private?: boolean;
    projectId?: string;
  };

  const name =
    body.name?.trim() ||
    `dat-starcoder-playground-${Date.now().toString(36).slice(-4)}`;
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid repo name" }, { status: 400 });
  }

  try {
    const token = decryptSecret(auth.account.githubTokenEnc);
    const repo = await githubCreateRepo(token, {
      name,
      description: body.description,
      private: body.private,
    });

    let project = null;
    if (body.projectId) {
      const parsed = parseRepoFullName(repo.fullName);
      project = await updateProjectGithub(body.projectId, auth.account.id, {
        githubRepo: repo.fullName,
        githubDefaultBranch: repo.defaultBranch,
        githubOpenPr: true,
      });
      void parsed;
    }

    return NextResponse.json({
      account: toPublicAccount(auth.account),
      repo,
      project,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create repo failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

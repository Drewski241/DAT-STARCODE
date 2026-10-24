import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import {
  normalizeGithubUrl,
  parseGithubRepoInput,
  parseRepoFullName,
} from "@/lib/github";
import { requireRegisteredAccount } from "@/lib/require-auth";
import {
  getProject,
  listJobsForProject,
  updateProjectGithub,
} from "@/lib/store";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project || project.accountId !== auth.account.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const jobs = await listJobsForProject(id);
  return NextResponse.json({
    account: toPublicAccount(auth.account),
    project,
    jobs,
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    githubUrl?: string | null;
    githubRepo?: string | null;
    githubDefaultBranch?: string | null;
    githubOpenPr?: boolean;
  };

  let githubUrl: string | null | undefined = undefined;
  if (body.githubUrl !== undefined) {
    if (body.githubUrl === null || body.githubUrl === "") {
      githubUrl = null;
    } else {
      const normalized = normalizeGithubUrl(body.githubUrl);
      if (!normalized) {
        return NextResponse.json(
          {
            error:
              "githubUrl must be https://github.com/owner/repo or owner/repo",
          },
          { status: 400 },
        );
      }
      githubUrl = normalized;
    }
  }

  let githubRepo = body.githubRepo;
  if (typeof githubRepo === "string") {
    githubRepo = githubRepo.trim() || null;
  }
  if (githubRepo) {
    const parsed = parseRepoFullName(githubRepo);
    if (!parsed) {
      return NextResponse.json(
        { error: "githubRepo must look like owner/name" },
        { status: 400 },
      );
    }
  }

  // Pasting a URL also fills githubRepo for downstream helpers.
  if (githubUrl) {
    const parsed = parseGithubRepoInput(githubUrl);
    if (parsed && githubRepo === undefined) {
      githubRepo = parsed.fullName;
    }
  }

  try {
    const project = await updateProjectGithub(id, auth.account.id, {
      githubUrl,
      githubRepo: githubRepo === undefined ? undefined : githubRepo,
      githubDefaultBranch: body.githubDefaultBranch,
      githubOpenPr: body.githubOpenPr,
    });
    return NextResponse.json({
      account: toPublicAccount(auth.account),
      project,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

import { promises as fs } from "fs";
import path from "path";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import JSZip from "jszip";
import type { CodingJob } from "@/lib/types";
import {
  extractFilesFromMarkdown,
  isSafeWorkspacePath,
  normalizePath,
  type ExtractedFile,
} from "@/lib/extract-files";
import { awsClientConfig } from "@/lib/aws-creds";
import { resolveWorkspaceBucket } from "@/lib/s3-bucket";

const DATA_DIR =
  process.env.DAT_STARCODER_DATA_DIR ??
  process.env.ANVIL_DATA_DIR ??
  path.join(process.cwd(), ".data");

/** Sync env peek only — prefer resolveWorkspaceBucket() for real use. */
export function getWorkspaceS3Bucket(): string {
  return (process.env["WORKSPACE_S3_BUCKET"] ?? "").trim();
}

/** @deprecated Prefer resolveWorkspaceBucket() */
export const WORKSPACE_S3_BUCKET = getWorkspaceS3Bucket();

let s3Client: S3Client | null = null;

async function getS3(): Promise<{ client: S3Client; bucket: string } | null> {
  const resolved = await resolveWorkspaceBucket();
  if (!resolved.bucket) return null;
  if (!s3Client) {
    s3Client = new S3Client(awsClientConfig());
  }
  return { client: s3Client, bucket: resolved.bucket };
}

export type WorkspaceFileInfo = {
  path: string;
  size: number;
};

export type WorkspaceRef = { accountId: string; key: string };

type WorkspaceJob = Pick<
  CodingJob,
  "accountId" | "id" | "projectId" | "workspaceId"
>;

/** Resolve storage root: project workspaces persist across turns. */
export function workspaceRefForJob(job: WorkspaceJob): WorkspaceRef {
  if (job.workspaceId) {
    const prefix = `${job.accountId}/`;
    if (job.workspaceId.startsWith(prefix)) {
      return {
        accountId: job.accountId,
        key: job.workspaceId.slice(prefix.length),
      };
    }
    return { accountId: job.accountId, key: job.workspaceId };
  }
  if (job.projectId) {
    return { accountId: job.accountId, key: `projects/${job.projectId}` };
  }
  return { accountId: job.accountId, key: job.id };
}

export function workspacePrefix(job: WorkspaceJob) {
  const ref = workspaceRefForJob(job);
  return `${ref.accountId}/${ref.key}`;
}

function localRoot(job: WorkspaceJob) {
  const ref = workspaceRefForJob(job);
  return path.join(DATA_DIR, "workspaces", ref.accountId, ...ref.key.split("/"));
}

function s3Key(job: WorkspaceJob, relPath: string) {
  return `${workspacePrefix(job)}/${relPath}`;
}

async function streamToString(
  body: { transformToString?: () => Promise<string> } | undefined,
): Promise<string> {
  if (!body) return "";
  if (typeof body.transformToString === "function") {
    return body.transformToString();
  }
  return "";
}

export async function initWorkspace(job: CodingJob): Promise<void> {
  const existing = await listWorkspaceFiles(job);
  const turnMeta = {
    id: job.id,
    accountId: job.accountId,
    projectId: job.projectId,
    prompt: job.prompt,
    repoHint: job.repoHint,
    modelRequested: job.modelRequested,
    modelResolved: job.modelResolved,
    modelReason: job.modelReason,
    createdAt: job.createdAt,
  };

  // Project workspaces persist — don't clobber files on later turns.
  if (existing.length > 0) {
    await writeWorkspaceFiles(job, [
      {
        path: `turns/${job.id}.json`,
        content: JSON.stringify(turnMeta, null, 2),
      },
    ]);
    return;
  }

  const readme = [
    `# DAT STARCODER workspace`,
    ``,
    job.projectId ? `Project: ${job.projectId}` : `Job: ${job.id}`,
    `Created: ${job.createdAt}`,
    ``,
    `## Request`,
    ``,
    job.prompt,
    ``,
    job.repoHint ? `## Repo hint\n\n${job.repoHint}\n` : "",
    `## Model`,
    ``,
    `${job.modelRequested} → ${job.modelResolved}`,
    job.modelReason ? `\n${job.modelReason}` : "",
    ``,
    `This folder is your project workspace. Later prompts in the same project`,
    `edit these files in place. Download the zip from Studio anytime.`,
    ``,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  await writeWorkspaceFiles(job, [
    { path: "README.md", content: readme },
    {
      path: "job.json",
      content: JSON.stringify(turnMeta, null, 2),
    },
  ]);
}

/** Copy prior job files into a new job workspace (follow-ups). */
export async function copyWorkspaceFromJob(
  from: WorkspaceJob,
  to: WorkspaceJob,
): Promise<number> {
  const listed = await listWorkspaceFiles(from);
  const files: ExtractedFile[] = [];
  for (const info of listed) {
    if (info.path === "job.json") continue;
    const content = await readWorkspaceFile(from, info.path);
    if (content == null) continue;
    files.push({ path: info.path, content });
  }
  if (files.length === 0) return 0;
  await writeWorkspaceFiles(to, files);
  return files.length;
}

export async function writeWorkspaceFiles(
  job: WorkspaceJob,
  files: ExtractedFile[],
): Promise<WorkspaceFileInfo[]> {
  const written: WorkspaceFileInfo[] = [];
  for (const file of files) {
    const rel = normalizePath(file.path);
    if (!isSafeWorkspacePath(rel)) continue;
    const size = Buffer.byteLength(file.content, "utf8");
    const s3 = await getS3();
    if (s3) {
      await s3.client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: s3Key(job, rel),
          Body: file.content,
          ContentType: contentTypeFor(rel),
        }),
      );
    } else {
      const full = path.join(localRoot(job), rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, file.content, "utf8");
    }
    written.push({ path: rel, size });
  }
  return written;
}

/**
 * Remove paths from the job/project workspace (S3 or local).
 * Used when the worker agent deletes files that were previously synced.
 */
export async function deleteWorkspaceFiles(
  job: WorkspaceJob,
  paths: string[],
): Promise<string[]> {
  const deleted: string[] = [];
  const safe = paths
    .map((p) => normalizePath(p))
    .filter((rel) => isSafeWorkspacePath(rel));
  if (safe.length === 0) return deleted;

  const s3 = await getS3();
  if (s3) {
    // DeleteObjects accepts up to 1000 keys per call.
    for (let i = 0; i < safe.length; i += 1000) {
      const chunk = safe.slice(i, i + 1000);
      const res = await s3.client.send(
        new DeleteObjectsCommand({
          Bucket: s3.bucket,
          Delete: {
            Objects: chunk.map((rel) => ({ Key: s3Key(job, rel) })),
            Quiet: true,
          },
        }),
      );
      const failed = new Set(
        (res.Errors ?? []).map((e) => e.Key).filter(Boolean) as string[],
      );
      for (const rel of chunk) {
        if (!failed.has(s3Key(job, rel))) deleted.push(rel);
      }
    }
    return deleted;
  }

  for (const rel of safe) {
    const full = path.join(localRoot(job), rel);
    try {
      await fs.rm(full, { force: true });
      deleted.push(rel);
    } catch {
      /* ignore missing */
    }
  }
  return deleted;
}

export async function materializeWorkspaceFromResult(
  job: CodingJob,
  result: string,
  explicitFiles?: ExtractedFile[] | null,
): Promise<{ files: WorkspaceFileInfo[]; count: number }> {
  const fromExplicit = (explicitFiles ?? [])
    .map((f) => ({ path: normalizePath(f.path), content: f.content }))
    .filter((f) => isSafeWorkspacePath(f.path));

  const fromMarkdown = extractFilesFromMarkdown(result);
  const merged = new Map<string, string>();
  for (const f of fromMarkdown) merged.set(f.path, f.content);
  for (const f of fromExplicit) merged.set(f.path, f.content);

  // Always keep a copy of the full agent transcript in the workspace.
  merged.set("RESULT.md", result);

  // Do NOT seed src/main.ts when there are no code fences — that polluted
  // everyday Q&A / advice turns with a fake TypeScript starter.

  const files = [...merged.entries()].map(([p, content]) => ({
    path: p,
    content,
  }));
  await writeWorkspaceFiles(job, files);
  const listed = await listWorkspaceFiles(job);
  return { files: listed, count: listed.length };
}

export async function listWorkspaceFiles(
  job: WorkspaceJob,
): Promise<WorkspaceFileInfo[]> {
  const s3 = await getS3();
  if (s3) {
    const prefix = `${workspacePrefix(job)}/`;
    const out: WorkspaceFileInfo[] = [];
    let token: string | undefined;
    do {
      const res = await s3.client.send(
        new ListObjectsV2Command({
          Bucket: s3.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key || obj.Key.endsWith("/")) continue;
        const rel = obj.Key.slice(prefix.length);
        if (!isSafeWorkspacePath(rel)) continue;
        out.push({ path: rel, size: obj.Size ?? 0 });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  const root = localRoot(job);
  try {
    return await walkLocal(root, root);
  } catch {
    return [];
  }
}

async function walkLocal(
  root: string,
  dir: string,
): Promise<WorkspaceFileInfo[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: WorkspaceFileInfo[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkLocal(root, full)));
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = normalizePath(path.relative(root, full));
    if (!isSafeWorkspacePath(rel)) continue;
    const stat = await fs.stat(full);
    files.push({ path: rel, size: stat.size });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readWorkspaceFile(
  job: WorkspaceJob,
  relPath: string,
): Promise<string | null> {
  const rel = normalizePath(relPath);
  if (!isSafeWorkspacePath(rel)) return null;

  const s3 = await getS3();
  if (s3) {
    try {
      const res = await s3.client.send(
        new GetObjectCommand({
          Bucket: s3.bucket,
          Key: s3Key(job, rel),
        }),
      );
      return await streamToString(res.Body as { transformToString?: () => Promise<string> });
    } catch {
      return null;
    }
  }

  try {
    const full = path.join(localRoot(job), rel);
    const resolved = path.resolve(full);
    const root = path.resolve(localRoot(job));
    if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
    return await fs.readFile(resolved, "utf8");
  } catch {
    return null;
  }
}

export async function buildWorkspaceZip(
  job: WorkspaceJob,
): Promise<Buffer> {
  const files = await listWorkspaceFiles(job);
  const zip = new JSZip();
  for (const file of files) {
    const content = await readWorkspaceFile(job, file.path);
    if (content == null) continue;
    zip.file(file.path, content);
  }
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Promise<Buffer>;
}

export async function clearWorkspace(
  job: WorkspaceJob,
): Promise<void> {
  const s3 = await getS3();
  if (s3) {
    const files = await listWorkspaceFiles(job);
    if (files.length === 0) return;
    await s3.client.send(
      new DeleteObjectsCommand({
        Bucket: s3.bucket,
        Delete: {
          Objects: files.map((f) => ({ Key: s3Key(job, f.path) })),
        },
      }),
    );
    return;
  }
  await fs.rm(localRoot(job), { recursive: true, force: true });
}

function contentTypeFor(relPath: string): string {
  if (relPath.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (relPath.endsWith(".json")) return "application/json; charset=utf-8";
  if (relPath.endsWith(".ts") || relPath.endsWith(".tsx"))
    return "text/typescript; charset=utf-8";
  if (relPath.endsWith(".js") || relPath.endsWith(".jsx"))
    return "text/javascript; charset=utf-8";
  if (relPath.endsWith(".py")) return "text/x-python; charset=utf-8";
  if (relPath.endsWith(".css")) return "text/css; charset=utf-8";
  if (relPath.endsWith(".html")) return "text/html; charset=utf-8";
  return "text/plain; charset=utf-8";
}

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

const DATA_DIR =
  process.env.DAT_STARCODER_DATA_DIR ??
  process.env.ANVIL_DATA_DIR ??
  path.join(process.cwd(), ".data");

export const WORKSPACE_S3_BUCKET =
  process.env.WORKSPACE_S3_BUCKET?.trim() || "";

function awsRegion() {
  // Amplify forbids custom env vars starting with AWS_; it injects AWS_REGION itself.
  return (
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    process.env.STARCODER_AWS_REGION ??
    "us-east-1"
  );
}

const s3 = WORKSPACE_S3_BUCKET
  ? new S3Client({
      region: awsRegion(),
    })
  : null;

export type WorkspaceFileInfo = {
  path: string;
  size: number;
};

export function workspacePrefix(job: Pick<CodingJob, "accountId" | "id">) {
  return `${job.accountId}/${job.id}`;
}

function localRoot(job: Pick<CodingJob, "accountId" | "id">) {
  return path.join(DATA_DIR, "workspaces", job.accountId, job.id);
}

function s3Key(job: Pick<CodingJob, "accountId" | "id">, relPath: string) {
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
  const readme = [
    `# DAT STARCODER workspace`,
    ``,
    `Job: ${job.id}`,
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
    `Files the agent creates for this job appear in this folder.`,
    `Download the zip from the studio when the job completes.`,
    ``,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  await writeWorkspaceFiles(job, [
    { path: "README.md", content: readme },
    {
      path: "job.json",
      content: JSON.stringify(
        {
          id: job.id,
          accountId: job.accountId,
          prompt: job.prompt,
          repoHint: job.repoHint,
          modelRequested: job.modelRequested,
          modelResolved: job.modelResolved,
          modelReason: job.modelReason,
          createdAt: job.createdAt,
        },
        null,
        2,
      ),
    },
  ]);
}

/** Copy prior job files into a new job workspace (follow-ups). */
export async function copyWorkspaceFromJob(
  from: Pick<CodingJob, "accountId" | "id">,
  to: Pick<CodingJob, "accountId" | "id">,
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
  job: Pick<CodingJob, "accountId" | "id">,
  files: ExtractedFile[],
): Promise<WorkspaceFileInfo[]> {
  const written: WorkspaceFileInfo[] = [];
  for (const file of files) {
    const rel = normalizePath(file.path);
    if (!isSafeWorkspacePath(rel)) continue;
    const size = Buffer.byteLength(file.content, "utf8");
    if (s3 && WORKSPACE_S3_BUCKET) {
      await s3.send(
        new PutObjectCommand({
          Bucket: WORKSPACE_S3_BUCKET,
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

  if (merged.size === 1) {
    // No code fences found — seed a starter file customers can open.
    merged.set(
      "src/main.ts",
      [
        `/**`,
        ` * DAT STARCODER starter for job ${job.id.slice(0, 8)}`,
        ` * Paste or refine the implementation from RESULT.md.`,
        ` */`,
        `export function main() {`,
        `  console.log(${JSON.stringify(job.prompt.slice(0, 120))});`,
        `}`,
        ``,
        `main();`,
        ``,
      ].join("\n"),
    );
  }

  const files = [...merged.entries()].map(([p, content]) => ({
    path: p,
    content,
  }));
  await writeWorkspaceFiles(job, files);
  const listed = await listWorkspaceFiles(job);
  return { files: listed, count: listed.length };
}

export async function listWorkspaceFiles(
  job: Pick<CodingJob, "accountId" | "id">,
): Promise<WorkspaceFileInfo[]> {
  if (s3 && WORKSPACE_S3_BUCKET) {
    const prefix = `${workspacePrefix(job)}/`;
    const out: WorkspaceFileInfo[] = [];
    let token: string | undefined;
    do {
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: WORKSPACE_S3_BUCKET,
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
  job: Pick<CodingJob, "accountId" | "id">,
  relPath: string,
): Promise<string | null> {
  const rel = normalizePath(relPath);
  if (!isSafeWorkspacePath(rel)) return null;

  if (s3 && WORKSPACE_S3_BUCKET) {
    try {
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: WORKSPACE_S3_BUCKET,
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
  job: Pick<CodingJob, "accountId" | "id">,
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
  job: Pick<CodingJob, "accountId" | "id">,
): Promise<void> {
  if (s3 && WORKSPACE_S3_BUCKET) {
    const files = await listWorkspaceFiles(job);
    if (files.length === 0) return;
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: WORKSPACE_S3_BUCKET,
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

import {
  buildWorkspaceZip,
  clearWorkspace,
  initWorkspace,
  listWorkspaceFiles,
  materializeWorkspaceFromResult,
} from "../src/lib/workspace";
import type { CodingJob } from "../src/lib/types";

async function main() {
  const job: CodingJob = {
    id: "11111111-2222-3333-4444-555555555555",
    accountId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    prompt: "Build a hello world CLI",
    repoHint: null,
    parentJobId: null,
    context: null,
    modelRequested: "auto",
    modelResolved: "qwen2.5-coder:7b",
    modelReason: "test",
    status: "running",
    creditsCharged: 5,
    result: null,
    error: null,
    workerId: "test",
    workspaceId:
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/11111111-2222-3333-4444-555555555555",
    workspaceFileCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };

  await clearWorkspace(job);
  await initWorkspace(job);
  const result = [
    "### File: src/hello.ts",
    "```ts",
    'export const msg = "hi";',
    "```",
  ].join("\n");
  const mat = await materializeWorkspaceFromResult(job, result);
  const files = await listWorkspaceFiles(job);
  const zip = await buildWorkspaceZip(job);
  console.log(
    JSON.stringify(
      {
        count: mat.count,
        files: files.map((f) => f.path),
        zipBytes: zip.length,
      },
      null,
      2,
    ),
  );
  if (!files.some((f) => f.path === "src/hello.ts")) {
    throw new Error("missing hello");
  }
  if (zip.length < 100) throw new Error("zip too small");
  await clearWorkspace(job);
  console.log("workspace smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

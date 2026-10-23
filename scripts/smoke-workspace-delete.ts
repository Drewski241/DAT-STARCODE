import {
  clearWorkspace,
  deleteWorkspaceFiles,
  initWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFiles,
} from "../src/lib/workspace";
import type { CodingJob } from "../src/lib/types";

async function main() {
  const job: CodingJob = {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    accountId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    prompt: "t",
    projectId: null,
    repoHint: null,
    githubUrl: null,
    parentJobId: null,
    context: null,
    modelRequested: "auto",
    modelResolved: "qwen2.5-coder:7b",
    modelReason: "t",
    status: "running",
    creditsCharged: 5,
    stepsUsed: null,
    result: null,
    error: null,
    workerId: "t",
    workspaceId:
      "cccccccc-cccc-cccc-cccc-cccccccccccc/dddddddd-dddd-dddd-dddd-dddddddddddd",
    workspaceFileCount: 0,
    githubBranch: null,
    githubPrUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };

  await clearWorkspace(job);
  await initWorkspace(job);
  await writeWorkspaceFiles(job, [
    { path: "pool_coin.py", content: "print(1)\n" },
    { path: "keep.txt", content: "ok\n" },
  ]);
  let listed = await listWorkspaceFiles(job);
  if (!listed.some((f) => f.path === "pool_coin.py")) {
    throw new Error("missing pool_coin");
  }
  const deleted = await deleteWorkspaceFiles(job, ["pool_coin.py"]);
  if (!deleted.includes("pool_coin.py")) throw new Error("delete failed");
  listed = await listWorkspaceFiles(job);
  if (listed.some((f) => f.path === "pool_coin.py")) {
    throw new Error("still there");
  }
  if ((await readWorkspaceFile(job, "keep.txt")) !== "ok\n") {
    throw new Error("keep gone");
  }
  await clearWorkspace(job);
  console.log("deleteWorkspaceFiles smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

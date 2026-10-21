import { NextRequest, NextResponse } from "next/server";
import { getWorkerApiKey } from "@/lib/config";
import { claimNextJob, markJobRunning } from "@/lib/store";

function authorize(req: NextRequest) {
  const key = req.headers.get("x-worker-key")?.trim();
  return Boolean(key && key === getWorkerApiKey());
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as { workerId?: string };
  if (!body.workerId) {
    return NextResponse.json({ error: "workerId required" }, { status: 400 });
  }

  const job = await claimNextJob(body.workerId);
  if (!job) {
    return NextResponse.json({ job: null });
  }
  await markJobRunning(job.id, body.workerId);
  return NextResponse.json({ job: { ...job, status: "running" } });
}

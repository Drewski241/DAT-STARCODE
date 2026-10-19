import { NextRequest, NextResponse } from "next/server";
import { WORKER_API_KEY } from "@/lib/config";
import { completeJob } from "@/lib/store";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-worker-key");
  if (!key || key !== WORKER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    jobId?: string;
    workerId?: string;
    result?: string;
    error?: string;
  };

  if (!body.jobId || !body.workerId) {
    return NextResponse.json(
      { error: "jobId and workerId required" },
      { status: 400 },
    );
  }

  try {
    const job = await completeJob({
      jobId: body.jobId,
      workerId: body.workerId,
      result: body.result,
      error: body.error,
    });
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Complete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

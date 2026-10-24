import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { WORKER_API_KEY } from "@/lib/config";
import { appendJobEvent, getJob } from "@/lib/store";
import { pushLiveEvent } from "@/lib/job-live-bus";
import type { JobEvent, JobEventType } from "@/lib/types";

const ALLOWED: JobEventType[] = [
  "status",
  "tool",
  "tool_result",
  "log",
  "token",
  "error",
];

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-worker-key");
  if (!key || key !== WORKER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    jobId?: string;
    workerId?: string;
    type?: string;
    message?: string;
    data?: Record<string, unknown> | null;
  };

  if (!body.jobId || !body.workerId || !body.type || body.message === undefined) {
    return NextResponse.json(
      { error: "jobId, workerId, type, and message required" },
      { status: 400 },
    );
  }
  if (!ALLOWED.includes(body.type as JobEventType)) {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
  }

  // High-frequency tokens: live bus only (SSE), skip durable store write.
  if (body.type === "token") {
    const job = await getJob(body.jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.workerId !== body.workerId) {
      return NextResponse.json({ error: "Worker mismatch" }, { status: 400 });
    }
    if (job.status === "completed" || job.status === "failed") {
      return NextResponse.json({ error: "Job already finished" }, { status: 400 });
    }
    const event: JobEvent = {
      id: randomUUID(),
      t: new Date().toISOString(),
      type: "token",
      message: String(body.message).slice(0, 4000),
      data: body.data ?? null,
    };
    pushLiveEvent(body.jobId, event);
    return NextResponse.json({ event, persisted: false });
  }

  try {
    const { event } = await appendJobEvent({
      jobId: body.jobId,
      workerId: body.workerId,
      type: body.type as JobEventType,
      message: body.message,
      data: body.data,
    });
    return NextResponse.json({ event, persisted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Progress failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

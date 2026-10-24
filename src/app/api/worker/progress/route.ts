import { NextRequest, NextResponse } from "next/server";
import { WORKER_API_KEY } from "@/lib/config";
import { appendJobEvent } from "@/lib/store";
import type { JobEventType } from "@/lib/types";

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

  if (!body.jobId || !body.workerId || !body.type || !body.message) {
    return NextResponse.json(
      { error: "jobId, workerId, type, and message required" },
      { status: 400 },
    );
  }
  if (!ALLOWED.includes(body.type as JobEventType)) {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
  }

  try {
    const { event } = await appendJobEvent({
      jobId: body.jobId,
      workerId: body.workerId,
      type: body.type as JobEventType,
      message: body.message,
      data: body.data,
    });
    return NextResponse.json({ event });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Progress failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

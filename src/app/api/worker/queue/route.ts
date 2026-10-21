import { NextRequest, NextResponse } from "next/server";
import { getWorkerApiKey } from "@/lib/config";
import { getWorkerQueueSnapshot } from "@/lib/store";

function authorize(req: NextRequest) {
  const key = req.headers.get("x-worker-key")?.trim();
  return Boolean(key && key === getWorkerApiKey());
}

/** Diagnose why claim returns null while the studio shows queued. */
export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const snapshot = await getWorkerQueueSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Queue read failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getWorkerApiKey } from "@/lib/config";
import {
  formatAwsError,
  peekWorkspaceBucketEnv,
  resolveWorkspaceBucket,
} from "@/lib/s3-bucket";
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
    const resolved = await resolveWorkspaceBucket();
    return NextResponse.json(
      {
        error: formatAwsError(err),
        storeBucketSource: resolved.source,
        storeBucketError: resolved.error ?? null,
        envPeek: peekWorkspaceBucketEnv(),
      },
      { status: 500 },
    );
  }
}

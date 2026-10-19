import { NextResponse } from "next/server";
import { processOneInlineJob } from "@/lib/inline-worker";

export async function POST() {
  const job = await processOneInlineJob();
  return NextResponse.json({ job });
}

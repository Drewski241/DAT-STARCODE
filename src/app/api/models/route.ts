import { NextResponse } from "next/server";
import {
  DEFAULT_MODEL_ID,
  MODEL_OPTIONS,
} from "@/lib/models";

export async function GET() {
  return NextResponse.json({
    defaultModelId: DEFAULT_MODEL_ID,
    models: MODEL_OPTIONS,
  });
}

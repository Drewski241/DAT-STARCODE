import { NextResponse } from "next/server";
import { DAT_ASSET_ID, APP_NAME } from "@/lib/config";

function storeBackend() {
  const bucket = (
    process.env.WORKSPACE_S3_BUCKET ||
    process.env.STORE_S3_BUCKET ||
    ""
  ).trim();
  if (bucket) return { backend: "s3", bucket };
  return { backend: "file" };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: APP_NAME,
    datAssetId: DAT_ASSET_ID,
    store: storeBackend(),
    time: new Date().toISOString(),
  });
}

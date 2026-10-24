import { NextResponse } from "next/server";
import { DAT_ASSET_ID, APP_NAME } from "@/lib/config";
import { getStoreInfo } from "@/lib/store";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: APP_NAME,
    datAssetId: DAT_ASSET_ID,
    store: getStoreInfo(),
    time: new Date().toISOString(),
  });
}

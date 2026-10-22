import { NextResponse } from "next/server";
import { DAT_ASSET_ID, APP_NAME } from "@/lib/config";
import { getStorePersistenceInfo } from "@/lib/store";

export async function GET() {
  let store = null;
  try {
    store = await getStorePersistenceInfo();
  } catch (err) {
    store = {
      mode: "error",
      ok: false,
      error: err instanceof Error ? err.message : "store probe failed",
    };
  }

  return NextResponse.json({
    ok: true,
    app: APP_NAME,
    datAssetId: DAT_ASSET_ID,
    time: new Date().toISOString(),
    /** Credits/accounts persist only when store.mode === "s3" and store.ok */
    store,
  });
}

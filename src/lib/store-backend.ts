/**
 * Persistence for the app store.
 * - Default: local JSON file (`.data/store.json`) for house / demo use
 * - When DAT_STARCODER_TABLE is set: DynamoDB snapshot (pk/sk table from CloudFormation)
 */

import { promises as fs } from "fs";
import path from "path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type { StoreSnapshot } from "@/lib/types";

export type StoreBackendKind = "file" | "dynamodb";

const DATA_DIR =
  process.env.DAT_STARCODER_DATA_DIR ??
  process.env.ANVIL_DATA_DIR ??
  path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const TABLE =
  process.env.DAT_STARCODER_TABLE?.trim() ||
  process.env.DYNAMODB_TABLE_NAME?.trim() ||
  "";
const STORE_PK = process.env.DAT_STARCODER_STORE_PK?.trim() || "dat-starcoder";
const STORE_SK = "SNAPSHOT";

export function getStoreBackendKind(): StoreBackendKind {
  return TABLE ? "dynamodb" : "file";
}

export function emptyStore(): StoreSnapshot {
  return { accounts: [], payments: [], jobs: [], projects: [] };
}

let ddb: DynamoDBDocumentClient | null = null;

function docClient() {
  if (!ddb) {
    const client = new DynamoDBClient({});
    ddb = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return ddb;
}

type Loaded = { store: StoreSnapshot; version: number };

export async function loadSnapshot(): Promise<Loaded> {
  if (!TABLE) {
    try {
      const raw = await fs.readFile(STORE_PATH, "utf8");
      return {
        store: JSON.parse(raw) as StoreSnapshot,
        version: 0,
      };
    } catch {
      return { store: emptyStore(), version: 0 };
    }
  }

  const res = await docClient().send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: STORE_PK, sk: STORE_SK },
    }),
  );
  const item = res.Item as
    | { version?: number; snapshot?: StoreSnapshot }
    | undefined;
  if (!item?.snapshot) {
    return { store: emptyStore(), version: 0 };
  }
  return {
    store: item.snapshot,
    version: typeof item.version === "number" ? item.version : 0,
  };
}

export async function saveSnapshot(
  store: StoreSnapshot,
  expectedVersion: number,
): Promise<number> {
  if (!TABLE) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STORE_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(tmp, STORE_PATH);
    return expectedVersion + 1;
  }

  const nextVersion = expectedVersion + 1;
  const now = new Date().toISOString();
  try {
    await docClient().send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          pk: STORE_PK,
          sk: STORE_SK,
          version: nextVersion,
          snapshot: store,
          updatedAt: now,
        },
        ConditionExpression:
          expectedVersion === 0
            ? "attribute_not_exists(pk) OR version = :v"
            : "version = :v",
        ExpressionAttributeValues: { ":v": expectedVersion },
      }),
    );
    return nextVersion;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "ConditionalCheckFailedException") {
      const conflict = new Error("STORE_VERSION_CONFLICT");
      (conflict as Error & { code?: string }).code = "STORE_VERSION_CONFLICT";
      throw conflict;
    }
    throw err;
  }
}

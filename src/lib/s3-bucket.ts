/**
 * Resolve the workspace/store S3 bucket at runtime.
 *
 * Amplify console env vars sometimes never reach Next SSR compute. We:
 * 1) Read env (static process.env.FOO so next.config / .env.production inlining works)
 * 2) SSM /dat-starcoder/workspace-s3-bucket (CloudFormation)
 * 3) Convention dat-starcoder-workspaces-<accountId> via STS
 * and verify with HeadBucket before caching.
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

function envName(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function awsRegion() {
  return (
    envName("AWS_REGION") ||
    envName("AWS_DEFAULT_REGION") ||
    envName("STARCODER_AWS_REGION") ||
    "us-east-1"
  );
}

export type BucketResolution = {
  bucket: string;
  source: "env" | "ssm" | "convention" | "none";
  error?: string;
};

let cached: BucketResolution | null = null;
let inflight: Promise<BucketResolution> | null = null;

/**
 * Prefer static process.env.NAME so Next can inline values from
 * next.config env / .env.production written during the Amplify build.
 * Also try dynamic access for true runtime injection.
 */
function fromEnv(): string {
  const staticStore = (process.env.STORE_S3_BUCKET ?? "").trim();
  const staticWorkspace = (process.env.WORKSPACE_S3_BUCKET ?? "").trim();
  return (
    staticStore ||
    staticWorkspace ||
    envName("STORE_S3_BUCKET") ||
    envName("WORKSPACE_S3_BUCKET")
  );
}

async function fromSsm(): Promise<string> {
  const explicit = envName("WORKSPACE_S3_BUCKET_SSM");
  const names = [
    explicit,
    "/dat-starcoder/workspace-s3-bucket",
    "/DAT-STARCODE/workspace-s3-bucket",
  ].filter(Boolean);

  const ssm = new SSMClient({ region: awsRegion() });
  for (const name of names) {
    try {
      const res = await ssm.send(
        new GetParameterCommand({ Name: name, WithDecryption: true }),
      );
      const value = res.Parameter?.Value?.trim();
      if (value) return value;
    } catch {
      // try next name
    }
  }
  return "";
}

async function fromConvention(): Promise<string> {
  const project = envName("STARCODER_PROJECT_NAME") || "dat-starcoder";
  try {
    const sts = new STSClient({ region: awsRegion() });
    const id = await sts.send(new GetCallerIdentityCommand({}));
    if (id.Account) return `${project}-workspaces-${id.Account}`;
  } catch {
    // ignore
  }
  const account = envName("AWS_ACCOUNT_ID") || envName("ACCOUNT_ID");
  if (account) return `${project}-workspaces-${account}`;
  return "";
}

function isMissingObject(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === "NoSuchKey" ||
    e.name === "NotFound" ||
    e.$metadata?.httpStatusCode === 404
  );
}

/** Probe with GetObject — Amplify roles often lack s3:HeadBucket/ListBucket. */
async function probeBucket(bucket: string): Promise<string | null> {
  const client = new S3Client({ region: awsRegion() });
  try {
    await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: "store/store.json",
      }),
    );
    return null;
  } catch (err) {
    if (isMissingObject(err)) return null; // bucket reachable; store not created yet
    return formatAwsError(err);
  }
}

export async function resolveWorkspaceBucket(): Promise<BucketResolution> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const candidates: Array<{ bucket: string; source: BucketResolution["source"] }> =
      [];

    const env = fromEnv();
    if (env) candidates.push({ bucket: env, source: "env" });

    const ssm = await fromSsm();
    if (ssm && ssm !== env) candidates.push({ bucket: ssm, source: "ssm" });

    const convention = await fromConvention();
    if (
      convention &&
      convention !== env &&
      convention !== ssm
    ) {
      candidates.push({ bucket: convention, source: "convention" });
    }

    if (candidates.length === 0) {
      cached = {
        bucket: "",
        source: "none",
        error: "No bucket candidates from env, SSM, or account convention",
      };
      return cached;
    }

    const failures: string[] = [];
    for (const c of candidates) {
      const probeErr = await probeBucket(c.bucket);
      if (!probeErr) {
        cached = { bucket: c.bucket, source: c.source };
        return cached;
      }
      failures.push(`${c.source}:${c.bucket}: ${probeErr}`);
    }

    cached = {
      bucket: "",
      source: "none",
      error: failures.join(" | "),
    };
    return cached;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Clear cached resolution (e.g. after AccessDenied so we can retry). */
export function clearWorkspaceBucketCache() {
  cached = null;
}

/** Sync peek of env-only (no network). For diagnostics. */
export function peekWorkspaceBucketEnv(): {
  store: boolean;
  workspace: boolean;
  storeLen: number;
  workspaceLen: number;
  region: string;
  awsHosted: boolean;
} {
  const store = (process.env.STORE_S3_BUCKET ?? "").trim();
  const workspace = (process.env.WORKSPACE_S3_BUCKET ?? "").trim();
  return {
    store: Boolean(store),
    workspace: Boolean(workspace),
    storeLen: store.length,
    workspaceLen: workspace.length,
    region: awsRegion(),
    awsHosted: Boolean(
      envName("AWS_EXECUTION_ENV") ||
        envName("AWS_REGION") ||
        envName("AMPLIFY_APP_ID") ||
        envName("AWS_APP_ID"),
    ),
  };
}

export function formatAwsError(err: unknown): string {
  if (!err) return "unknown error";
  if (err instanceof Error) {
    const meta =
      typeof err === "object" && err && "$metadata" in err
        ? (err as { $metadata?: { httpStatusCode?: number; requestId?: string } })
            .$metadata
        : undefined;
    const bits = [err.name, err.message];
    if (meta?.httpStatusCode) bits.push(`status=${meta.httpStatusCode}`);
    if (meta?.requestId) bits.push(`requestId=${meta.requestId}`);
    return bits.filter(Boolean).join(": ");
  }
  return String(err);
}

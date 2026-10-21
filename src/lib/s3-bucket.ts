/**
 * Resolve the workspace/store S3 bucket at runtime.
 *
 * Amplify console env vars sometimes never reach Next SSR compute (or get
 * build-time inlined as ""). Fall back to SSM (CloudFormation writes
 * /dat-starcoder/workspace-s3-bucket) then the CFN naming convention
 * dat-starcoder-workspaces-<accountId>.
 */

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
};

let cached: BucketResolution | null = null;
let inflight: Promise<BucketResolution> | null = null;

function fromEnv(): string {
  return envName("STORE_S3_BUCKET") || envName("WORKSPACE_S3_BUCKET");
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

export async function resolveWorkspaceBucket(): Promise<BucketResolution> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const env = fromEnv();
    if (env) {
      cached = { bucket: env, source: "env" };
      return cached;
    }
    const ssm = await fromSsm();
    if (ssm) {
      cached = { bucket: ssm, source: "ssm" };
      return cached;
    }
    const convention = await fromConvention();
    if (convention) {
      cached = { bucket: convention, source: "convention" };
      return cached;
    }
    cached = { bucket: "", source: "none" };
    return cached;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Sync peek of env-only (no network). For diagnostics. */
export function peekWorkspaceBucketEnv(): {
  store: boolean;
  workspace: boolean;
  region: string;
  awsHosted: boolean;
} {
  return {
    store: Boolean(envName("STORE_S3_BUCKET")),
    workspace: Boolean(envName("WORKSPACE_S3_BUCKET")),
    region: awsRegion(),
    awsHosted: Boolean(
      envName("AWS_EXECUTION_ENV") ||
        envName("AWS_REGION") ||
        envName("AMPLIFY_APP_ID") ||
        envName("AWS_APP_ID"),
    ),
  };
}

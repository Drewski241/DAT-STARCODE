import type { NextConfig } from "next";

/**
 * Dev often mixes localhost vs 127.0.0.1 (and the P720 hostname).
 * Without these, Next blocks HMR/dev assets and client clicks can appear dead.
 *
 * Bake WORKSPACE_S3_BUCKET from the Amplify *build* environment into the
 * server bundle. SSR compute has been observed without runtime console env.
 * Bucket name is not secret. Runtime still falls back to SSM / account
 * convention in src/lib/s3-bucket.ts.
 */
const workspaceBucket =
  process.env.WORKSPACE_S3_BUCKET?.trim() ||
  process.env.STORE_S3_BUCKET?.trim() ||
  "";

const nextConfig: NextConfig = {
  env: {
    WORKSPACE_S3_BUCKET: workspaceBucket,
    STORE_S3_BUCKET:
      process.env.STORE_S3_BUCKET?.trim() || workspaceBucket,
  },
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "drew-davis-ThinkStation-P720",
    "*.local",
  ],
  // WalletConnect Sign Client is browser-only.
  serverExternalPackages: ["@walletconnect/sign-client"],
};

export default nextConfig;

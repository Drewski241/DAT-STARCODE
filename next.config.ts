import type { NextConfig } from "next";

/**
 * Dev often mixes localhost vs 127.0.0.1 (and the P720 hostname).
 * Without these, Next blocks HMR/dev assets and client clicks can appear dead.
 */
const nextConfig: NextConfig = {
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

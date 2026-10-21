/**
 * Amplify Hosting forbids custom env vars starting with AWS_*, and the SSR
 * compute role is often unset — so the default credential chain fails with
 * CredentialsProviderError. Prefer the Amplify SSR compute IAM role; as a
 * fallback accept STARCODER_AWS_* keys (not the reserved AWS_* prefix).
 */

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getExplicitAwsCredentials():
  | { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
  | undefined {
  const accessKeyId =
    env("STARCODER_AWS_ACCESS_KEY_ID") || env("STARCODER_ACCESS_KEY_ID");
  const secretAccessKey =
    env("STARCODER_AWS_SECRET_ACCESS_KEY") ||
    env("STARCODER_SECRET_ACCESS_KEY");
  const sessionToken =
    env("STARCODER_AWS_SESSION_TOKEN") ||
    env("STARCODER_SESSION_TOKEN") ||
    undefined;

  if (!accessKeyId || !secretAccessKey) return undefined;
  return sessionToken
    ? { accessKeyId, secretAccessKey, sessionToken }
    : { accessKeyId, secretAccessKey };
}

export function awsClientConfig() {
  const credentials = getExplicitAwsCredentials();
  return {
    region:
      env("AWS_REGION") ||
      env("AWS_DEFAULT_REGION") ||
      env("STARCODER_AWS_REGION") ||
      "us-east-1",
    ...(credentials ? { credentials } : {}),
  };
}

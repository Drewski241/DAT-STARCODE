#!/usr/bin/env bash
# Deploy DAT STARCODER infra (DynamoDB + workspace S3) and print Amplify wiring.
set -euo pipefail

STACK_NAME="${STACK_NAME:-dat-starcoder}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
WORKER_API_KEY="${WORKER_API_KEY:-}"

if [[ -z "$WORKER_API_KEY" ]]; then
  WORKER_API_KEY="$(openssl rand -hex 24)"
  echo "Generated WORKER_API_KEY (save this): $WORKER_API_KEY"
fi

echo "Deploying CloudFormation stack: $STACK_NAME ($REGION)"
aws cloudformation deploy \
  --region "$REGION" \
  --template-file infra/cloudformation.yml \
  --stack-name "$STACK_NAME" \
  --parameter-overrides "WorkerApiKey=${WORKER_API_KEY}" \
  --capabilities CAPABILITY_NAMED_IAM

echo
echo "Stack outputs:"
aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs' \
  --output table

BUCKET="$(aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='WorkspaceBucketName'].OutputValue" \
  --output text)"

echo
echo "Next: Amplify Hosting"
echo "  1. Connect this GitHub repo in Amplify (use infra/amplify.yml)."
echo "  2. Set environment variables (WORKSPACE_S3_BUCKET is required for login):"
echo "       WORKER_API_KEY=${WORKER_API_KEY}"
echo "       WORKSPACE_S3_BUCKET=${BUCKET}"
echo "       AWS_REGION=${REGION}"
echo "       AUTH_SECRET=<long-random-string>"
echo "       NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<from walletconnect cloud>"
echo "       ALLOW_DEMO_PAYMENTS=1   # optional for invite testers"
echo "  3. Attach an IAM policy to the Amplify SSR / compute role allowing"
echo "       s3:GetObject s3:PutObject s3:DeleteObject s3:ListBucket"
echo "     on arn:aws:s3:::${BUCKET} and arn:aws:s3:::${BUCKET}/*"
echo "     Without this, sign-in will bounce back to the login page."
echo "  4. Point your on-prem worker at the Amplify URL:"
echo "       DAT_STARCODER_API_BASE=https://<amplify-domain>"
echo "       WORKER_API_KEY=${WORKER_API_KEY}"

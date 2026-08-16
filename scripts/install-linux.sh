#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.19 or newer is required." >&2
  exit 1
fi
if ! command -v dsh >/dev/null 2>&1; then
  echo "DeepSeek Harness (dsh) is required." >&2
  exit 1
fi

node_major=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$node_major" -lt 22 ]; then
  echo "Node.js 22.19 or newer is required (found $(node --version))." >&2
  exit 1
fi

profile=${DSH_PROFILE:-default}
chmod +x src/analyze_python.py scripts/install-linux.sh
dsh plugin --profile "$profile" add -w .
echo "Installed into DeepSeek Harness profile: $profile"
echo "Verify with: dsh --profile $profile --dump-config"

#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ^22.19.0 or >=24 is required." >&2
  exit 1
fi
node_version=$(node -p "process.versions.node")
node_major=${node_version%%.*}
node_minor_patch=${node_version#*.}
node_minor=${node_minor_patch%%.*}
if [ "$node_major" -lt 22 ] || [ "$node_major" -eq 23 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 19 ]; }; then
  echo "Node.js ^22.19.0 or >=24 is required (found $(node --version))." >&2
  exit 1
fi

profile=${DSH_PROFILE:-web}
plugin_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
chmod +x "$plugin_dir/src/analyze_python.py" "$plugin_dir/scripts/install-linux.sh"

if command -v dsh >/dev/null 2>&1; then
  dsh plugin --profile "$profile" add -w "$plugin_dir"
  verify_command="dsh --profile $profile --dump-config"
elif command -v npx >/dev/null 2>&1 && [ -n "${DSH_HARNESS_DIR:-}" ] && [ -f "$DSH_HARNESS_DIR/package.json" ]; then
  (cd "$DSH_HARNESS_DIR" && npx -y @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile "$profile" add -w "$plugin_dir")
  verify_command="cd $DSH_HARNESS_DIR && npx -y @deepseek-ai/dsh@0.1.0-rc.6 --profile $profile --dump-config"
elif command -v npx >/dev/null 2>&1; then
  npx -y @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile "$profile" add -w "$plugin_dir"
  verify_command="npx -y @deepseek-ai/dsh@0.1.0-rc.6 --profile $profile --dump-config"
else
  echo "DeepSeek Harness CLI is unavailable. Install Node.js with npx, set DSH_HARNESS_DIR, or install dsh globally." >&2
  exit 1
fi

echo "Installed into DeepSeek Harness profile: $profile"
echo "Verify with: $verify_command"

#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required for source analysis." >&2
  exit 1
fi

node_major=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$node_major" -lt 20 ]; then
  echo "Node.js 20 or newer is required (found $(node --version))." >&2
  exit 1
fi

chmod +x bin/context-graph.js src/analyze_python.py scripts/install-linux.sh
echo "Ready. Run: node src/server.js"
echo "Then open: http://127.0.0.1:4317"

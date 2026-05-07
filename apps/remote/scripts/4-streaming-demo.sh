#!/usr/bin/env bash
# =============================================================================
# 4-streaming-demo.sh — Watch the knock-knock joke arrive as an SSE stream
#
# This script simulates the streaming request that Jira sends to the remote
# agent when `streaming: true` is declared in the Forge manifest.
#
# Usage:
#   TASK_ID=<taskId> ./scripts/4-streaming-demo.sh
#
# The server must be running locally (npm run dev in apps/remote).
# No auth token is needed when hitting the server directly (auth is handled
# by the Forge app in production).
# =============================================================================

set -euo pipefail

BASE_URL="${REMOTE_SERVICE_URL:-http://localhost:3000}"
REQUEST_ID="demo-$(date +%s)"

echo "📡 Opening SSE stream to ${BASE_URL}/a2a/json-rpc ..."
echo "   (Jira sends Accept: text/event-stream when streaming: true is set in manifest)"
echo ""

# message/send with Accept: text/event-stream triggers the streaming path.
# --no-buffer disables curl's output buffering so you see each SSE event
# as it arrives rather than all at once at the end.
curl \
  --no-buffer \
  --silent \
  --show-error \
  --header "Content-Type: application/json" \
  --header "Accept: text/event-stream" \
  --data @- \
  "${BASE_URL}/a2a/json-rpc" \
  <<EOF
{
  "jsonrpc": "2.0",
  "id": "${REQUEST_ID}",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        { "kind": "text", "text": "Please tell me a knock-knock joke." },
        {
          "kind": "data",
          "data": {
            "issue": { "id": "DEMO-1" },
            "userAccountId": "demo-user"
          }
        }
      ],
      "messageId": "msg-${REQUEST_ID}",
      "kind": "message"
    }
  }
}
EOF

echo ""
echo "✅ Stream closed."

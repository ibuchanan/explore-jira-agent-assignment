#!/bin/bash
# Mark a task as failed

if [ -z "$1" ]; then
  echo "Usage: $0 <taskId> [error_message]"
  echo "Example: $0 task-1234567890-abcde 'Unable to process request'"
  exit 1
fi

TASK_ID="$1"
MESSAGE="${2:-Task failed due to an error during processing.}"

curl -X POST "http://localhost:3000/tasks/${TASK_ID}/advance" \
  -H "Content-Type: application/json" \
  -d "{\"state\": \"failed\", \"message\": \"${MESSAGE}\"}" \
  | jq .

echo ""

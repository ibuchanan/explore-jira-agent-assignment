#!/bin/bash
# Complete a task

if [ -z "$1" ]; then
  echo "Usage: $0 <taskId>"
  echo "Example: $0 task-1234567890-abcde"
  exit 1
fi

TASK_ID="$1"
MESSAGE="Otto-matically done"

curl -X POST "http://localhost:3000/tasks/${TASK_ID}/advance" \
  -H "Content-Type: application/json" \
  -d "{\"state\": \"completed\", \"message\": \"${MESSAGE}\"}" \
  | jq .

echo ""

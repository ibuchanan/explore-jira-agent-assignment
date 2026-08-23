#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 0 ]]; then
	printf '%s\n' 'usage: scripts/tools-check.sh' >&2
	exit 64
fi

for tool in cloudflared forge secretspec yq; do
	if ! path=$(command -v "$tool"); then
		printf '%s\n' "$tool is required but was not found on PATH" >&2
		exit 127
	fi
	printf '%s\n' "$tool: $path"
done

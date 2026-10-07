#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
reference="$root/docs/reference/jira-remote-agent-a2a-compatibility.md"

[[ -f $reference ]] || {
	printf '%s\n' "missing compatibility reference: $reference" >&2
	exit 1
}

require() {
	grep -Fq -- "$1" "$reference" || {
		printf '%s\n' "missing compatibility boundary: $1" >&2
		exit 1
	}
}

require '## Live Jira smoke-test evidence'
require '../how-to-guides/run-jira-streaming-lifecycle-smoke-suite.md'
require 'do not establish a general Jira, Forge, or A2A'
require '## Automated simulator coverage'
require '## Intentional sample limits'
require 'direct Forge-to-remote tunnel connection'
require 'durable storage'
require 'relay'

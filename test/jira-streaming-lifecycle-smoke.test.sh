#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
guide="$root/docs/how-to-guides/run-jira-streaming-lifecycle-smoke-suite.md"

[[ -f $guide ]] || {
  printf '%s\n' "missing smoke-suite guide: $guide" >&2
  exit 1
}

require() {
  grep -Fq -- "$1" "$guide" || {
    printf '%s\n' "missing smoke-suite requirement: $1" >&2
    exit 1
  }
}

require 'SendStreamingMessage'
require 'Investigate the login fix in the session refresh flow'
require 'Request the repository connection for the release automation'
require 'Start the repository migration after the readiness review'
require 'auth-required'
require 'Connect'
require 'canceled'
require 'no later completion'
require 'restart/redeployment continuity is not claimed'
require 'Task URL or ID'

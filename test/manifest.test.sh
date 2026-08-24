#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
test "$(yq -r '.modules["rovo:agentConnector"][0].protocols.agent2Agent.jsonRpcTransport.streaming' "$root/apps/forge/manifest.yml")" = true

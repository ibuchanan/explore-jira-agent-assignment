#!/usr/bin/env bash
set -euo pipefail

if ! command -v forge >/dev/null 2>&1; then
    printf '%s\n' 'forge is required; install it from https://developer.atlassian.com/platform/forge/getting-started/' >&2
    exit 127
fi

if ! command -v yq >/dev/null 2>&1; then
    printf '%s\n' 'yq is required; install it from https://github.com/mikefarah/yq' >&2
    exit 127
fi

if [[ $# -ne 0 ]]; then
    printf '%s\n' 'usage: scripts/register.sh' >&2
    exit 64
fi

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
(
    cd "$root/apps/forge"
    forge register >&2
)

app_ari=$(yq -r '.app.id' "$root/apps/forge/manifest.yml")
app_id=${app_ari##*/}
if [[ ! $app_ari =~ ^ari:cloud:ecosystem::app/[0-9a-fA-F-]{36}$ ]]; then
    printf '%s\n' 'forge register did not write a valid app ARI to apps/forge/manifest.yml' >&2
    exit 1
fi

bash "$root/scripts/env-var-set.sh" FORGE_APP_ID "$app_id"
printf '%s\n' "$app_id"

#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/tmp_rovo_register.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/forge" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$(pwd):\$*" >"$tmp/forge-args"
printf '%s\n' 'Forge registered'
EOF

cat >"$tmp/yq" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$tmp/yq-args"
printf '%s\n' 'ari:cloud:ecosystem::app/123e4567-e89b-12d3-a456-426614174000'
EOF

cat >"$tmp/secretspec" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$tmp/secretspec-args"
if [[ \$3 == run ]]; then
  "\${5}" "\${6}" "\${7}"
fi
EOF
chmod +x "$tmp/forge" "$tmp/yq" "$tmp/secretspec"

app_id=$(PATH="$tmp:$PATH" bash "$root/scripts/register.sh")

test "$app_id" = "123e4567-e89b-12d3-a456-426614174000"
test "$(cat "$tmp/forge-args")" = "$root/apps/forge:register"
test "$(cat "$tmp/yq-args")" = "-r .app.id $root/apps/forge/manifest.yml"
test "$(cat "$tmp/secretspec-args")" = "--file $root/secretspec.toml set FORGE_APP_ID 123e4567-e89b-12d3-a456-426614174000"

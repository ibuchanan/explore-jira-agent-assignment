#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/tmp_rovo_tunnel.XXXXXX")
trap 'kill "${tunnel_pid:-}" 2>/dev/null || true; rm -rf "$tmp"' EXIT

cat >"$tmp/cloudflared" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'INF Your quick Tunnel has been created! Visit it at:' >&2
printf '%s\n' 'https://test-tunnel.trycloudflare.com' >&2
printf '%s\n' "$*" >"${CLOUDFLARED_ARGS:?}"
while :; do sleep 1; done
EOF

cat >"$tmp/secretspec" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$tmp/secretspec-args"
EOF
chmod +x "$tmp/cloudflared" "$tmp/secretspec"

CLOUDFLARED_ARGS="$tmp/cloudflared-args" PATH="$tmp:$PATH" bash "$root/scripts/tunnel.sh" >"$tmp/url" 2>"$tmp/log" &
tunnel_pid=$!

for _ in {1..50}; do
	[[ -s "$tmp/url" ]] && break
	sleep 0.1
done

if [[ ! -s $tmp/url ]]; then
	cat "$tmp/log" >&2
	exit 1
fi

test "$(cat "$tmp/url")" = "https://test-tunnel.trycloudflare.com"
test "$(cat "$tmp/cloudflared-args")" = "--no-autoupdate tunnel --url http://localhost:3000"
test "$(cat "$tmp/secretspec-args")" = "--file $root/secretspec.toml set REMOTE_BASE_URL https://test-tunnel.trycloudflare.com"

#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
approval_flag=${1:-}
case $approval_flag in
"") deploy_script=forge:deploy ;;
--approve-system-user-change) deploy_script=forge:deploy:approve-system-user-change ;;
*) printf '%s\n' 'usage: test/deploy-tunnel.test.sh [--approve-system-user-change]' >&2; exit 64 ;;
esac
tmp=$(mktemp -d "${TMPDIR:-/tmp}/tmp_rovo_deploy_tunnel.XXXXXX")
trap 'kill "${deploy_pid:-}" 2>/dev/null || true; rm -rf "$tmp"' EXIT

cat >"$tmp/cloudflared" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'https://test-tunnel.trycloudflare.com' >&2
while :; do sleep 1; done
EOF

cat >"$tmp/secretspec" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$tmp/secretspec-args"
EOF

cat >"$tmp/npm" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >"$tmp/npm-args"
EOF
chmod +x "$tmp/cloudflared" "$tmp/secretspec" "$tmp/npm"

if [[ -n $approval_flag ]]; then
  PATH="$tmp:$PATH" bash "$root/scripts/deploy-tunnel.sh" "$approval_flag" >"$tmp/output" 2>"$tmp/log" &
else
  PATH="$tmp:$PATH" bash "$root/scripts/deploy-tunnel.sh" >"$tmp/output" 2>"$tmp/log" &
fi
deploy_pid=$!

for _ in {1..50}; do
	[[ -s "$tmp/npm-args" ]] && break
	sleep 0.1
done

if [[ ! -s $tmp/npm-args ]]; then
	cat "$tmp/log" >&2
	exit 1
fi

test "$(cat "$tmp/secretspec-args")" = "--file $root/secretspec.toml set REMOTE_BASE_URL https://test-tunnel.trycloudflare.com"
test "$(cat "$tmp/npm-args")" = "run $deploy_script"
test "$(cat "$tmp/output")" = $'https://test-tunnel.trycloudflare.com\nTunnel up, deploy succeeded, waiting for app traffic'

#!/usr/bin/env bash
set -euo pipefail

if ! command -v cloudflared >/dev/null 2>&1; then
	printf '%s\n' 'cloudflared is required; install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/' >&2
	exit 127
fi

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
log=$(mktemp "${TMPDIR:-/tmp}/tmp_rovo_cloudflared.XXXXXX")
tunnel_pid=

# ShellCheck cannot statically resolve the trap callback below.
# shellcheck disable=SC2329
cleanup() {
	[[ -n $tunnel_pid ]] && kill "$tunnel_pid" 2>/dev/null || true
	rm -f "$log"
}
trap cleanup EXIT INT TERM

cloudflared --no-autoupdate tunnel --url http://localhost:3000 >"$log" 2>&1 &
tunnel_pid=$!

while kill -0 "$tunnel_pid" 2>/dev/null; do
	url=$(grep -Eom1 'https://[[:alnum:]-]+\.trycloudflare\.com' "$log" || true)
	if [[ -n $url ]]; then
		bash "$root/scripts/env-var-set.sh" REMOTE_BASE_URL "$url"
		printf '%s\n' "$url"
		wait "$tunnel_pid"
		exit $?
	fi
	sleep 0.1
done

wait "$tunnel_pid" || true
cat "$log" >&2
printf '%s\n' 'cloudflared exited before providing a Quick Tunnel URL' >&2
exit 1

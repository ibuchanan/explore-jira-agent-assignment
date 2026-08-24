#!/usr/bin/env bash
set -euo pipefail

case $#:${1-} in
0:) deploy_script=forge:deploy ;;
1:--approve-system-user-change) deploy_script=forge:deploy:approve-system-user-change ;;
*)
    printf '%s\n' 'usage: scripts/deploy-tunnel.sh [--approve-system-user-change]' >&2
    exit 64
    ;;
esac

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
url_file=$(mktemp "${TMPDIR:-/tmp}/tmp_rovo_deploy_tunnel.XXXXXX")
tunnel_pid=

# ShellCheck cannot statically resolve the trap callback below.
# shellcheck disable=SC2329
cleanup() {
    [[ -n $tunnel_pid ]] && kill "$tunnel_pid" 2>/dev/null || true
    rm -f "$url_file"
}
trap cleanup EXIT INT TERM

bash "$root/scripts/tunnel.sh" >"$url_file" &
tunnel_pid=$!

while kill -0 "$tunnel_pid" 2>/dev/null; do
    [[ -s $url_file ]] && break
    sleep 0.1
done

if [[ ! -s $url_file ]]; then
    wait "$tunnel_pid" || true
    printf '%s\n' 'tunnel exited before providing a base URL' >&2
    exit 1
fi

url=$(cat "$url_file")
printf '%s\n' "$url"
npm run "$deploy_script" >&2
echo "Tunnel up, deploy succeeded, waiting for app traffic"
wait "$tunnel_pid"

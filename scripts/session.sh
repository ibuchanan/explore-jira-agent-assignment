#!/usr/bin/env bash
# Owns one development session end to end: the remote, the Quick Tunnel, and
# the Forge deployment and installation. Ctrl+C (or SIGTERM/SIGHUP) uninstalls
# the app before stopping the tunnel and remote, so Jira never keeps an
# installation whose backend has gone away.
set -euo pipefail

usage() {
	printf '%s\n' 'usage: scripts/session.sh [--approve-system-user-change]' >&2
}

case $#:${1-} in
0:) deploy_script=forge:deploy ;;
1:--approve-system-user-change) deploy_script=forge:deploy:approve-system-user-change ;;
*)
	usage
	exit 64
	;;
esac

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
session_dir=${SESSION_DIR:-$root/.session}
tunnel_timeout=${SESSION_TUNNEL_TIMEOUT:-30}
health_timeout=${SESSION_HEALTH_TIMEOUT:-90}
placeholder_url=https://unconfigured.invalid

mkdir -p "$session_dir"
remote_log=$session_dir/remote.log
tunnel_log=$session_dir/tunnel.log
url_file=$session_dir/tunnel.url
: >"$remote_log"
: >"$tunnel_log"
: >"$url_file"

remote_pid=
tunnel_pid=
started_pid=
install_attempted=
torn_down=

say() {
	printf '[session] %s\n' "$*" >&2 || true
}

alive() {
	[[ -n $1 ]] && kill -0 "$1" 2>/dev/null
}

# Starts a command in its own process group (job control on for the fork
# only), so Ctrl+C reaches this script rather than the children, and teardown
# can stop each whole tree (npm → node, tunnel.sh → cloudflared) in order.
start_group() {
	local out=$1 err=$2
	shift 2
	set -m
	"$@" </dev/null >>"$out" 2>>"$err" &
	started_pid=$!
	set +m
}

stop_group() {
	alive "$1" || return 0
	kill -TERM -- "-$1" 2>/dev/null || kill -TERM "$1" 2>/dev/null || true
	wait "$1" 2>/dev/null || true
}

require_alive() {
	if ! alive "$remote_pid"; then
		say "remote exited; see $remote_log"
		exit 1
	fi
	if ! alive "$tunnel_pid"; then
		say "tunnel exited; see $tunnel_log"
		exit 1
	fi
}

# ShellCheck cannot statically resolve the trap callback below.
# shellcheck disable=SC2329
teardown() {
	local status=$?
	[[ -z $torn_down ]] || return 0
	torn_down=1
	# Ignored dispositions are inherited, so a second Ctrl+C cannot abort the
	# uninstall halfway through.
	trap '' INT TERM HUP
	set +e
	if [[ -n $install_attempted ]]; then
		say 'uninstalling Forge app'
		npm run forge:uninstall </dev/null ||
			say 'uninstall failed; run npm run forge:uninstall before the next session'
	fi
	say 'stopping tunnel and remote'
	stop_group "$tunnel_pid"
	stop_group "$remote_pid"
	# The Quick Tunnel URL is dead now; restore the placeholder so a stray
	# forge:deploy cannot point Jira at it.
	bash "$root/scripts/env-var-set.sh" REMOTE_BASE_URL "$placeholder_url" >/dev/null 2>&1 ||
		say 'could not reset REMOTE_BASE_URL'
	say 'session ended'
	exit "$status"
}
trap teardown EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

say "logs: $session_dir"
start_group "$remote_log" "$remote_log" npm run remote:dev
remote_pid=$started_pid
start_group "$url_file" "$tunnel_log" bash "$root/scripts/tunnel.sh"
tunnel_pid=$started_pid

deadline=$((SECONDS + tunnel_timeout))
until [[ -s $url_file ]]; do
	require_alive
	if ((SECONDS >= deadline)); then
		say "no tunnel URL within ${tunnel_timeout}s; see $tunnel_log"
		exit 1
	fi
	sleep 0.2
done
url=$(head -n 1 "$url_file")
say "tunnel: $url"

# A new Quick Tunnel hostname can take a while to resolve, and the remote may
# still be compiling; only a response from the remote itself counts as ready.
deadline=$((SECONDS + health_timeout))
until curl -fsS -o /dev/null --max-time 5 "$url/healthz" 2>/dev/null; do
	require_alive
	if ((SECONDS >= deadline)); then
		say "remote not reachable through $url within ${health_timeout}s; see $remote_log"
		exit 1
	fi
	sleep 1
done
say 'remote reachable through tunnel'

say "deploying ($deploy_script)"
npm run "$deploy_script"

install_attempted=1
say 'installing Forge app'
# Upgrade first so a stale installation from a crashed session is repaired;
# fall back to a fresh install only for the "not installed" error.
if upgrade_output=$(npm run forge:upgrade 2>&1); then
	printf '%s\n' "$upgrade_output" >&2
elif [[ $upgrade_output == *'Could not find an installation'* ]]; then
	npm run forge:install
else
	printf '%s\n' "$upgrade_output" >&2
	exit 1
fi

say "ready: $url (press Ctrl+C to uninstall and stop)"
while alive "$remote_pid" && alive "$tunnel_pid"; do
	sleep 1
done
require_alive

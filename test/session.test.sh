#!/usr/bin/env bash
set -euo pipefail

case $#:${1-} in
0:) session_args=() deploy_script=forge:deploy ;;
1:--approve-system-user-change)
	session_args=(--approve-system-user-change)
	deploy_script=forge:deploy:approve-system-user-change
	;;
*)
	printf '%s\n' 'usage: test/session.test.sh [--approve-system-user-change]' >&2
	exit 64
	;;
esac

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/tmp_rovo_session.XXXXXX")
session_pid=
trap 'kill "${session_pid:-}" 2>/dev/null || true; rm -rf "$tmp"' EXIT

mkdir "$tmp/bin"
cat >"$tmp/bin/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_DIR/npm-args"
case $2 in
remote:dev)
	printf '%s\n' "$$" >"$STUB_DIR/remote.pid"
	until [[ -e $STUB_DIR/crash ]]; do sleep 0.1; done
	exit 3
	;;
forge:upgrade)
	printf '%s\n' 'Error: Could not find an installation for the provided Atlassian app'
	exit 1
	;;
esac
EOF

cat >"$tmp/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${!#}" >>"$STUB_DIR/curl-urls"
EOF

cat >"$tmp/bin/cloudflared" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$$" >"$STUB_DIR/cloudflared.pid"
printf '%s\n' 'https://test-tunnel.trycloudflare.com' >&2
while :; do sleep 1; done
EOF

cat >"$tmp/bin/secretspec" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_DIR/secretspec-args"
EOF
chmod +x "$tmp/bin/"*

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	cat "$stub_dir/session.log" >&2
	exit 1
}

# Starts a session against fresh stubs and waits until it reports ready.
start_session() {
	stub_dir=$tmp/$1
	mkdir "$stub_dir"
	STUB_DIR=$stub_dir SESSION_DIR=$stub_dir/session PATH="$tmp/bin:$PATH" \
		bash "$root/scripts/session.sh" ${session_args[@]+"${session_args[@]}"} 2>"$stub_dir/session.log" &
	session_pid=$!
	for _ in {1..100}; do
		grep -q '^\[session\] ready:' "$stub_dir/session.log" && return 0
		kill -0 "$session_pid" 2>/dev/null || fail "$1: session exited before ready"
		sleep 0.1
	done
	fail "$1: session never became ready"
}

finish_session() {
	status=0
	wait "$session_pid" || status=$?
	session_pid=
}

assert_torn_down() {
	local expected_npm expected_secretspec
	expected_npm=$(printf '%s\n' 'run remote:dev' "run $deploy_script" 'run forge:upgrade' 'run forge:install' 'run forge:uninstall')
	expected_secretspec=$(printf '%s\n' \
		"--file $root/secretspec.toml set REMOTE_BASE_URL https://test-tunnel.trycloudflare.com" \
		"--file $root/secretspec.toml set REMOTE_BASE_URL https://unconfigured.invalid")
	[[ $(cat "$stub_dir/npm-args") == "$expected_npm" ]] || fail "$1: unexpected npm calls: $(cat "$stub_dir/npm-args")"
	[[ $(cat "$stub_dir/secretspec-args") == "$expected_secretspec" ]] || fail "$1: unexpected secretspec calls"
	[[ $(head -n 1 "$stub_dir/curl-urls") == https://test-tunnel.trycloudflare.com/healthz ]] || fail "$1: health probe URL"
	! kill -0 "$(cat "$stub_dir/remote.pid")" 2>/dev/null || fail "$1: remote still running"
	! kill -0 "$(cat "$stub_dir/cloudflared.pid")" 2>/dev/null || fail "$1: cloudflared still running"
}

# A deliberate stop uninstalls, then stops the tunnel and remote.
start_session stop
kill -TERM "$session_pid"
finish_session
[[ $status == 143 ]] || fail "stop: exit status $status"
assert_torn_down stop

# A remote that dies mid-session triggers the same teardown and a failure exit.
start_session crash
touch "$stub_dir/crash"
finish_session
[[ $status == 1 ]] || fail "crash: exit status $status"
grep -q 'remote exited' "$stub_dir/session.log" || fail 'crash: cause not reported'
assert_torn_down crash

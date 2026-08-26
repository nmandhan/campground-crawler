#!/usr/bin/env bash
# Production-build probe for the Next.js 16 proxy.ts auth gate (MGMT-06).
#
# WHY THIS EXISTS: Next.js 16 renamed middleware.ts -> proxy.ts. A misnamed file is silently
# ignored at BUILD time with no error or warning, so a broken gate looks exactly like a working
# one in source review and in unit tests. RESEARCH.md Pitfall 4 further flags that the
# development server may not treat the file identically to a production build (assumption A3,
# unverified).
# A curl against `next start` is the only evidence that actually settles it.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3999}"
export DASHBOARD_PASSPHRASE="${DASHBOARD_PASSPHRASE:-probe-passphrase-do-not-use-in-prod}"
export GITHUB_WRITE_TOKEN="${GITHUB_WRITE_TOKEN:-unused-for-this-probe}"
export RIDB_API_KEY="${RIDB_API_KEY:-unused-for-this-probe}"

npm run build
npm run start -- --port "$PORT" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# wait for readiness (up to ~30s) rather than a fixed sleep
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://localhost:$PORT/"; then break; fi
  sleep 1
done

FAILURES=0
probe() { # probe <expected-status> <method> <path> [extra curl args...]
  local expected="$1" method="$2" path="$3"; shift 3
  local actual
  actual=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "http://localhost:$PORT$path" "$@")
  if [ "$actual" = "$expected" ]; then
    echo "PASS  $method $path -> $actual"
  else
    echo "FAIL  $method $path -> $actual (expected $expected)"
    FAILURES=$((FAILURES + 1))
  fi
}

JSON=(-H 'Content-Type: application/json')
BODY='{"type":"facility","id":"probe","parkName":"Probe","dateRange":{"start":"2030-01-01","end":"2030-01-02"},"siteType":"any"}'

probe 200 GET  /
probe 401 POST   /api/watches            "${JSON[@]}" -d "$BODY"
probe 401 PATCH  /api/watches/probe-id    "${JSON[@]}" -d "$BODY"
probe 401 DELETE /api/watches/probe-id
probe 401 GET    "/api/ridb/recareas?query=los"
probe 401 POST   /api/ridb/preview        "${JSON[@]}" -d '{"areas":[{"name":"Los Padres"}]}'
probe 401 POST   /api/session             "${JSON[@]}" -d '{"passphrase":"definitely-wrong"}'
probe 200 POST   /api/session             "${JSON[@]}" -d "{\"passphrase\":\"$DASHBOARD_PASSPHRASE\"}"

SET_COOKIE=$(curl -s -D - -o /dev/null -X POST "http://localhost:$PORT/api/session" \
  -H 'Content-Type: application/json' -d "{\"passphrase\":\"$DASHBOARD_PASSPHRASE\"}" \
  | tr -d '\r' | grep -i '^set-cookie:' || true)
for attr in HttpOnly Secure SameSite=Lax; do
  # Case-insensitive: RFC 6265 SameSite values are case-insensitive and Next.js's cookie
  # serializer lowercases them (e.g. "samesite=lax"), which is not a security regression.
  if printf '%s' "$SET_COOKIE" | grep -qi "$attr"; then
    echo "PASS  session cookie has $attr"
  else
    echo "FAIL  session cookie missing $attr"; FAILURES=$((FAILURES + 1))
  fi
done

if grep -rq "$DASHBOARD_PASSPHRASE" .next/static 2>/dev/null; then
  echo "FAIL  passphrase found in client bundle"; FAILURES=$((FAILURES + 1))
else
  echo "PASS  no passphrase in client bundle"
fi
for name in GITHUB_WRITE_TOKEN RIDB_API_KEY DASHBOARD_PASSPHRASE; do
  if grep -rq "$name" .next/static 2>/dev/null; then
    echo "FAIL  $name referenced in client bundle"; FAILURES=$((FAILURES + 1))
  else
    echo "PASS  $name absent from client bundle"
  fi
done

if [ -f middleware.ts ] || [ -f middleware.js ]; then
  echo "FAIL  a middleware.ts/js file exists — Next.js 16 silently ignores it"; FAILURES=$((FAILURES + 1))
else
  echo "PASS  no middleware.ts (proxy.ts is the correct Next.js 16 name)"
fi
if grep -q 'export function proxy' proxy.ts; then
  echo "PASS  proxy.ts exports proxy()"
else
  echo "FAIL  proxy.ts does not export proxy()"; FAILURES=$((FAILURES + 1))
fi

echo "---"
if [ "$FAILURES" -gt 0 ]; then echo "$FAILURES check(s) FAILED"; exit 1; fi
echo "all auth-gate checks passed"

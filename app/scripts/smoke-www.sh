#!/usr/bin/env bash
# Post-deploy smoke test of the www redirect Worker (workers/www): a permanent redirect to the
# same path and query on the app origin, over HTTPS, and plain HTTP lands on HTTPS first.
set -euo pipefail
www="${1:?usage: smoke-www.sh https://www.host https://host}"
app="${2:?usage: smoke-www.sh https://www.host https://host}"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
probe() { curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "$1" 2>/dev/null || true; }

path='/pomoc?from=smoke'
# A freshly attached Custom Domain needs a moment for DNS and the edge certificate.
for attempt in $(seq 1 18); do
  got="$(probe "$www$path")"
  [[ "$got" == "301 $app$path" ]] && break
  echo "waiting for $www ($attempt/18, got ${got:-no response})"
  sleep 10
done
[[ "$(probe "$www$path")" == "301 $app$path" ]] || fail "$www$path must redirect to $app$path"
[[ "$(probe "$www/")" == "301 $app/" ]] || fail "$www/ must redirect to $app/"
hsts="$(curl -sS -o /dev/null -D - "$www/" | tr -d '\r' | awk 'tolower($1) == "strict-transport-security:"')"
[[ -n "$hsts" ]] || fail "$www/: Strict-Transport-Security missing"
# Zone setting "Always Use HTTPS": http://www goes to https://www (then to the app).
[[ "$(probe "http://${www#https://}/")" == "301 $www/" ]] || fail "http://www must go to HTTPS"
echo "www smoke OK"

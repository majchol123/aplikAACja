#!/usr/bin/env bash
# Post-deploy smoke test: public pages, security headers, API auth gate, OIDC redirect.
set -euo pipefail
origin="${1:?usage: smoke.sh https://host}"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

status() { curl -sS -o /dev/null -w '%{http_code}' "$origin$1"; }
[[ "$(status /api/health)" == 200 ]] || fail "/api/health"
[[ "$(status /)" == 200 ]] || fail "/"
[[ "$(status /prywatnosc)" == 200 ]] || fail "/prywatnosc"
[[ "$(status /api/me)" == 401 ]] || fail "/api/me must require a session"

headers="$(curl -sSI "$origin/")"
grep -qi "^content-security-policy: default-src 'self'; script-src 'self'" <<<"$headers" || fail "CSP missing on /"
grep -qi '^x-frame-options: DENY' <<<"$headers" || fail "X-Frame-Options missing on /"

location="$(curl -sS -o /dev/null -D - "$origin/api/auth/login" | tr -d '\r' | awk -F': ' 'tolower($1)=="location"{print $2}')"
[[ "$location" == https://accounts.google.com/* ]] || fail "login does not redirect to Google"
encoded="$(sed 's/:/%3A/g; s#/#%2F#g' <<<"$origin")"
grep -qF "redirect_uri=${encoded}%2Fapi%2Fauth%2Fcallback&" <<<"$location" || fail "unexpected redirect_uri"
echo "smoke OK: $origin"

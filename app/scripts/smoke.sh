#!/usr/bin/env bash
# Post-deploy smoke test: public pages, security headers, API auth gate, OIDC redirect.
set -euo pipefail
origin="${1:?usage: smoke.sh https://host}"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

status() { curl -sS -o /dev/null -w '%{http_code}' "$origin$1"; }

# A freshly attached Custom Domain needs a moment for DNS and the edge certificate.
for attempt in $(seq 1 18); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$origin/api/health" 2>/dev/null || true)"
  [[ "$code" == 200 ]] && break
  echo "waiting for $origin ($attempt/18, got ${code:-no response})"
  sleep 10
done
[[ "$(status /api/health)" == 200 ]] || fail "/api/health"
[[ "$(status /)" == 200 ]] || fail "/"
[[ "$(status /prywatnosc)" == 200 ]] || fail "/prywatnosc"
[[ "$(status /api/me)" == 401 ]] || fail "/api/me must require a session"

# Symbol sets: public ARASAAC mirror (separate Worker on a route), gated extra set.
manifest="$(curl -sS "$origin/sym/arasaac/manifest.json")"
index="$(python3 -c 'import json,sys; m=json.loads(sys.argv[1]); assert m["set"]=="arasaac" and m["count"]>10000 and m["categories"]; print(m["index"])' "$manifest")" ||
  fail "ARASAAC manifest invalid"
[[ "$(status "/sym/arasaac/$index")" == 200 ]] || fail "ARASAAC index missing"
# The grammar lexicon (F8) comes with the mirror's own workflow; once listed it must be there.
grammar="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("grammar", ""))' "$manifest")"
if [[ -n "$grammar" ]]; then
  [[ "$(status "/sym/arasaac/$grammar")" == 200 ]] || fail "ARASAAC grammar lexicon missing"
fi
[[ "$(status /sym/extra/manifest.json)" == 401 ]] || fail "/sym/extra/* must require a session"

privacy="$(curl -sS "$origin/prywatnosc")"
grep -q 'href="mailto:[^"%]*@' <<<"$privacy" || fail "contact address missing on /prywatnosc"
# Email Obfuscation (zone Configuration Rule) must stay off: its injected script breaks the CSP.
! grep -q 'email-protection' <<<"$privacy" || fail "Cloudflare Email Obfuscation rewrote /prywatnosc"

# Security headers of every kind of response (PLAN §4.2). Static files come from the built
# `_headers` (no Worker involved), API answers from the Worker's middleware.
fetch_headers() { curl -sS -o /dev/null -D - "$@" | tr -d '\r' | tr '[:upper:]' '[:lower:]'; }
value() { awk -v n="$1:" '$1 == n { sub(/^[^:]*: /, ""); print; exit }' <<<"$2"; }
expect() { # expect <where> <headers> <name> <extended regex of the lowercased value>
  local got
  got="$(value "$3" "$2")"
  [[ "$got" =~ $4 ]] || fail "$1: $3 is '${got:-missing}'"
}
common() { # headers every response carries
  expect "$1" "$2" strict-transport-security '^max-age=([0-9]+); includesubdomains'
  (( BASH_REMATCH[1] >= 15552000 )) || fail "$1: HSTS max-age below 180 days"
  expect "$1" "$2" x-content-type-options '^nosniff$'
  expect "$1" "$2" x-frame-options '^deny$'
  expect "$1" "$2" referrer-policy '^no-referrer$'
  expect "$1" "$2" cross-origin-opener-policy '^same-origin$'
  expect "$1" "$2" cross-origin-resource-policy '^same-origin$'
  expect "$1" "$2" cross-origin-embedder-policy '^require-corp$'
  expect "$1" "$2" permissions-policy 'geolocation=\(\)'
}
page_csp=""
for path in / /prywatnosc /o-aplikacji /pomoc; do
  [[ "$(status "$path")" == 200 ]] || fail "$path"
  h="$(fetch_headers "$origin$path")"
  common "$path" "$h"
  csp="$(value content-security-policy "$h")"
  for directive in "default-src 'self'" "script-src 'self';" "object-src 'none'" "base-uri 'none'" \
    "form-action 'self'" "frame-ancestors 'none'"; do
    [[ "$csp" == *"$directive"* ]] || fail "$path: CSP lacks $directive"
  done
  [[ "$csp" != *unsafe-* ]] || fail "$path: CSP allows unsafe-*"
  [[ -z "$page_csp" || "$csp" == "$page_csp" ]] || fail "$path: CSP differs from /"
  page_csp="$csp"
done
asset="$(curl -sS "$origin/" | grep -o '/assets/main-[A-Za-z0-9_-]*\.js' | head -1)"
[[ -n "$asset" ]] || fail "no app script on /"
expect "$asset" "$(fetch_headers "$origin$asset")" cache-control 'immutable'
expect /sw.js "$(fetch_headers "$origin/sw.js")" cache-control '^no-cache$'
for path in /api/health /api/me; do
  h="$(fetch_headers -H 'Origin: https://attacker.example' "$origin$path")"
  common "$path" "$h"
  expect "$path" "$h" content-security-policy "^default-src 'none'; frame-ancestors 'none'; sandbox$"
  expect "$path" "$h" cache-control '^no-store$'
  [[ -z "$(value access-control-allow-origin "$h")" ]] || fail "$path: CORS open"
done
# Unknown paths get the app's index.html, so a 200 alone does not prove the page is there.
help="$(curl -sS "$origin/pomoc")"
grep -q '<title>Pomoc' <<<"$help" || fail "/pomoc is not the help page"
grep -q 'href="mailto:[^"%]*@' <<<"$help" || fail "contact address missing on /pomoc"

location="$(curl -sS -o /dev/null -D - "$origin/api/auth/login" | tr -d '\r' | awk -F': ' 'tolower($1)=="location"{print $2}')"
[[ "$location" == https://accounts.google.com/* ]] || fail "login does not redirect to Google"
encoded="$(sed 's/:/%3A/g; s#/#%2F#g' <<<"$origin")"
grep -qF "redirect_uri=${encoded}%2Fapi%2Fauth%2Fcallback&" <<<"$location" || fail "unexpected redirect_uri"
echo "smoke OK: $origin"

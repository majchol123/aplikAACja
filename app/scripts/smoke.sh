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
index="$(python3 -c 'import json,sys; m=json.loads(sys.argv[1]); assert m["set"]=="arasaac" and m["count"]>10000; print(m["index"])' "$manifest")" ||
  fail "ARASAAC manifest invalid"
[[ "$(status "/sym/arasaac/$index")" == 200 ]] || fail "ARASAAC index missing"
[[ "$(status /sym/extra/manifest.json)" == 401 ]] || fail "/sym/extra/* must require a session"

privacy="$(curl -sS "$origin/prywatnosc")"
grep -q 'href="mailto:[^"%]*@' <<<"$privacy" || fail "contact address missing on /prywatnosc"
# Email Obfuscation (zone Configuration Rule) must stay off: its injected script breaks the CSP.
! grep -q 'email-protection' <<<"$privacy" || fail "Cloudflare Email Obfuscation rewrote /prywatnosc"

headers="$(curl -sSI "$origin/")"
grep -qi "^content-security-policy: default-src 'self'; script-src 'self'" <<<"$headers" || fail "CSP missing on /"
grep -qi '^x-frame-options: DENY' <<<"$headers" || fail "X-Frame-Options missing on /"

location="$(curl -sS -o /dev/null -D - "$origin/api/auth/login" | tr -d '\r' | awk -F': ' 'tolower($1)=="location"{print $2}')"
[[ "$location" == https://accounts.google.com/* ]] || fail "login does not redirect to Google"
encoded="$(sed 's/:/%3A/g; s#/#%2F#g' <<<"$origin")"
grep -qF "redirect_uri=${encoded}%2Fapi%2Fauth%2Fcallback&" <<<"$location" || fail "unexpected redirect_uri"
echo "smoke OK: $origin"

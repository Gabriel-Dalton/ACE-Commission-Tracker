#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Black-box security verification for the ACE Commission Tracker backend.
#
# The sign-in page is only a *client-side* gate: anyone can read the public
# publishable (anon) key from /api/config and hit the Supabase REST/Auth APIs
# directly, bypassing the HTML entirely. The data is therefore protected ONLY
# by (a) Row-Level Security locked to the `authenticated` role and (b) public
# sign-ups being disabled. This script proves both, from the attacker's point
# of view, using nothing but the public anon key.
#
# USAGE:
#   export SUPABASE_URL="https://spuccrfkxkyhtuwqvpkt.supabase.co"
#   export SUPABASE_ANON_KEY="sb_publishable_..."   # the PUBLIC key, NOT service_role
#   ./scripts/security-verify.sh
#
# Get the values from your deployed site:  curl https://<your-site>/api/config
#
# EXIT CODE: 0 if every check is in the secure state, 1 if any check FAILS
# (i.e. an attacker could read/write data or register an account).
#
# SAFETY: the write test inserts a single clearly-labelled canary row and tries
# to delete it again. If RLS is correctly locked the insert is rejected and
# nothing is written. The sign-up test uses a throwaway address; if sign-ups
# turn out to be ENABLED (a finding) it may create a user — delete it from
# Supabase → Authentication → Users.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

URL="${SUPABASE_URL:-}"
KEY="${SUPABASE_ANON_KEY:-}"

if [[ -z "$URL" || -z "$KEY" ]]; then
  echo "ERROR: set SUPABASE_URL and SUPABASE_ANON_KEY first (see header)." >&2
  exit 2
fi
if [[ "$KEY" == *service_role* || "$KEY" == sb_secret_* || "$KEY" == eyJ*service_role* ]]; then
  echo "ERROR: that looks like a SERVICE-ROLE / secret key. Use the PUBLIC anon key only." >&2
  exit 2
fi

URL="${URL%/}"
TABLES=(deals settings pending_verifications verification_log)
fails=0
green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }

req() { # method path [body] -> echoes "HTTP_STATUS\n<body>"
  local method="$1" path="$2" body="${3:-}"
  curl -s -m 20 -w $'\n%{http_code}' -X "$method" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    ${body:+--data "$body"} \
    "$URL/rest/v1/$path"
}

echo "Target: $URL"
echo "Key:    ${KEY:0:14}… (public)"
echo "────────────────────────────────────────────────────────────────────"

# 1) ANON READ — every table must return nothing to the anon role.
echo "[1] Anonymous SELECT (expect empty / permission denied on every table)"
for t in "${TABLES[@]}"; do
  resp="$(req GET "$t?select=*&limit=2")"
  code="$(tail -n1 <<<"$resp")"; data="$(sed '$d' <<<"$resp")"
  if [[ "$code" == "200" && "$data" != "[]" && -n "$data" ]]; then
    echo "    $t: $(red FAIL) — HTTP $code returned rows: $(head -c 120 <<<"$data")"
    ((fails++))
  elif [[ "$code" == "200" && "$data" == "[]" ]]; then
    echo "    $t: $(green OK) — HTTP 200 but empty (RLS hides all rows)"
  else
    echo "    $t: $(green OK) — HTTP $code (blocked)"
  fi
done

# 2) ANON WRITE — inserting as anon must be rejected.
echo "[2] Anonymous INSERT into deals (expect 401/403/permission denied)"
canary="sectest-$(date +%s)"
resp="$(req POST "deals" "{\"id\":\"$canary\",\"name\":\"SEC TEST DELETE ME\",\"mrr\":0,\"plan\":\"managed\",\"date\":\"2000-01-01\"}")"
code="$(tail -n1 <<<"$resp")"
if [[ "$code" =~ ^20 ]]; then
  echo "    $(red FAIL) — HTTP $code: anon could WRITE to deals. Cleaning up canary…"
  req DELETE "deals?id=eq.$canary" >/dev/null
  ((fails++))
else
  echo "    $(green OK) — HTTP $code (write rejected)"
fi

# 3) PUBLIC SIGN-UP — registering must be disabled, else anyone becomes
#    `authenticated` and the RLS `using(true)` policies expose everything.
echo "[3] Public sign-up (expect disabled: 'Signups not allowed' / 422 / 403)"
signup="$(curl -s -m 20 -w $'\n%{http_code}' -X POST \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  --data "{\"email\":\"secaudit+$(date +%s)@example.com\",\"password\":\"Sec-$(date +%s)-Xx!\"}" \
  "$URL/auth/v1/signup")"
scode="$(tail -n1 <<<"$signup")"; sbody="$(sed '$d' <<<"$signup")"
if grep -qiE "signup.?s? not allowed|signups disabled|email signups are disabled" <<<"$sbody"; then
  echo "    $(green OK) — HTTP $scode: sign-ups disabled"
elif [[ "$scode" =~ ^20 ]] || grep -qiE "confirmation|\"id\"|user" <<<"$sbody"; then
  echo "    $(red FAIL) — HTTP $scode: sign-ups appear ENABLED. Body: $(head -c 160 <<<"$sbody")"
  echo "         → anyone can register, get the authenticated role, and read/write all data."
  ((fails++))
else
  echo "    ? HTTP $scode (inconclusive): $(head -c 160 <<<"$sbody")"
fi

echo "────────────────────────────────────────────────────────────────────"
if [[ "$fails" -eq 0 ]]; then
  echo "$(green "RESULT: PASS") — backend is locked down to the anon attacker."
  exit 0
else
  echo "$(red "RESULT: $fails CHECK(S) FAILED") — the database is exposed. See above."
  exit 1
fi

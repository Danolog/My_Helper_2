#!/usr/bin/env bash
# Sprawdzenie ZBUDOWANEGO obrazu (#110 P2) — uzupełnia tekstowy G-C1,
# który nie widzi skutków `USER ${ARG}`, `RUN` zapisującego .env, sekretów
# o nietypowych nazwach itp. Uruchamia go workflow po `docker build`,
# przed wypchnięciem; można też lokalnie: infra/gcp/verify-image.sh <obraz> [manifest].
#
# Sprawdza (kod ≠ 0 przy pierwszym naruszeniu, bez wypisywania wartości):
#  1. Config.User obrazu jest ustawiony i nie jest root (0 / root / pusty);
#  2. id -u w kontenerze ≠ 0;
#  3. Config.Env: żadna nazwa z klasy `secret` manifestu ani nazwa wyglądająca
#     na sekret (SECRET/TOKEN/PASSWORD/PRIVATE/API_KEY);
#  4. docker history --no-trunc: żadna nazwa sekretu z przypisaniem (NAZWA=);
#  5. system plików: 0 plików `.env*` (poza /proc, /sys, /dev).
set -euo pipefail

IMAGE="${1:-}"
MANIFEST="${2:-$(dirname "$0")/env-manifest.json}"
if [[ -z "$IMAGE" ]]; then
  echo "usage: $0 <image> [manifest]" >&2
  exit 2
fi

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

user="$(docker image inspect --format '{{.Config.User}}' "$IMAGE")"
case "$user" in
  "" | 0 | 0:* | root | root:*) fail "Config.User is '${user:-<empty>}' (root)" ;;
esac
echo "ok: Config.User=$user"

uid="$(docker run --rm --entrypoint id "$IMAGE" -u)"
[[ "$uid" != "0" ]] || fail "container runs as uid 0"
echo "ok: uid=$uid"

secret_names="$(node -e '
const { variables } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(Object.entries(variables).filter(([, e]) => e.class === "secret").map(([n]) => n).join("\n"));
' "$MANIFEST")"

env_names="$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" | cut -d= -f1)"
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  if grep -qxF "$name" <<<"$secret_names"; then fail "secret '$name' in image Env"; fi
  if grep -qiE 'SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY' <<<"$name"; then fail "secret-like '$name' in image Env"; fi
done <<<"$env_names"
echo "ok: Env has no secrets ($(grep -c . <<<"$env_names") names)"

history="$(docker history --no-trunc --format '{{.CreatedBy}}' "$IMAGE")"
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  if grep -qE "(^|[^A-Z0-9_])${name}=" <<<"$history"; then fail "secret '$name' assigned in image history"; fi
done <<<"$secret_names"
echo "ok: history has no secret assignments"

envfiles="$(docker run --rm --entrypoint sh "$IMAGE" -c \
  'find / -xdev \( -path /proc -o -path /sys -o -path /dev \) -prune -o -name ".env*" -print 2>/dev/null' || true)"
if [[ -n "$envfiles" ]]; then
  echo "$envfiles" | head -20 >&2
  fail ".env* files in image filesystem"
fi
echo "ok: no .env* files"

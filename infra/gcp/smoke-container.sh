#!/usr/bin/env bash
# Test dymny obrazu `runner` (Ethan, #110): serwer z obrazu (`node server.js`
# standalone), nie `pnpm start`. Bez bazy i bez prawdziwych sekretów:
# kontener ma wstać, a /api/health odpowiedzieć 503 (baza niedostępna) —
# nie paść przy starcie. Uruchamia go workflow przed wypchnięciem obrazu;
# lokalnie: infra/gcp/smoke-container.sh <obraz>.
#
# BETTER_AUTH_SECRET to jednorazowa losowa wartość z tego przebiegu (nie
# sekret środowiska); POSTGRES_URL wskazuje zamknięty port na 127.0.0.1.
# Port inny niż 8080 sprawdza, że serwer czyta PORT (Cloud Run go wstrzykuje).
set -euo pipefail

IMAGE="${1:-}"
if [[ -z "$IMAGE" ]]; then
  echo "usage: $0 <image>" >&2
  exit 2
fi
PORT_IN=9090
HOST_PORT="${SMOKE_HOST_PORT:-18090}"
name="mh-smoke-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

auth_secret="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
docker run -d --name "$name" \
  -p "127.0.0.1:${HOST_PORT}:${PORT_IN}" \
  -e PORT="$PORT_IN" \
  -e BETTER_AUTH_SECRET="$auth_secret" \
  -e BETTER_AUTH_URL="http://127.0.0.1:${HOST_PORT}" \
  -e POSTGRES_URL="postgresql://smoke:smoke@127.0.0.1:1/smoke" \
  "$IMAGE" >/dev/null

code=""
for _ in $(seq 1 60); do
  if ! docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -q true; then
    docker logs "$name" 2>&1 | tail -30 >&2
    echo "FAIL: container exited during startup" >&2
    exit 1
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/api/health" || true)"
  [[ "$code" == "200" || "$code" == "503" ]] && break
  sleep 1
done

if [[ "$code" != "503" ]]; then
  docker logs "$name" 2>&1 | tail -30 >&2
  echo "FAIL: /api/health without database returned '$code' (expected 503)" >&2
  exit 1
fi
echo "ok: /api/health -> 503 without database (server up on PORT=$PORT_IN)"

uid="$(docker exec "$name" id -u)"
[[ "$uid" != "0" ]] || { echo "FAIL: server runs as root" >&2; exit 1; }
echo "ok: server uid=$uid"

#!/usr/bin/env bash
# Test dymny obrazu `runner` (#110): serwer z obrazu (`node server.js`
# standalone), nie `pnpm start`. Uruchamia go workflow przed wypchnięciem
# obrazu; lokalnie: infra/gcp/smoke-container.sh <obraz>.
#
# Cztery przypadki, w tej kolejności:
# 1. W1 (K-1b, strażnik sekretów w register()): kontener „jak na Cloud Run”
#    (K_SERVICE + NODE_ENV=production) z BETTER_AUTH_SECRET równym wartości
#    testowej jawnej w repozytorium → kontener MUSI się zakończyć kodem 1,
#    a log MUSI zawierać komunikat strażnika („secret-guard: odmowa startu”,
#    K-1c) i nazwę zmiennej, i NIE MOŻE zawierać wartości ani jej
#    skrótu. Sprawdzane PRZED jakimkolwiek /api/health.
# 2. Tryb limitu prób logowania: ten sam tryb Cloud Run z losowym
#    BETTER_AUTH_SECRET i niedozwoloną wartością AUTH_RATE_LIMIT_STORE, bez
#    bazy → kontener MUSI się zakończyć kodem 1, a log MUSI zawierać nazwę
#    zmiennej AUTH_RATE_LIMIT_STORE i NIE MOŻE zawierać podanej wartości ani
#    wartości sekretu. Sprawdzane PRZED jakimkolwiek /api/health.
# 3. Kontrola W1: ten sam tryb Cloud Run z losową wartością i jednorazową
#    bazą (pgvector w sieci --internal, bez portu na hoście, losowe hasło)
#    → /api/health = 200 (sonda z wnętrza kontenera).
# 4. Bez bazy i bez K_SERVICE: kontener ma wstać, a /api/health odpowiedzieć
#    503 (baza niedostępna) — nie paść przy starcie. Port inny niż 8080
#    sprawdza, że serwer czyta PORT (Cloud Run go wstrzykuje).
#
# Wartość testowa W1 stoi niżej jako literał przypisania (tablica w1_env), więc
# strażnik G-K1 (__tests__/lib/secret-guard.test.ts) wymaga jej skrótu na
# liście zakazanej — przypadek 1 nie może po cichu przestać jej używać.
# Pozostałe wartości (BETTER_AUTH_SECRET przypadków 2 i 3, hasło bazy) są
# losowe z tego przebiegu. POSTGRES_URL przypadków 2 i 4 wskazuje zamknięty
# port. Niedozwolona wartość trybu limitu to zwykły, nietajny napis.
# Strażnik skryptu: __tests__/lib/smoke-container.test.ts (fałszywy docker).
set -euo pipefail

IMAGE="${1:-}"
if [[ -z "$IMAGE" ]]; then
  echo "usage: $0 <image>" >&2
  exit 2
fi
PORT_IN=9090
HOST_PORT="${SMOKE_HOST_PORT:-18090}"
WAIT="${SMOKE_WAIT:-60}"
name="mh-smoke-$$"
guard_name="mh-smoke-guard-$$"
store_name="mh-smoke-store-$$"
ctl_name="mh-smoke-ctl-$$"
db_name="mh-smoke-db-$$"
net="mh-smoke-net-$$"
cleanup() {
  docker rm -f "$name" "$guard_name" "$store_name" "$ctl_name" "$db_name" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

rand_hex() { node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; }

# --- 1. W1: wartość testowa z repozytorium → odmowa startu (kod 1) ---------
w1_env=("BETTER_AUTH_SECRET=smoke-w1-public-test-value-must-be-refused")
w1_value="${w1_env[0]#*=}"
w1_sha="$(printf '%s' "$w1_value" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(require("crypto").createHash("sha256").update(s).digest("hex")))')"
guard_pg="postgresql://smoke:$(rand_hex 16)@127.0.0.1:1/smoke"
docker run -d --name "$guard_name" \
  -e K_SERVICE=myhelper \
  -e NODE_ENV=production \
  -e "${w1_env[0]}" \
  -e BETTER_AUTH_URL="http://127.0.0.1:${HOST_PORT}" \
  -e POSTGRES_URL="$guard_pg" \
  "$IMAGE" >/dev/null
status=""
for _ in $(seq 1 "$WAIT"); do
  status="$(docker inspect -f '{{.State.Status}}' "$guard_name" 2>/dev/null || true)"
  [[ "$status" == "exited" || "$status" == "dead" ]] && break
  sleep 1
done
if [[ "$status" != "exited" && "$status" != "dead" ]]; then
  echo "FAIL: W1: container with a public test BETTER_AUTH_SECRET still running after ${WAIT}s (secret guard did not refuse start)" >&2
  exit 1
fi
guard_exit="$(docker inspect -f '{{.State.ExitCode}}' "$guard_name")"
guard_log="$(docker logs "$guard_name" 2>&1 || true)"
w1_fail=""
[[ "$guard_exit" == "1" ]] || w1_fail+=" exit code [$guard_exit], expected [1];"
[[ "$guard_log" == *"secret-guard: odmowa startu"* ]] || w1_fail+=" log lacks the secret-guard refusal message;"
[[ "$guard_log" == *BETTER_AUTH_SECRET* ]] || w1_fail+=" log lacks the variable name BETTER_AUTH_SECRET;"
[[ "$guard_log" != *"$w1_value"* ]] || w1_fail+=" log contains the secret value;"
[[ "$guard_log" != *"$w1_sha"* ]] || w1_fail+=" log contains the secret hash;"
if [[ -n "$w1_fail" ]]; then
  # Log bez wypisywania: mógłby zawierać wartość.
  echo "FAIL: W1:$w1_fail" >&2
  exit 1
fi
echo "ok: W1: public test BETTER_AUTH_SECRET → exit 1, log names the variable only"

# --- 2. Niedozwolona wartość AUTH_RATE_LIMIT_STORE → odmowa startu (kod 1) --
store_value="redis-not-allowed"
store_secret="$(rand_hex 32)"
store_pg="postgresql://smoke:$(rand_hex 16)@127.0.0.1:1/smoke"
docker run -d --name "$store_name" \
  -e K_SERVICE=myhelper \
  -e NODE_ENV=production \
  -e BETTER_AUTH_SECRET="$store_secret" \
  -e BETTER_AUTH_URL="http://127.0.0.1:${HOST_PORT}" \
  -e POSTGRES_URL="$store_pg" \
  -e AUTH_RATE_LIMIT_STORE="$store_value" \
  "$IMAGE" >/dev/null
status=""
for _ in $(seq 1 "$WAIT"); do
  status="$(docker inspect -f '{{.State.Status}}' "$store_name" 2>/dev/null || true)"
  [[ "$status" == "exited" || "$status" == "dead" ]] && break
  sleep 1
done
if [[ "$status" != "exited" && "$status" != "dead" ]]; then
  echo "FAIL: rate-limit store: container with an invalid AUTH_RATE_LIMIT_STORE still running after ${WAIT}s (startup check did not refuse start)" >&2
  exit 1
fi
store_exit="$(docker inspect -f '{{.State.ExitCode}}' "$store_name")"
store_log="$(docker logs "$store_name" 2>&1 || true)"
store_fail=""
[[ "$store_exit" == "1" ]] || store_fail+=" exit code [$store_exit], expected [1];"
[[ "$store_log" == *AUTH_RATE_LIMIT_STORE* ]] || store_fail+=" log lacks the variable name AUTH_RATE_LIMIT_STORE;"
[[ "$store_log" != *"$store_value"* ]] || store_fail+=" log contains the AUTH_RATE_LIMIT_STORE value;"
[[ "$store_log" != *"$store_secret"* ]] || store_fail+=" log contains the BETTER_AUTH_SECRET value;"
if [[ -n "$store_fail" ]]; then
  # Log bez wypisywania: mógłby zawierać wartość.
  echo "FAIL: rate-limit store:$store_fail" >&2
  exit 1
fi
echo "ok: rate-limit store: invalid AUTH_RATE_LIMIT_STORE → exit 1, log names the variable only"
docker rm -f "$store_name" >/dev/null 2>&1 || true

# --- 3. Kontrola W1: losowa wartość + baza → /api/health 200 ---------------
docker network create --internal "$net" >/dev/null
db_pw="$(rand_hex 16)"
docker run -d --name "$db_name" --network "$net" \
  -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD="$db_pw" -e POSTGRES_DB=smoke \
  pgvector/pgvector:pg18 >/dev/null
db_ready=0
for _ in $(seq 1 "$WAIT"); do
  if docker exec "$db_name" pg_isready -U smoke -d smoke >/dev/null 2>&1; then db_ready=1; break; fi
  sleep 1
done
[[ "$db_ready" == 1 ]] || { echo "FAIL: W1 control: database not ready after ${WAIT}s" >&2; exit 1; }
docker run -d --name "$ctl_name" --network "$net" \
  -e K_SERVICE=myhelper \
  -e NODE_ENV=production \
  -e PORT=8080 \
  -e BETTER_AUTH_SECRET="$(rand_hex 32)" \
  -e BETTER_AUTH_URL="http://127.0.0.1:8080" \
  -e POSTGRES_URL="postgresql://smoke:${db_pw}@${db_name}:5432/smoke" \
  "$IMAGE" >/dev/null
ctl_code=""
for _ in $(seq 1 "$WAIT"); do
  if ! docker inspect -f '{{.State.Running}}' "$ctl_name" 2>/dev/null | grep -q true; then
    docker logs "$ctl_name" 2>&1 | tail -30 >&2
    echo "FAIL: W1 control: container with a random BETTER_AUTH_SECRET exited during startup" >&2
    exit 1
  fi
  ctl_code="$(docker exec "$ctl_name" node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>console.log(r.status)).catch(()=>console.log(0))" 2>/dev/null || true)"
  [[ "$ctl_code" == "200" ]] && break
  sleep 1
done
if [[ "$ctl_code" != "200" ]]; then
  docker logs "$ctl_name" 2>&1 | tail -30 >&2
  echo "FAIL: W1 control: /api/health with database returned '$ctl_code' (expected 200)" >&2
  exit 1
fi
echo "ok: W1 control: random BETTER_AUTH_SECRET in Cloud Run mode → /api/health 200 with database"
docker rm -f "$ctl_name" "$db_name" >/dev/null 2>&1 || true

# --- 4. Bez bazy: serwer wstaje, /api/health 503 --------------------------
auth_secret="$(rand_hex 32)"
docker run -d --name "$name" \
  -p "127.0.0.1:${HOST_PORT}:${PORT_IN}" \
  -e PORT="$PORT_IN" \
  -e BETTER_AUTH_SECRET="$auth_secret" \
  -e BETTER_AUTH_URL="http://127.0.0.1:${HOST_PORT}" \
  -e POSTGRES_URL="postgresql://smoke:smoke@127.0.0.1:1/smoke" \
  "$IMAGE" >/dev/null

code=""
for _ in $(seq 1 "$WAIT"); do
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

#!/usr/bin/env bash
# Wdrożenie usługi Cloud Run MyHelper (brief C §5, zadanie 0.9).
#
# Jedyny nośnik konfiguracji usługi. Uruchamia go workflow
# .github/workflows/deploy-cloud-run.yml (tylko workflow_dispatch do C4)
# i — awaryjnie — człowiek z terminala. NIE URUCHAMIAĆ w kroku C.
#
# Tryby:
#   infra/gcp/run-deploy.sh deploy    # nowa wersja BEZ ruchu, z tagiem; wypisuje URL tagu
#   infra/gcp/run-deploy.sh promote   # 100% ruchu na wersję z tagu (po teście dymnym)
#
# Wymagane zmienne (brak którejkolwiek → błąd przed pierwszym wywołaniem gcloud):
#   PROJECT_ID, REGION, SERVICE, IMAGE (pełna nazwa z digestem albo tagiem),
#   RUNTIME_SA (konto serwisowe usługi), REVISION_TAG (np. sha-<7 znaków>),
#   SQL_INSTANCE (nazwa instancji Cloud SQL — połączenie przez wbudowany
#   konektor: --set-cloudsql-instances=PROJECT_ID:REGION:SQL_INSTANCE, K-1)
# Opcjonalne: VPC_NETWORK + VPC_SUBNET (bezpośrednie wyjście do VPC — Cloud SQL
#   po prywatnym IP, decyzja kroku D), MANIFEST (domyślnie infra/gcp/env-manifest.json).
#
# Konfiguracja z manifestu (strażnik G-C4):
# - klasa `secret` → --set-secrets NAZWA=<secretName>:latest (tylko nazwy,
#   wartości są w Secret Manager i nigdy nie przechodzą przez ten skrypt).
#   Mapowane są WYŁĄCZNIE sekrety, których najnowsza wersja ma stan ENABLED
#   (odczyt metadanych `secrets versions list --sort-by=~createTime --limit=1`,
#   bez wartości; pusty wynik = brak wersji, kod ≠ 0 = błąd odczytu).
#   Sekret `required: true` bez wersji → błąd PRZED `gcloud run deploy`;
#   opcjonalny bez wersji → pominięty (moduł wyłącza się sam). Błąd odczytu
#   (np. brak uprawnień) → błąd, nigdy ciche pominięcie.
#   Żadnych wersji-zaślepek (K-1, przyjęta zasada).
#   Para STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET: obie z wersją albo żadna (K-1b).
# - klasa `var` → wartość z otoczenia procesu (workflow podaje ją z `vars.*`);
#   `required: true` i brak wartości → błąd; opcjonalna i brak → pominięta.
#   Wartości idą przez --env-vars-file (plik tymczasowy, usuwany przy wyjściu),
#   nie przez argumenty — przecinki w adresach i nazwach firm nie psują listy.
# - pozostałe klasy (build, platform, ci-only, removed-after-b, vercel-only)
#   NIGDY nie trafiają do usługi.
#
# Dostęp publiczny: skrypt NIE podaje --allow-unauthenticated — wdrożenie
# zachowuje istniejącą politykę IAM usługi (allUsers: run.invoker ustawia raz
# infra/gcp/bootstrap.sh, etap run). Konto deploy nie ma setIamPolicy.
#
# Zdrowie: sonda startowa HTTP na /api/health. Sondy żywotności NIE ustawiamy:
# /api/health pinguje bazę, chwilowy brak bazy restartowałby wszystkie instancje.
set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "deploy" && "$MODE" != "promote" ]]; then
  echo "usage: $0 deploy|promote" >&2
  exit 2
fi

required=(PROJECT_ID REGION SERVICE REVISION_TAG)
if [[ "$MODE" == "deploy" ]]; then required+=(IMAGE RUNTIME_SA SQL_INSTANCE); fi
missing=()
for v in "${required[@]}"; do
  if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: missing required env: ${missing[*]}" >&2
  exit 2
fi
if [[ ! "$REVISION_TAG" =~ ^[a-z][a-z0-9-]{0,45}$ ]]; then
  echo "error: REVISION_TAG must match ^[a-z][a-z0-9-]{0,45}$" >&2
  exit 2
fi

GC=(gcloud --project="$PROJECT_ID" --quiet)

if [[ "$MODE" == "promote" ]]; then
  "${GC[@]}" run services update-traffic "$SERVICE" --region="$REGION" --to-tags="$REVISION_TAG=100"
  exit 0
fi

MANIFEST="${MANIFEST:-$(dirname "$0")/env-manifest.json}"
if [[ ! -f "$MANIFEST" ]]; then
  echo "error: manifest not found: $MANIFEST" >&2
  exit 2
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Manifest → lista sekretów i plik zmiennych (node jest w obrazie runnera CI).
MANIFEST="$MANIFEST" OUT_DIR="$workdir" node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const { variables } = JSON.parse(readFileSync(process.env.MANIFEST, "utf8"));
const secrets = [];
const vars = [];
const missing = [];
for (const [name, e] of Object.entries(variables)) {
  if (e.class === "secret") secrets.push(`${name} ${e.secretName} ${e.required === true ? 1 : 0}`);
  if (e.class === "var") {
    const value = process.env[name];
    if (value === undefined || value === "") {
      if (e.required) missing.push(name);
      continue;
    }
    vars.push(`${name}: ${JSON.stringify(value)}`);
  }
}
if (missing.length) {
  console.error(`error: missing required service vars: ${missing.join(" ")}`);
  process.exit(2);
}
writeFileSync(`${process.env.OUT_DIR}/secrets-all.txt`, secrets.join("\n") + "\n");
writeFileSync(`${process.env.OUT_DIR}/env.yaml`, vars.join("\n") + "\n");
console.log(`manifest: ${secrets.length} secrets, ${vars.length} vars`);
'

# Sekrety z wersją → --set-secrets; wymagany bez wersji → stop przed deployem.
mapped=()
missing_secrets=()
while read -r env_name secret_name is_required; do
  [[ -n "$env_name" ]] || continue
  # Najnowsza wersja (to na nią wskazuje alias `latest`) i jej stan. `versions
  # list` kończy się kodem 0 także dla sekretu bez wersji (puste wyjście), więc
  # brak wersji nie jest rozpoznawany po tekście błędu (K-1b, jak secret_has_version
  # w bootstrap.sh): kod ≠ 0 = błąd odczytu → stop. Przyczyna (pierwsze linie
  # stderr gcloud — metadane, bez wartości sekretów) idzie do operatora (K-1c).
  if ! state="$("${GC[@]}" secrets versions list "$secret_name" --sort-by=~createTime --limit=1 \
    --format='value(state)' 2>"$workdir/list.err")"; then
    echo "error: cannot read versions of secret $secret_name — stop" >&2
    sed -n '1,3s/^/  cause: /p' "$workdir/list.err" >&2
    exit 2
  fi
  if [[ -z "$state" ]]; then
    state="MISSING"
    if [[ "$is_required" == 1 ]]; then
      echo "error: required secret $secret_name has no versions" >&2
    fi
  fi
  if [[ "$state" == "ENABLED" ]]; then
    mapped+=("${env_name}=${secret_name}:latest")
  elif [[ "$is_required" == 1 ]]; then
    missing_secrets+=("$secret_name")
  else
    echo "skip: optional secret $secret_name has no enabled version ($state)"
  fi
done <"$workdir/secrets-all.txt"
if [[ ${#missing_secrets[@]} -gt 0 ]]; then
  echo "error: required secrets without an enabled version: ${missing_secrets[*]}" >&2
  exit 2
fi
if [[ ${#mapped[@]} -eq 0 ]]; then
  echo "error: no secrets to map" >&2
  exit 2
fi
# Para Stripe (K-1b): klucz API i sekret webhooka — oba albo żaden. Ten sam
# warunek sprawdza strażnik startu (infra/runtime/secret-guard.mjs).
stripe_mapped=()
for m in "${mapped[@]}"; do
  case "${m%%=*}" in
    STRIPE_SECRET_KEY | STRIPE_WEBHOOK_SECRET) stripe_mapped+=("${m%%=*}") ;;
  esac
done
if [[ ${#stripe_mapped[@]} -eq 1 ]]; then
  echo "error: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must both have an enabled version or neither (only ${stripe_mapped[0]}) — stop" >&2
  exit 2
fi
(IFS=,; printf '%s' "${mapped[*]}") >"$workdir/secrets.txt"
echo "secrets: ${#mapped[@]} mapped"
CLOUDSQL_INSTANCE="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

network=()
if [[ -n "${VPC_NETWORK:-}" || -n "${VPC_SUBNET:-}" ]]; then
  if [[ -z "${VPC_NETWORK:-}" || -z "${VPC_SUBNET:-}" ]]; then
    echo "error: VPC_NETWORK and VPC_SUBNET must be set together" >&2
    exit 2
  fi
  network=(--network="$VPC_NETWORK" --subnet="$VPC_SUBNET" --vpc-egress=private-ranges-only)
fi

"${GC[@]}" run deploy "$SERVICE" \
  --region="$REGION" \
  --image="$IMAGE" \
  --service-account="$RUNTIME_SA" \
  --no-traffic \
  --tag="$REVISION_TAG" \
  --port=8080 \
  --execution-environment=gen2 \
  --cpu=1 \
  --memory=1Gi \
  --concurrency=80 \
  --timeout=300 \
  --min-instances=0 \
  --max-instances=3 \
  --set-cloudsql-instances="$CLOUDSQL_INSTANCE" \
  --startup-probe="httpGet.path=/api/health,httpGet.port=8080,initialDelaySeconds=0,timeoutSeconds=3,periodSeconds=5,failureThreshold=24" \
  --set-secrets="$(cat "$workdir/secrets.txt")" \
  --env-vars-file="$workdir/env.yaml" \
  ${network[@]+"${network[@]}"}

url="$("${GC[@]}" run services describe "$SERVICE" --region="$REGION" \
  --format="value(status.traffic[].url)" | tr ';' '\n' | grep -E "^https://${REVISION_TAG}---" | head -n1 || true)"
if [[ -z "$url" ]]; then
  echo "error: tagged revision URL not found for $REVISION_TAG" >&2
  exit 1
fi
echo "tag_url=$url"

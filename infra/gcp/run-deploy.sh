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
#   RUNTIME_SA (konto serwisowe usługi), REVISION_TAG (np. sha-<7 znaków>)
# Opcjonalne: VPC_NETWORK + VPC_SUBNET (bezpośrednie wyjście do VPC — Cloud SQL
#   po prywatnym IP, decyzja kroku D), MANIFEST (domyślnie infra/gcp/env-manifest.json).
#
# Konfiguracja z manifestu (strażnik G-C4):
# - klasa `secret` → --set-secrets NAZWA=<secretName>:latest (tylko nazwy,
#   wartości są w Secret Manager i nigdy nie przechodzą przez ten skrypt);
# - klasa `var` → wartość z otoczenia procesu (workflow podaje ją z `vars.*`);
#   `required: true` i brak wartości → błąd; opcjonalna i brak → pominięta.
#   Wartości idą przez --env-vars-file (plik tymczasowy, usuwany przy wyjściu),
#   nie przez argumenty — przecinki w adresach i nazwach firm nie psują listy.
# - pozostałe klasy (build, platform, ci-only, removed-after-b, vercel-only)
#   NIGDY nie trafiają do usługi.
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
if [[ "$MODE" == "deploy" ]]; then required+=(IMAGE RUNTIME_SA); fi
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
  if (e.class === "secret") secrets.push(`${name}=${e.secretName}:latest`);
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
writeFileSync(`${process.env.OUT_DIR}/secrets.txt`, secrets.join(","));
writeFileSync(`${process.env.OUT_DIR}/env.yaml`, vars.join("\n") + "\n");
console.log(`manifest: ${secrets.length} secrets, ${vars.length} vars`);
'

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
  --allow-unauthenticated \
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

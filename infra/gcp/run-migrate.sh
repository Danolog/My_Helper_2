#!/usr/bin/env bash
# Migracja bazy przez Cloud Run Job `myhelper-migrate` (brief C §1, decyzja:
# Job z celu `migrator`, ten sam commit co usługa). NIE URUCHAMIAĆ w kroku C.
# Migrację produkcyjną uruchamia Ethan (delegacja v1.12) — w workflow tylko
# przy wejściu run_migrations=true.
#
# Kolejność: (1) kopia zapasowa na żądanie Cloud SQL (bramka b, v1.26),
#            (2) aktualizacja Joba do obrazu migratora z tego commita,
#            (3) wykonanie z --wait; kod ≠ 0 → wdrożenie usługi nie rusza.
#
# Wymagane: PROJECT_ID, REGION, SQL_INSTANCE, MIGRATOR_IMAGE, RUNTIME_SA.
# Opcjonalne: VPC_NETWORK + VPC_SUBNET (jak run-deploy.sh), JOB (domyślnie myhelper-migrate).
# POSTGRES_URL: tylko z Secret Manager (sekret postgres-url), nigdy z argumentu.
set -euo pipefail

missing=()
for v in PROJECT_ID REGION SQL_INSTANCE MIGRATOR_IMAGE RUNTIME_SA; do
  if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: missing required env: ${missing[*]}" >&2
  exit 2
fi

JOB="${JOB:-myhelper-migrate}"
GC=(gcloud --project="$PROJECT_ID" --quiet)

network=()
if [[ -n "${VPC_NETWORK:-}" || -n "${VPC_SUBNET:-}" ]]; then
  if [[ -z "${VPC_NETWORK:-}" || -z "${VPC_SUBNET:-}" ]]; then
    echo "error: VPC_NETWORK and VPC_SUBNET must be set together" >&2
    exit 2
  fi
  network=(--network="$VPC_NETWORK" --subnet="$VPC_SUBNET" --vpc-egress=private-ranges-only)
fi

echo "backup: on-demand Cloud SQL backup before migration"
"${GC[@]}" sql backups create --instance="$SQL_INSTANCE" --description="pre-migrate ${MIGRATOR_IMAGE##*:}"

"${GC[@]}" run jobs deploy "$JOB" \
  --region="$REGION" \
  --image="$MIGRATOR_IMAGE" \
  --service-account="$RUNTIME_SA" \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=600s \
  --set-secrets="POSTGRES_URL=postgres-url:latest" \
  ${network[@]+"${network[@]}"}

"${GC[@]}" run jobs execute "$JOB" --region="$REGION" --wait
echo "migrate: done"

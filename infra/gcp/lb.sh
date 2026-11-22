#!/usr/bin/env bash
# regionalny load balancer HTTPS przed Cloud Run
# `myhelper` dla app.nordsignal.cc. Osobny plik, nie etap bootstrap.sh.
# Procedura: docs/runbook-krok-d.md, sekcja „LB”.
#
# KTO URUCHAMIA: wyłącznie sesja główna (Z1), po recenzji. Agenci nie
# wykonują tego skryptu na projekcie.
#
# DOMYŚLNIE --dry-run: skrypt NICZEGO nie wykonuje, ani odczytu, ani zmiany.
# Wypisuje tylko polecenia: `? …` dla odczytu stanu, `+ …` dla zmiany.
# Dopiero `--apply` wykonuje odczyty stanu i zmiany.
#
# Decyzje architektury: LB regionalny w europe-central2 (EXTERNAL_MANAGED,
# podsieć proxy-only), certyfikat Google-managed przez autoryzację DNS
# w Certificate Manager, ingress usługi Cloud Run zostaje `all` na betę (dług
# z progiem w projekcie) — skrypt NIE zmienia usługi Cloud Run.
# Brak `add-iam-policy-binding`: LB nie dostaje żadnych ról.
#
# Kolejność tworzenia (§2 P1):
#   (1) API compute, certificatemanager (+ monitoring dla uptime check)
#   (2) sieć VPC (custom) + podsieć proxy-only REGIONAL_MANAGED_PROXY / ACTIVE
#   (3) statyczny regionalny IPv4 w tym samym tierze co reguły przekierowania
#   (4) serverless NEG → usługa myhelper
#   (5) regionalny backend service z logowaniem
#   (6) URL map → backend
#   (7) autoryzacja DNS + certyfikat Google-managed (europe-central2);
#       skrypt wypisuje rekord CNAME do Cloudflare (DNS only)
#   (8) regionalna ssl-policy MODERN, TLS ≥ 1.2
#   (9) target HTTPS proxy z tą polityką i certyfikatem
#   (10) forwarding rule 443
#   (11) URL map 80 → 301 https + target HTTP proxy + forwarding rule 80
#   (12) uptime check https://app.nordsignal.cc/api/health co 1 min + kanał
#        e-mail + alert (tworzony WYŁĄCZONY, włączany w kroku 3)
# Mapy certyfikatów nie ma: regionalny LB przyjmuje certyfikat Certificate
# Manager bezpośrednio na proxy (mapy obsługuje tylko LB globalny).
#
# --teardown: usuwa w odwrotnej kolejności (bez wyłączania API). Też dry-run
# domyślnie. Statyczny IP ZOSTAJE: zwolniony adres wraca do puli Google i może
# trafić do innego projektu, a rekord DNS wskazujący na niego oddałby mu ruch.
# Zwolnienie wyłącznie z --release-ip (tylko razem z --teardown), po
# sprawdzeniu, że rekord A domeny nie wskazuje adresu LB (dig @1.1.1.1 i
# @8.8.8.8; błąd albo brak dig = stop). dig nie widzi rekordu proxowanego przez
# Cloudflare — warunek panelu w runbooku jest obowiązkowy.
#
# Adres powiadomień: WYŁĄCZNIE z --notify-email=… albo zmiennej
# LB_NOTIFY_EMAIL (repo publiczne — adresu nie ma w repo). Nie jest wypisywany,
# nie trafia do lokalnego logu gcloud ani na stderr.
#
# Użycie:
#   infra/gcp/lb.sh --project ID [--region=europe-central2] [--notify-email=ADRES] [--teardown [--release-ip]] [--apply]
# Nazwy zasobów i domena są stałymi niżej (zmiana = nowa recenzja).
#
# Strażnik: __tests__/lib/lb-config.test.ts.
set -euo pipefail

APPLY=0 TEARDOWN=0 RELEASE_IP=0
PROJECT_ID="" REGION=""
NOTIFY_EMAIL="${LB_NOTIFY_EMAIL:-}"

# Jedyny dopuszczony region. Zmiana = nowa decyzja (koszt, lokalizacja danych).
ALLOWED_REGION="europe-central2"
DOMAIN="app.nordsignal.cc"
HEALTH_PATH="/api/health"
SERVICE="myhelper"
# Tier sieci: adres i OBIE reguły przekierowania muszą mieć ten sam.
NETWORK_TIER="PREMIUM"
PROXY_RANGE="10.129.0.0/23"

# Stałe nazwy zasobów.
NETWORK="myhelper-lb-vpc"
PROXY_SUBNET="myhelper-lb-proxy-only"
ADDRESS="myhelper-lb-ip"
NEG="myhelper-lb-neg"
BACKEND="myhelper-lb-backend"
URL_MAP="myhelper-lb-https"
DNS_AUTH="myhelper-lb-dnsauth"
CERT="myhelper-lb-cert"
SSL_POLICY="myhelper-lb-tls12"
HTTPS_PROXY="myhelper-lb-https-proxy"
HTTPS_FR="myhelper-lb-https-fr"
REDIRECT_MAP="myhelper-lb-http-redirect"
HTTP_PROXY="myhelper-lb-http-proxy"
HTTP_FR="myhelper-lb-http-fr"
UPTIME="myhelper-app-health"
CHANNEL="myhelper-lb-owner-email"
ALERT="myhelper-app-health-alert"

die() { echo "error: $*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --teardown) TEARDOWN=1 ;;
    --release-ip) RELEASE_IP=1 ;;
    --project=*) PROJECT_ID="${1#*=}" ;;
    --project) [[ $# -ge 2 ]] || die "--project needs a value"; PROJECT_ID="$2"; shift ;;
    --region=*) REGION="${1#*=}" ;;
    --region) [[ $# -ge 2 ]] || die "--region needs a value"; REGION="$2"; shift ;;
    --notify-email=*) NOTIFY_EMAIL="${1#*=}" ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

# --- walidacja przed pierwszym wywołaniem gcloud -----------------------------
[[ -n "$PROJECT_ID" ]] || die "missing required --project"
[[ "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "invalid --project"
REGION="${REGION:-$ALLOWED_REGION}"
[[ "$REGION" == "$ALLOWED_REGION" ]] || die "--region must be $ALLOWED_REGION"
[[ "$RELEASE_IP" == 0 || "$TEARDOWN" == 1 ]] || die "--release-ip requires --teardown"
if [[ -n "$NOTIFY_EMAIL" ]]; then
  [[ "$NOTIFY_EMAIL" =~ ^[^@[:space:],]+@[^@[:space:],]+\.[A-Za-z]{2,}$ ]] || die "invalid --notify-email"
fi
if [[ "$APPLY" == 1 && "$TEARDOWN" == 0 && -z "$NOTIFY_EMAIL" ]]; then
  die "--apply needs --notify-email=… or LB_NOTIFY_EMAIL (uptime check notification)"
fi

CERT_RESOURCE="projects/${PROJECT_ID}/locations/${REGION}/certificates/${CERT}"

GC=(gcloud --project="$PROJECT_ID" --quiet)

# Zmiana: wypisz; wykonaj tylko przy --apply.
run() {
  echo "+ gcloud --project=$PROJECT_ID --quiet $*"
  if [[ "$APPLY" == 1 ]]; then "${GC[@]}" "$@"; fi
}

# Odczyt stanu (kod wyjścia describe): przy --dry-run tylko wypisany, wynik
# „nie sprawdzono” = brak (tworzenie) albo obecność (teardown) — dry-run
# pokazuje wtedy pełną listę poleceń.
exists() {
  echo "? gcloud --project=$PROJECT_ID --quiet $*"
  if [[ "$APPLY" != 1 ]]; then
    echo "  state: not checked (dry-run)"
    [[ "$TEARDOWN" == 1 ]] && return 0
    return 1
  fi
  if "${GC[@]}" "$@" >/dev/null 2>&1; then
    echo "  state: exists"
    return 0
  fi
  echo "  state: missing"
  return 1
}

# Odczyt z treścią (list/describe --format) do zmiennej LOOKUP. Kod ≠ 0 to błąd
# odczytu (nie „brak”) — przebieg się przerywa, zamiast tworzyć duplikat.
# Dry-run: LOOKUP pusty przy tworzeniu, zastępczy przy teardown.
LOOKUP=""
lookup() {
  echo "? gcloud --project=$PROJECT_ID --quiet $*"
  LOOKUP=""
  if [[ "$APPLY" != 1 ]]; then
    echo "  state: not checked (dry-run)"
    [[ "$TEARDOWN" == 1 ]] && LOOKUP="<name-from-list>"
    return 0
  fi
  LOOKUP="$("${GC[@]}" "$@" 2>/dev/null)" || die "cannot read: $* — stopped"
  LOOKUP="$(printf '%s' "$LOOKUP" | head -n 1)"
  if [[ -n "$LOOKUP" ]]; then echo "  state: exists"; else echo "  state: missing"; fi
}

R=(--region="$REGION")
L=(--location="$REGION")

create_all() {
  # (1)
  run services enable compute.googleapis.com certificatemanager.googleapis.com monitoring.googleapis.com

  # (2) Sieć VPC jest zasobem globalnym z natury (bez flagi regionu); podsieć proxy-only regionalna.
  if ! exists compute networks describe "$NETWORK"; then
    run compute networks create "$NETWORK" --subnet-mode=custom
  fi
  if ! exists compute networks subnets describe "$PROXY_SUBNET" "${R[@]}"; then
    run compute networks subnets create "$PROXY_SUBNET" "${R[@]}" --network="$NETWORK" \
      --purpose=REGIONAL_MANAGED_PROXY --role=ACTIVE --range="$PROXY_RANGE"
  fi

  # (3)
  if ! exists compute addresses describe "$ADDRESS" "${R[@]}"; then
    run compute addresses create "$ADDRESS" "${R[@]}" --network-tier="$NETWORK_TIER"
  fi
  lookup compute addresses describe "$ADDRESS" "${R[@]}" "--format=value(address)"
  echo "  LB_IP=${LOOKUP:-<not checked (dry-run)>}"

  # (4)
  if ! exists compute network-endpoint-groups describe "$NEG" "${R[@]}"; then
    run compute network-endpoint-groups create "$NEG" "${R[@]}" \
      --network-endpoint-type=serverless --cloud-run-service="$SERVICE"
  fi

  # (5) Logowanie każdego żądania; istniejący backend dostaje te same flagi (bez dryfu).
  if exists compute backend-services describe "$BACKEND" "${R[@]}"; then
    run compute backend-services update "$BACKEND" "${R[@]}" --enable-logging --logging-sample-rate=1.0
  else
    run compute backend-services create "$BACKEND" "${R[@]}" \
      --load-balancing-scheme=EXTERNAL_MANAGED --protocol=HTTPS \
      --enable-logging --logging-sample-rate=1.0
  fi
  lookup compute backend-services describe "$BACKEND" "${R[@]}" "--format=value(backends[].group)"
  if [[ "$LOOKUP" == *"/networkEndpointGroups/${NEG}"* ]]; then
    echo "  skip: $NEG already attached to $BACKEND"
  else
    run compute backend-services add-backend "$BACKEND" "${R[@]}" \
      --network-endpoint-group="$NEG" --network-endpoint-group-region="$REGION"
  fi

  # (6)
  if ! exists compute url-maps describe "$URL_MAP" "${R[@]}"; then
    run compute url-maps create "$URL_MAP" "${R[@]}" --default-service="$BACKEND"
  fi

  # (7) Autoryzacja DNS (rekord CNAME per projekt) + certyfikat Google-managed.
  if ! exists certificate-manager dns-authorizations describe "$DNS_AUTH" "${L[@]}"; then
    run certificate-manager dns-authorizations create "$DNS_AUTH" "${L[@]}" \
      --domain="$DOMAIN" --type=PER_PROJECT_RECORD
  fi
  lookup certificate-manager dns-authorizations describe "$DNS_AUTH" "${L[@]}" \
    "--format=value(dnsResourceRecord.name,dnsResourceRecord.type,dnsResourceRecord.data)"
  echo "  dns: ${LOOKUP:-not checked (dry-run)} (Cloudflare: CNAME, DNS only)"
  if ! exists certificate-manager certificates describe "$CERT" "${L[@]}"; then
    run certificate-manager certificates create "$CERT" "${L[@]}" \
      --domains="$DOMAIN" --dns-authorizations="$DNS_AUTH"
  fi

  # (8) MODERN + TLS ≥ 1.2; istniejąca polityka dostaje te same flagi.
  if exists compute ssl-policies describe "$SSL_POLICY" "${R[@]}"; then
    run compute ssl-policies update "$SSL_POLICY" "${R[@]}" --profile=MODERN --min-tls-version=1.2
  else
    run compute ssl-policies create "$SSL_POLICY" "${R[@]}" --profile=MODERN --min-tls-version=1.2
  fi

  # (9)
  if ! exists compute target-https-proxies describe "$HTTPS_PROXY" "${R[@]}"; then
    run compute target-https-proxies create "$HTTPS_PROXY" "${R[@]}" \
      --url-map="$URL_MAP" --url-map-region="$REGION" \
      --certificate-manager-certificates="$CERT_RESOURCE" \
      --ssl-policy="$SSL_POLICY" --ssl-policy-region="$REGION"
  fi

  # (10)
  if ! exists compute forwarding-rules describe "$HTTPS_FR" "${R[@]}"; then
    run compute forwarding-rules create "$HTTPS_FR" "${R[@]}" \
      --load-balancing-scheme=EXTERNAL_MANAGED --network="$NETWORK" \
      --network-tier="$NETWORK_TIER" --address="$ADDRESS" \
      --target-https-proxy="$HTTPS_PROXY" --target-https-proxy-region="$REGION" --ports=443
  fi

  # (11) Port 80: wyłącznie 301 na https (import = utworzenie albo zastąpienie, bez dryfu).
  local map
  map="$(mktemp)"
  cat >"$map" <<YAML
name: ${REDIRECT_MAP}
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
YAML
  echo "  urlmap: $(tr '\n' ' ' <"$map" | tr -s ' ')"
  run compute url-maps import "$REDIRECT_MAP" "${R[@]}" --source="$map"
  rm -f "$map"
  if ! exists compute target-http-proxies describe "$HTTP_PROXY" "${R[@]}"; then
    run compute target-http-proxies create "$HTTP_PROXY" "${R[@]}" \
      --url-map="$REDIRECT_MAP" --url-map-region="$REGION"
  fi
  if ! exists compute forwarding-rules describe "$HTTP_FR" "${R[@]}"; then
    run compute forwarding-rules create "$HTTP_FR" "${R[@]}" \
      --load-balancing-scheme=EXTERNAL_MANAGED --network="$NETWORK" \
      --network-tier="$NETWORK_TIER" --address="$ADDRESS" \
      --target-http-proxy="$HTTP_PROXY" --target-http-proxy-region="$REGION" --ports=80
  fi

  # (12) Uptime check co 1 min.
  lookup monitoring uptime list-configs "--filter=displayName=\"${UPTIME}\"" "--format=value(name)"
  if [[ -z "$LOOKUP" ]]; then
    run monitoring uptime create "$UPTIME" --resource-type=uptime-url \
      --resource-labels="host=${DOMAIN},project_id=${PROJECT_ID}" \
      --protocol=https --port=443 --path="$HEALTH_PATH" --period=1 --validate-ssl=true
  fi
  # Kanał e-mail: adres tylko w argumencie gcloud, nigdy w wyjściu. Bez
  # lokalnego logu gcloud (zapisuje argumenty) i bez stderr (komunikat błędu
  # walidacji powtarza wartość etykiety); błąd niesie `die` niżej.
  lookup beta monitoring channels list "--filter=displayName=\"${CHANNEL}\"" "--format=value(name)"
  local channel="$LOOKUP"
  if [[ -z "$channel" ]]; then
    echo "+ gcloud --project=$PROJECT_ID --quiet beta monitoring channels create --display-name=$CHANNEL --type=email --channel-labels=email_address=<--notify-email> --format=value(name)"
    channel="<channel-name>"
    if [[ "$APPLY" == 1 ]]; then
      channel="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "${GC[@]}" beta monitoring channels create --display-name="$CHANNEL" --type=email \
        --channel-labels=email_address="$NOTIFY_EMAIL" "--format=value(name)" 2>/dev/null)" || die "cannot create channel $CHANNEL"
      channel="$(printf '%s' "$channel" | head -n 1)"
    fi
  fi
  # Alert WYŁĄCZONY do kroku 3 (usługa za LB jeszcze nie odpowiada na domenie).
  lookup alpha monitoring policies list "--filter=displayName=\"${ALERT}\"" "--format=value(name)"
  if [[ -z "$LOOKUP" ]]; then
    local policy
    policy="$(mktemp)"
    cat >"$policy" <<JSON
{
  "displayName": "${ALERT}",
  "enabled": false,
  "combiner": "OR",
  "conditions": [{
    "displayName": "${DOMAIN}${HEALTH_PATH} failing",
    "conditionThreshold": {
      "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND resource.label.host=\"${DOMAIN}\"",
      "aggregations": [{"alignmentPeriod": "60s", "perSeriesAligner": "ALIGN_NEXT_OLDER", "crossSeriesReducer": "REDUCE_COUNT_FALSE", "groupByFields": ["resource.label.*"]}],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 1,
      "duration": "60s",
      "trigger": {"count": 1}
    }
  }],
  "notificationChannels": ["${channel}"]
}
JSON
    echo "  policy: $(tr -d '\n' <"$policy" | tr -s ' ')"
    run alpha monitoring policies create --policy-from-file="$policy"
    rm -f "$policy"
  fi
}

# Zwolnienie statycznego IP (tylko --teardown --release-ip). Przy --apply:
# odczyt adresu, potem rekord A domeny z dwóch resolwerów publicznych. Linia
# równa adresowi LB, błąd dig albo brak dig = stop przed `delete`. Pusta
# odpowiedź = brak rekordu. Dry-run: bez wywołań gcloud i dig.
release_ip() {
  exists compute addresses describe "$ADDRESS" "${R[@]}" || return 0
  lookup compute addresses describe "$ADDRESS" "${R[@]}" "--format=value(address)"
  local ip="$LOOKUP" resolver answer line
  [[ -n "$ip" ]] || die "cannot read $ADDRESS address — IP not released"
  for resolver in 1.1.1.1 8.8.8.8; do
    echo "? dig +short A $DOMAIN @$resolver"
    if [[ "$APPLY" != 1 ]]; then
      echo "  state: not checked (dry-run)"
      continue
    fi
    command -v dig >/dev/null 2>&1 || die "dig not found — IP not released"
    answer="$(dig +short +time=5 +tries=2 A "$DOMAIN" "@$resolver" 2>/dev/null)" ||
      die "dig @$resolver failed — IP not released"
    while IFS= read -r line; do
      if [[ "$line" == "$ip" ]]; then
        die "$DOMAIN still points to the LB address — IP not released"
      fi
    done <<<"$answer"
    echo "  state: $DOMAIN does not point to the LB address (@$resolver)"
  done
  run compute addresses delete "$ADDRESS" "${R[@]}"
}

teardown_all() {
  lookup alpha monitoring policies list "--filter=displayName=\"${ALERT}\"" "--format=value(name)"
  [[ -n "$LOOKUP" ]] && run alpha monitoring policies delete "$LOOKUP"
  lookup beta monitoring channels list "--filter=displayName=\"${CHANNEL}\"" "--format=value(name)"
  [[ -n "$LOOKUP" ]] && run beta monitoring channels delete "$LOOKUP"
  lookup monitoring uptime list-configs "--filter=displayName=\"${UPTIME}\"" "--format=value(name)"
  [[ -n "$LOOKUP" ]] && run monitoring uptime delete "$LOOKUP"
  exists compute forwarding-rules describe "$HTTP_FR" "${R[@]}" && run compute forwarding-rules delete "$HTTP_FR" "${R[@]}"
  exists compute target-http-proxies describe "$HTTP_PROXY" "${R[@]}" && run compute target-http-proxies delete "$HTTP_PROXY" "${R[@]}"
  exists compute url-maps describe "$REDIRECT_MAP" "${R[@]}" && run compute url-maps delete "$REDIRECT_MAP" "${R[@]}"
  exists compute forwarding-rules describe "$HTTPS_FR" "${R[@]}" && run compute forwarding-rules delete "$HTTPS_FR" "${R[@]}"
  exists compute target-https-proxies describe "$HTTPS_PROXY" "${R[@]}" && run compute target-https-proxies delete "$HTTPS_PROXY" "${R[@]}"
  exists compute ssl-policies describe "$SSL_POLICY" "${R[@]}" && run compute ssl-policies delete "$SSL_POLICY" "${R[@]}"
  exists certificate-manager certificates describe "$CERT" "${L[@]}" && run certificate-manager certificates delete "$CERT" "${L[@]}"
  exists certificate-manager dns-authorizations describe "$DNS_AUTH" "${L[@]}" && run certificate-manager dns-authorizations delete "$DNS_AUTH" "${L[@]}"
  exists compute url-maps describe "$URL_MAP" "${R[@]}" && run compute url-maps delete "$URL_MAP" "${R[@]}"
  exists compute backend-services describe "$BACKEND" "${R[@]}" && run compute backend-services delete "$BACKEND" "${R[@]}"
  exists compute network-endpoint-groups describe "$NEG" "${R[@]}" && run compute network-endpoint-groups delete "$NEG" "${R[@]}"
  if [[ "$RELEASE_IP" == 1 ]]; then
    release_ip
  else
    echo "  skip: $ADDRESS kept (use --release-ip after DNS check)"
  fi
  exists compute networks subnets describe "$PROXY_SUBNET" "${R[@]}" && run compute networks subnets delete "$PROXY_SUBNET" "${R[@]}"
  exists compute networks describe "$NETWORK" && run compute networks delete "$NETWORK"
  return 0
}

MODE_LABEL="create"
[[ "$TEARDOWN" == 1 ]] && MODE_LABEL="teardown"
if [[ "$APPLY" == 1 ]]; then
  echo "mode: APPLY (project=$PROJECT_ID region=$REGION lb=$MODE_LABEL)"
else
  echo "mode: DRY-RUN — nothing is executed (project=$PROJECT_ID region=$REGION lb=$MODE_LABEL)"
fi
"${MODE_LABEL}_all"
echo "lb $MODE_LABEL: done"

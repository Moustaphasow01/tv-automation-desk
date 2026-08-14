#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"

docker_timeout_seconds="${DESK_STACK_DOCKER_TIMEOUT_SECONDS:-10}"
seed_applied=false

fail() {
  echo "test:stack: $*" >&2
  exit 1
}

run_docker() {
  timeout "$docker_timeout_seconds"s docker "$@"
}

require_docker_engine() {
  if ! command -v docker >/dev/null 2>&1; then
    fail "docker CLI introuvable. Installe Docker Desktop ou expose le CLI Docker dans cette session."
  fi

  local docker_info
  if ! docker_info="$(run_docker info --format '{{.ServerVersion}} {{.OSType}}' 2>&1)"; then
    echo "$docker_info" >&2
    fail "moteur Docker indisponible. Si tu es dans WSL, active Docker Desktop > Settings > Resources > WSL integration pour la distro courante, puis relance la stack."
  fi
}

require_running_service() {
  local service="$1"
  local services
  if ! services="$(run_docker compose ps --status running --services 2>&1)"; then
    echo "$services" >&2
    fail "impossible de lire les services docker compose. Lance d'abord: docker compose up -d postgres api frontend"
  fi

  if ! grep -qx "$service" <<<"$services"; then
    echo "$services" >&2
    fail "service '$service' non démarré. Lance: docker compose up -d postgres api frontend"
  fi
}

cleanup() {
  if [[ "$seed_applied" == "true" ]]; then
    run_docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U desk -d desk < e2e/fixtures/operations-real-stack-cleanup.sql >/dev/null || true
  fi
}

trap cleanup EXIT
require_docker_engine
require_running_service "postgres"
require_running_service "api"
require_running_service "frontend"
run_docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U desk -d desk < e2e/fixtures/operations-real-stack.sql >/dev/null
seed_applied=true
curl --fail --silent --show-error http://127.0.0.1:8080/api/v1/operations/summary >/dev/null
npx playwright test --config playwright.real.config.ts

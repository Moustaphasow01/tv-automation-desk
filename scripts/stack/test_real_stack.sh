#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"

cleanup() {
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U desk -d desk < e2e/fixtures/operations-real-stack-cleanup.sql >/dev/null
}

trap cleanup EXIT
docker compose ps --status running | grep -q "api"
docker compose ps --status running | grep -q "frontend"
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U desk -d desk < e2e/fixtures/operations-real-stack.sql >/dev/null
curl --fail --silent --show-error http://127.0.0.1:8080/api/v1/operations/summary >/dev/null
npx playwright test --config playwright.real.config.ts

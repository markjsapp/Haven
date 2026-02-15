#!/usr/bin/env bash
set -euo pipefail

# Haven deployment script
# Usage: ./deploy.sh [--build-local]
#   --build-local  Build the Docker image on the server (default)

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
HEALTH_URL="http://localhost:8080/health"
HEALTH_TIMEOUT=60

# ─── Pre-flight checks ─────────────────────────────────

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  echo "Copy .env.production.example to .env.production and fill in values."
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: docker not found. Install Docker first."
  exit 1
fi

echo "==> Building Haven..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build haven

echo "==> Recreating Haven container..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps --force-recreate haven

# ─── Health check ───────────────────────────────────────

echo "==> Waiting for Haven to become healthy..."
elapsed=0
while [ $elapsed -lt $HEALTH_TIMEOUT ]; do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "==> Haven is healthy!"
    # Clean up old images
    docker image prune -f >/dev/null 2>&1 || true
    echo "==> Deployment complete."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
    exit 0
  fi
  sleep 2
  elapsed=$((elapsed + 2))
  echo "    ...waiting ($elapsed/${HEALTH_TIMEOUT}s)"
done

echo "ERROR: Haven did not become healthy within ${HEALTH_TIMEOUT}s."
echo "==> Recent logs:"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=50 haven
exit 1

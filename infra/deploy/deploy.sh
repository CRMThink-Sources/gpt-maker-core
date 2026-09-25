#!/usr/bin/env sh
# Executado no Droplet pelo deploy.yml: ./deploy.sh <image-tag>
# Sobe a nova tag, espera o health check e volta para a tag anterior se falhar.
set -eu

NEW_TAG="${1:?uso: deploy.sh <image-tag>}"
cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
PREVIOUS_TAG="$(cat .current_tag 2>/dev/null || true)"

up() {
  IMAGE_TAG="$1" $COMPOSE pull backend-api backend-worker frontend
  IMAGE_TAG="$1" $COMPOSE up -d --remove-orphans
}

healthy() {
  # Readiness da API (Postgres, Redis, RabbitMQ) + worker e frontend vivos; até ~2 min.
  i=0
  while [ "$i" -lt 24 ]; do
    if IMAGE_TAG="$1" $COMPOSE exec -T backend-api wget -qO- http://127.0.0.1:3001/health/ready >/dev/null 2>&1 &&
      IMAGE_TAG="$1" $COMPOSE exec -T backend-worker wget -qO- http://127.0.0.1:9464/health/live >/dev/null 2>&1 &&
      IMAGE_TAG="$1" $COMPOSE exec -T frontend wget -qO- http://127.0.0.1:3000/app >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 5
  done
  return 1
}

echo "deploy: ${PREVIOUS_TAG:-nenhuma} -> $NEW_TAG"
up "$NEW_TAG"

if healthy "$NEW_TAG"; then
  echo "$NEW_TAG" > .current_tag
  docker image prune -f >/dev/null
  echo "deploy ok: $NEW_TAG"
  exit 0
fi

echo "health check falhou para $NEW_TAG" >&2
IMAGE_TAG="$NEW_TAG" $COMPOSE logs --tail 100 backend-api backend-worker >&2 || true

if [ -n "$PREVIOUS_TAG" ]; then
  echo "rollback para $PREVIOUS_TAG" >&2
  up "$PREVIOUS_TAG"
  healthy "$PREVIOUS_TAG" || echo "rollback também não ficou saudável" >&2
fi
exit 1

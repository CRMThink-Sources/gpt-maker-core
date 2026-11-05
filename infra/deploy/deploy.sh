#!/usr/bin/env sh
# Executado no Droplet pelo deploy.yml: ./deploy.sh <image-tag>
# Sobe a nova tag, espera o health check e volta para a tag anterior se falhar.
# Depois publica o ambiente no proxy único (infra/edge, em EDGE_DIR), que divide as portas 80/443
# entre os ambientes do Droplet.
set -eu

NEW_TAG="${1:?uso: deploy.sh <image-tag>}"
cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
EDGE_DIR="${EDGE_DIR:-/opt/edge}"

# Lê uma chave do .env sem executá-lo (valores podem ter caracteres especiais).
env_value() { sed -n "s/^$1=//p" .env | tail -n1; }
STACK_NAME="$(env_value STACK_NAME)"
APP_DOMAIN="$(env_value APP_DOMAIN)"
API_DOMAIN="$(env_value API_DOMAIN)"
: "${STACK_NAME:?STACK_NAME ausente no .env}" "${APP_DOMAIN:?}" "${API_DOMAIN:?}"
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

# Proxy único: sobe (ou atualiza) antes das stacks, pois ele cria a rede `edge` que elas usam.
# O lock evita que staging e produção mexam nele ao mesmo tempo.
edge_up() {
  mkdir -p "$EDGE_DIR/caddy/sites"
  cp edge/docker-compose.yml "$EDGE_DIR/docker-compose.yml"
  cp edge/caddy/Caddyfile "$EDGE_DIR/caddy/Caddyfile"
  docker compose -f "$EDGE_DIR/docker-compose.yml" --env-file "$PWD/.env" up -d
}

# Publica os domínios deste ambiente e recarrega o Caddy sem derrubar o outro ambiente.
edge_publish() {
  site="$EDGE_DIR/caddy/sites/$STACK_NAME.caddy"
  [ ! -f "$site" ] || cp "$site" "$site.bak"
  sed -e "s|__STACK__|$STACK_NAME|g" -e "s|__APP_DOMAIN__|$APP_DOMAIN|g" -e "s|__API_DOMAIN__|$API_DOMAIN|g"     edge/site.caddy.tmpl > "$site"
  EDGE="docker compose -f $EDGE_DIR/docker-compose.yml --env-file $PWD/.env"
  if $EDGE exec -T caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    $EDGE exec -T caddy caddy reload --config /etc/caddy/Caddyfile
    rm -f "$site.bak"
  else
    echo "Caddyfile inválido para $STACK_NAME; mantendo a configuração anterior" >&2
    if [ -f "$site.bak" ]; then mv "$site.bak" "$site"; else rm -f "$site"; fi
    return 1
  fi
}

[ -d "$EDGE_DIR" ] || { echo "$EDGE_DIR não existe: como root, rode 'install -d -o deploy -g deploy $EDGE_DIR'" >&2; exit 1; }
(
  flock 9
  edge_up
) 9>"$EDGE_DIR/.lock"

echo "deploy: ${PREVIOUS_TAG:-nenhuma} -> $NEW_TAG ($STACK_NAME)"
up "$NEW_TAG"

if healthy "$NEW_TAG"; then
  echo "$NEW_TAG" > .current_tag
  ( flock 9; edge_publish ) 9>"$EDGE_DIR/.lock" || exit 1
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

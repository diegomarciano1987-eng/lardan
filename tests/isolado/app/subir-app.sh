#!/usr/bin/env bash
# Segunda instância da aplicação, ligada EXCLUSIVAMENTE ao banco isolado.
#   bash tests/isolado/subir.sh            # banco isolado (55432)
#   bash tests/isolado/app/subir-app.sh    # API 54330, gateway 54321, app 8090
#   bash tests/isolado/app/subir-app.sh parar
# Não toca a pré-visualização (8080) nem o banco compartilhado.
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/../../.." && pwd)
BASE=/tmp/lardan-app-iso
mkdir -p "$BASE/env"

parar() { for f in "$BASE"/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done; }
if [ "${1:-}" = "parar" ]; then parar; exit 0; fi
parar

PGRST=${POSTGREST_BIN:-$(nix build nixpkgs#postgrest --no-link --print-out-paths 2>/dev/null)/bin/postgrest}
ANON=$(bun "$RAIZ/tests/isolado/app/chaves.ts" anon)
SERVICO=$(bun "$RAIZ/tests/isolado/app/chaves.ts" service_role)

cat >"$BASE/postgrest.conf" <<EOF
db-uri = "postgres://authenticator@127.0.0.1:55432/lardan_iso?sslmode=disable"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "lardan-isolado-segredo-local-nao-e-credencial-0001"
server-host = "127.0.0.1"
server-port = 54330
EOF
nohup "$PGRST" "$BASE/postgrest.conf" >"$BASE/postgrest.log" 2>&1 & echo $! >"$BASE/postgrest.pid"
nohup bun "$RAIZ/tests/isolado/app/gateway.ts" >"$BASE/gateway.log" 2>&1 & echo $! >"$BASE/gateway.pid"

cat >"$BASE/env/.env" <<EOF
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON
VITE_SUPABASE_PROJECT_ID=isolado
EOF

cd "$RAIZ"
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=$ANON \
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=$ANON \
LARDAN_DEMO_ISOLADO=1 LARDAN_SIM_DIR="$BASE/sim" SUPABASE_SERVICE_ROLE_KEY=$SERVICO LARDAN_ISO_ENVDIR="$BASE/env" \
  nohup bunx vite dev --config tests/isolado/app/vite.isolado.config.ts --port 8090 >"$BASE/vite.log" 2>&1 & echo $! >"$BASE/vite.pid"

for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:8090/ && break; sleep 1; done
curl -sf -o /dev/null http://127.0.0.1:8090/ && echo "app isolada em http://127.0.0.1:8090" || { tail -30 "$BASE/vite.log"; exit 1; }

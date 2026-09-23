#!/usr/bin/env bash
# Sobe um Postgres LOCAL e vazio, aplica o prelúdio e todas as migrações do
# projeto, na ordem. Nenhum dado da base compartilhada é copiado.
#
#   bash tests/isolado/subir.sh
#
# Conexão resultante: postgresql://postgres@127.0.0.1:55432/lardan_iso
set -euo pipefail

BASE=${LARDAN_ISO_DIR:-/tmp/lardan-iso}
PORTA=${LARDAN_ISO_PORT:-55432}
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)

# o sandbox roda como root; o Postgres recusa. Quando houver usuário comum,
# usa-o; caso contrário roda direto.
if [ "$(id -u)" = "0" ] && getent passwd 1000 >/dev/null; then
  AS="setpriv --reuid=1000 --regid=1000 --clear-groups"
else
  AS=""
fi
SEM_PG="env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE -u PGSSLMODE"

$AS $SEM_PG pg_ctl -D "$BASE/pgdata" stop -m immediate >/dev/null 2>&1 || true
rm -rf "$BASE"
mkdir -p "$BASE/pgdata"
[ -n "$AS" ] && chown -R 1000:1000 "$BASE"

export HOME=$BASE
$AS $SEM_PG initdb -D "$BASE/pgdata" -U postgres --auth=trust >"$BASE/initdb.log" 2>&1
$AS $SEM_PG pg_ctl -D "$BASE/pgdata" \
  -o "-k $BASE -p $PORTA -c listen_addresses=127.0.0.1 -c max_connections=100" \
  -l "$BASE/pg.log" -w start >/dev/null

URL="postgresql://postgres@127.0.0.1:$PORTA/postgres?sslmode=disable"
psql "$URL" -qc "create database lardan_iso;" >/dev/null
ISO="postgresql://postgres@127.0.0.1:$PORTA/lardan_iso?sslmode=disable"

psql "$ISO" -v ON_ERROR_STOP=1 -q -f "$RAIZ/tests/isolado/00-prelude.sql"

total=0
puladas=0
for f in "$RAIZ"/supabase/migrations/*.sql; do
  nome=$(basename "$f")
  if grep -qxF "$nome" "$RAIZ/tests/isolado/pular.txt"; then
    puladas=$((puladas + 1))
    continue
  fi
  if ! psql "$ISO" -v ON_ERROR_STOP=1 -q -f "$f" >"$BASE/ultima.log" 2>&1; then
    # Migração que só mexe em CONTEÚDO (sem estrutura, permissão ou rotina) e
    # aponta para linhas reais do catálogo: ignorada e registrada. Qualquer
    # falha em migração com estrutura interrompe a preparação.
    if ! grep -Eiq '(create|alter|drop|grant|revoke) ' "$f"; then
      echo "$nome" >>"$BASE/puladas.txt"
      puladas=$((puladas + 1))
      continue
    fi
    echo "FALHOU: $nome"
    tail -20 "$BASE/ultima.log"
    exit 1
  fi
  total=$((total + 1))
done

# Mudanças preparadas e ainda NÃO aplicadas ao banco compartilhado.
pendentes=0
PACOTE_PENDENTE="$BASE/pendentes-atomicos.sql"
printf '%s\n' 'BEGIN;' >"$PACOTE_PENDENTE"
for f in "$RAIZ"/db/pendentes/*.sql; do
  case "$f" in *proposta*) echo "ignorado (proposta, não aplicar): $(basename "$f")"; continue;; esac
  [ -e "$f" ] || continue
  # LARDAN_PENDENTES_ATE=08 reproduz a base no estado do pacote anterior
  if [ -n "${LARDAN_PENDENTES_ATE:-}" ] && [[ "$(basename "$f")" > "${LARDAN_PENDENTES_ATE}~" ]]; then
    echo "adiado (atualização posterior): $(basename "$f")"; continue
  fi
  printf '\n-- arquivo: %s\n' "$(basename "$f")" >>"$PACOTE_PENDENTE"
  cat "$f" >>"$PACOTE_PENDENTE"
  pendentes=$((pendentes + 1))
done
printf '%s\n' 'COMMIT;' >>"$PACOTE_PENDENTE"
if ! psql "$ISO" -v ON_ERROR_STOP=1 -q -f "$PACOTE_PENDENTE" >"$BASE/ultima.log" 2>&1; then
  echo "FALHOU: pacote pendente atômico foi integralmente revertido"
  tail -30 "$BASE/ultima.log"
  exit 1
fi

echo "migrações aplicadas: $total (ignoradas por serem só conteúdo: $puladas)"
echo "arquivos pendentes aplicados: $pendentes"
[ -f "$BASE/puladas.txt" ] && cat "$BASE/puladas.txt"
echo "$ISO"

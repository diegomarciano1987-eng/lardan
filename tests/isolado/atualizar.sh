#!/usr/bin/env bash
# Atualiza uma base no estado do pacote anterior (05+07+08) aplicando os
# pendentes posteriores numa única transação. Falha no meio: nada fica.
#   LARDAN_PENDENTES_ATE=08 bash tests/isolado/subir.sh
#   bash tests/isolado/atualizar.sh 09
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
ISO=${LARDAN_ISO_URL:-postgresql://postgres@127.0.0.1:55432/lardan_iso?sslmode=disable}
DESDE=${1:-09}
for f in "$RAIZ"/db/pendentes/*.sql; do
  n=$(basename "$f")
  case "$n" in *proposta*) continue;; esac
  [[ "$n" < "$DESDE" ]] && continue
  echo "aplicando (transação única): $n"
  psql "$ISO" -v ON_ERROR_STOP=1 -q --single-transaction -f "$f"
done

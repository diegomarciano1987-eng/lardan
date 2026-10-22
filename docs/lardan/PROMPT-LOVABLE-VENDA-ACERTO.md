VENDA PELO ACERTO DA CONSULTORA (IGUAL AO SMALLDATA) — APLICAR O PACOTE

Anexei "lardan-venda-acerto.patch" (um commit sobre o pacote da Focus) e o projeto completo "lardan-venda-acerto.zip".
Se o pacote da Focus (0118) ainda não foi aplicado, aplique-o antes deste. Este vem depois dele.

POR QUE
O BI somava a venda pelo mês de SAÍDA da maleta e pelo valor das peças. O relatório de vendas do SmallData soma o VALOR COBRADO NO ACERTO de cada consultora, pela DATA DO ACERTO.
Com esta mudança, a carga real bate ao centavo: agosto/2026 R$ 271.290,19 e fevereiro/2026 R$ 303.105,16.

REGRAS
- Aplique a migração 0119 como está. Não refatore nem renomeie. Se algo não encaixar, me mostre o conflito antes de decidir.
- Gere o journal e o snapshot da 0119 com a ferramenta oficial. Regenere os tipos do Supabase. As rotinas legado_bi_* e legado_rede_mensal ganharam o parâmetro _data, e as versões antigas foram removidas.
- O código novo já vem pronto. NÃO reescreva. Se o typecheck acusar erro, corrija só a tipagem, sem mudar comportamento nem textos, e me mostre o que mudou.
- Não publique sem minha aprovação.

O QUE O PATCH TRAZ
1. drizzle/migrations/0119_venda_pelo_acerto.sql
   - legado_acertos_consultora: valor e data do acerto por remessa e consultora. Tipo novo "acertos_consultora" no legado_importar, sem mudar os outros tipos.
   - legado_maletas.valor_vendido_cents passa a ser o valor do acerto, repartido entre os kits. Sem acerto, continua peças enviadas − devolvidas.
   - legado_maletas.acerto_divergente: marca as maletas em que o acerto e as peças não batem no próprio SmallData.
   - legado_rede_mensal e legado_bi_* com _data = 'acerto' (padrão) ou 'saida'.
2. src/lib/historico-jflex-csv.ts: 11º arquivo, acertos_consultora.csv.
3. src/lib/historico-bi.ts e src/lib/historico-jflex.ts: parâmetro data.
4. src/components/admin/historico/BiHistorico.tsx: seletor "Contar a venda pelo mês do acerto / mês de saída".
5. src/components/admin/historico/HistoricoJFlex.tsx: com o histórico já importado, a tela aceita enviar só os arquivos escolhidos. A primeira carga continua exigindo todos.
6. tests/isolado/bi-historico.test.ts com 3 testes novos. docs/lardan/BI-HISTORICO.md atualizado.

DEPOIS DE APLICAR
1. Rode build e typecheck e me mostre o resultado.
2. Rode bash tests/isolado/subir.sh && bun test tests/isolado. Esperado: 329 aprovados, 0 falhas.
3. Me avise. EU importo, só o arquivo acertos_consultora.csv, pela tela de importação (Master).
4. Depois da importação, na base real, só leitura:
   select to_char(fechamento,'YYYY-MM') mes, sum(valor_vendido_cents)/100.0 from legado_maletas
    where tipo='remessa' and to_char(fechamento,'YYYY-MM') in ('2026-02','2026-08') group by 1;
   Esperado: 2026-02 = 303105.16 e 2026-08 = 271290.19.
5. Me mande o print de Rede > Histórico SmallData com "mês do acerto" e o ano 2026.

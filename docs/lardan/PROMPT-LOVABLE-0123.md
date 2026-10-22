ACERTOS DE REMESSA AINDA ABERTA (0123) — APLICAR O PACOTE

Anexei "lardan-0123.patch" (um commit sobre o zip que você me entregou agora) e o projeto completo "lardan-0123.zip".
Suíte isolada: 335 de 335, em banco recriado do zero.

POR QUE
- Fevereiro e agosto bateram, mas outras telas não: ficha da consultora, ranking livre, resumo e sugestão de montagem só contavam maleta acertada de remessa já ENCERRADA.
- No SmallData a consultora é acertada uma a uma e a remessa só fecha quando a última maleta volta. Por isso os acertos dos meses recentes ficavam de fora.
- Com a 0123, os 36 meses (nov/2023 a out/2026) batem ao centavo com o relatório de vendas do SmallData. A série mensal passa a somar também os cadastros internos (loja/LARDAN), como o SmallData faz.

REGRAS
- Aplique a 0123 como está. Ela não cria nem apaga coluna. Ela troca o filtro "remessa encerrada" por "maleta com acerto" em legado_consultora_dados, montagem_sugestao, legado_resumo e montagem_metas_ciclo.
- legado_rede_ranking ganha o parâmetro _data ('acerto', padrão, ou 'saida'). A versão antiga, de 6 parâmetros, é removida, para a chamada não ficar ambígua.
- Gere o journal e o snapshot da 0123 com a ferramenta oficial. Regenere os tipos do Supabase.
- src/lib/historico-jflex.ts: rankingRede aceita data, com padrão "acerto". Não precisa mudar tela.
- Não publique sem minha aprovação.

DEPOIS DE APLICAR
1. Rode build e typecheck e me mostre o resultado.
2. Rode bash tests/isolado/subir.sh && bun test tests/isolado. Esperado: 335 aprovados, 0 falhas.
3. Na base real, só leitura. Compare mês a mês as maletas acertadas com os acertos (mesma conta da série mensal):
   with bi as (select to_char(fechamento,'YYYY-MM') mes, sum(valor_venda_cents) v from legado_maletas
                where tipo='remessa' and fechamento is not null group by 1),
        sd as (select to_char(data,'YYYY-MM') mes, sum(valor_cents) v from legado_acertos_consultora where tipo='remessa' group by 1)
   select count(*) meses, count(*) filter (where bi.v = sd.v) iguais from sd join bi using (mes);
   Esperado: meses = iguais (36 e 36).

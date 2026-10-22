BI DO HISTÓRICO SMALLDATA + CORREÇÕES DO HISTÓRICO — APLICAR O PACOTE

Anexei "lardan-bi-historico.patch" (um commit sobre o zip que você me entregou hoje) e o projeto completo "lardan-bi-historico.zip".
Banco e telas já estão prontos. Suíte isolada: 316 de 316, em banco recriado do zero (agora em UTF-8). As rotinas do BI rodaram na carga real (27 mil maletas) em menos de 1 segundo cada.

REGRAS
- Aplique as migrações 0116 e 0117 como estão. Não refatore nem renomeie. Se algo não encaixar, me mostre o conflito antes de decidir.
- Gere o journal e o snapshot da 0116 e da 0117 com a ferramenta oficial. Regenere os tipos do Supabase.
- As telas novas já vêm prontas no patch. NÃO reescreva. Se o typecheck acusar erro, corrija só a tipagem, sem mudar comportamento, textos ou layout, e me mostre o que mudou.
- Tudo é só leitura, menos o botão "Aplicar ajuste" dos cadastros (só Master, com prévia e auditoria).
- Não publique sem minha aprovação.

O QUE O PATCH TRAZ
1. drizzle/migrations/0116_historico_correcoes.sql
   - Corrige o valor vendido de 282 maletas que vieram com valor devolvido zerado (R$ 1,6 mi a mais, 14% do total). Usa as categorias da própria maleta, corrige o que já está no banco e as próximas importações.
   - legado_cadastros_revisao() e legado_cadastros_ajustar(_aplicar), só Master: praça e situação dos cadastros criados pelo histórico, mexendo só em quem não tem nenhuma operação no Lardan.
   - legado_consultoras_cadastrar passa a criar com praça, a criar inativa quem estava inativa no SmallData (ou sem maleta há 12+ meses) e a pular nome igual a cadastro existente.
2. drizzle/migrations/0117_bi_historico.sql
   - legado_bi_painel, legado_bi_top, legado_bi_jornada, legado_bi_alertas, legado_bi_praca_categoria, legado_bi_produtos, legado_bi_insights e legado_bi_opcoes. Todas exigem legado_pode_ver.
   - Coluna gerada legado_consultoras.interna: cadastros "LARDAN", "MALETA" e "DESIGN" ficam fora do BI.
3. src/lib/historico-bi.ts: chamadas tipadas.
4. src/components/admin/historico/BiHistorico.tsx: a tela do BI, montada em Rede > Histórico SmallData, acima do ranking que já existia ("Ranking livre").
5. src/components/admin/historico/HistoricoJFlex.tsx: novo painel "Cadastros criados a partir do histórico", só Master.
6. tests/isolado/bi-historico.test.ts (12 testes). tests/isolado/subir.sh agora cria o banco em UTF-8 (antes era SQL_ASCII e acento não se comportava como no Supabase).
7. docs/lardan/BI-HISTORICO.md, docs/lardan/NOTA-FISCAL-O-QUE-FALTA.md e uma regra nova no AGENTS.md.

A TELA (Rede > Histórico SmallData)
- Filtros: todo o histórico, últimos 12 meses, cada ano, outro período, praça e representante.
- Frases prontas com o que salta aos olhos.
- KPIs com comparação ao período anterior e aviso de "valores parciais" quando há maleta sem acerto.
- Valor e giro por mês; quanto cada maleta vende (faixas de %).
- Top 10 consultoras geral ou por praça, por valor, peças, giro ou venda por maleta, com ritmo das 3 últimas maletas.
- Concentração da venda (Pareto).
- Jornada da 1ª à 12ª maleta; consultoras que entram e que param por trimestre.
- Mix envio × venda; tamanho da maleta, dias na rua e sazonalidade.
- Mapa praça × categoria.
- Quem precisa de atenção: zeraram 2 seguidas, em queda, boas que sumiram, estreantes fortes.
- Peças que mais vendem; ano a ano.

DEPOIS DE APLICAR
1. Rode build e typecheck e me mostre o resultado.
2. Rode bash tests/isolado/subir.sh && bun test tests/isolado. Esperado: 316 aprovados, 0 falhas.
3. Na base real, só leitura:
   - Antes e depois da 0116: select count(*), sum(valor_vendido_cents) from legado_maletas where pecas_devolvidas > 0 and valor_devolvido_cents = 0;
   - Esperado: antes, cerca de 282 maletas; depois, perto de zero.
4. Abra Rede > Histórico SmallData com sessão de Master e me mande prints da tela inteira, com "Todo o histórico" e com "Últimos 12 meses".
5. Abra Configurações > Histórico e me mande o print do painel "Cadastros criados a partir do histórico". NÃO clique em "Aplicar ajuste": eu decido depois de ver a prévia.
6. Com sessão de consultora e de representante, as rotinas legado_bi_* devem responder "Sem permissão". Me mostre.

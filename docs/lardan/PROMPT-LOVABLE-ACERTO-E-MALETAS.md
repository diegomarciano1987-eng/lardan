VENDA PELO ACERTO (0119, SEM APAGAR COLUNA) + MALETAS NO COCKPIT DA CONSULTORA (0120) — APLICAR

Anexei "lardan-acerto-e-maletas.zip" (projeto completo) e dois patches, na ordem:
  1. "lardan-venda-acerto-v2.patch": substitui a 0119 que eu tinha mandado antes. Se você ainda guarda a versão antiga, descarte-a.
  2. "lardan-maletas-cockpit.patch": maletas da consultora no cockpit.
Os dois vêm depois do pacote da Focus (0118). Suíte isolada: 334 de 334, em banco recriado do zero.

REGRAS
- Aplique 0119 e 0120 como estão. Não refatore nem renomeie. Se algo não encaixar, me mostre o conflito antes de decidir.
- A 0119 NÃO apaga nenhuma coluna. Ela acrescenta em legado_maletas:
  - valor_acerto_cents;
  - acerto_divergente;
  - valor_venda_cents (gerada).
  A antiga valor_vendido_cents continua lá, com comentário "DESATIVADA", e todas as rotinas passam a ler valor_venda_cents.
  A única coisa removida são as versões antigas das rotinas legado_bi_* e legado_rede_mensal, porque elas ganharam o parâmetro _data. Duas versões ao mesmo tempo deixariam a chamada ambígua.
- Gere o journal e o snapshot da 0119 e da 0120 com a ferramenta oficial. Regenere os tipos do Supabase.
- O código novo já vem pronto. NÃO reescreva. Se o typecheck acusar erro, corrija só a tipagem, sem mudar comportamento nem textos, e me mostre o que mudou.
- Tudo é só leitura: nada muda maleta, estoque ou cadastro.
- Não publique sem minha aprovação.

O QUE MUDA NA TELA
1. Rede > Histórico SmallData:
   - venda pelo valor cobrado no acerto, igual ao SmallData;
   - seletor "mês do acerto / mês de saída".
2. Configurações > Histórico: com o histórico já importado, dá para enviar só um arquivo (acertos_consultora.csv).
3. Cockpit da consultora (Cobrança > ficha): nova aba "Maletas", com três blocos:
   - maletas do Lardan e se aparecem ou não no app dela, com o motivo;
   - maletas que estão na rua só pelo SmallData (sem acerto);
   - outro cadastro que parece ser a mesma pessoa.
4. Cadastro da pessoa: a aba "Estoque e maletas" deixa de ser "Em implantação" e mostra o mesmo conteúdo.
5. Remessas: aviso recolhível com quantas maletas estão na rua só pelo SmallData e quantas maletas do Lardan a consultora não vê no app.

DEPOIS DE APLICAR
1. Rode build e typecheck e me mostre o resultado.
2. Rode bash tests/isolado/subir.sh && bun test tests/isolado. Esperado: 334 aprovados, 0 falhas.
3. Na base real, só leitura:
   select count(*) from information_schema.columns where table_name='legado_maletas' and column_name in ('valor_vendido_cents','valor_venda_cents','valor_acerto_cents');
   Esperado: 3.
4. Me avise. EU importo, só o acertos_consultora.csv, pela tela.
5. Me mande prints:
   - do aviso em Remessas, aberto;
   - da aba "Maletas" de uma consultora que tem maleta na rua.

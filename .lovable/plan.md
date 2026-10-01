# Asaas em 30/09, eventos, contratos, avisos de segurança e prova de Open Finance

Tudo em etapas, somente leitura onde envolver dinheiro. Nenhuma baixa, nenhum reprocessamento, nada publicado sem o seu pedido.

## Etapa 1 — Consulta somente de leitura ao Asaas (precisa da sua autorização)
- A autorização é dada no cartão de aprovação que aparece na primeira consulta; só leituras (saldo, extrato, cobranças). Nenhuma escrita no Asaas.
- Reconstruir em 30/09: saldo do Asaas, extrato do dia e cobranças recebidas/confirmadas com ID, valor bruto, tarifa, valor líquido, data de pagamento e data de crédito.
- Comparar com os R$ 9.718,00 da conta ASAAS BOLETOS, linha a linha, e explicar a diferença de R$ 3.388,77 por ID (o que existe só no Asaas, só na Lardan, ou com valor diferente).
- Entregar uma **prévia de correspondência** (Asaas ↔ título/parcela da Lardan) com a proteção contra duplicidade: cada cobrança só pode ser ligada uma vez (ID externo único por conta) e a baixa usa chave idempotente. A prévia não grava nada.

## Etapa 2 — Os 250 eventos da fila
- Tabela por tipo de evento: quantidade, consequência no financeiro (muda situação, só informativo, exige ação humana) e o que acontece hoje.
- Os 59 eventos sem tratamento atual ficam guardados como estão, marcados "sem tratamento — preservado", nunca apagados.
- Os 18 pagamentos recebidos/confirmados entram na prévia da Etapa 1.

## Etapa 3 — Tabela de decisão para o Daniel (contratos)
- Colunas: contrato, parcelas e valor, período de prestação do serviço (quando conhecido; "não informado" quando não), competência atual, proposta e motivo.
- Contratos de 2025 e todos os demais ficam **sem alteração**; a tabela é só para decisão. Entregue como documento para download.

## Etapa 4 — Os 3 avisos de segurança das funções novas (antes de publicar)
- Funções: lista de parcelas, mudança de competência da parcela e lista de transferências.
- Para cada uma: explicar o aviso, retirar a execução de visitantes e do público, manter só usuários logados com a permissão financeira conferida dentro da função, e devolver apenas os dados financeiros necessários.
- Testes no banco com: usuário financeiro (vê), consultora e estoque (recusados), visitante (recusado). Resultado mostrado na resposta.

## Etapa 5 — Prova de conceito Open Finance (somente leitura)
- Comparar **Pluggy** e **Belvo** com as contas reais: Santander, Itaú e Sicoob PJ — cobertura de conta PJ, saldo, extrato, histórico, preço, contrato, prazo de consentimento e LGPD. Pesquisa nas documentações públicas; a escolha fica com vocês.
- Depois da escolha: chave do fornecedor guardada em segredo, consentimento feito por vocês no banco, leitura de saldo e extrato gravada como linhas de extrato da conta (mesma tabela do OFX).
- OFX continua funcionando. Deduplicação API × OFX pelo identificador da transação do banco e, na falta dele, por conta + data + valor + histórico, com revisão humana em caso de dúvida.
- Nenhuma baixa automática; tudo passa pela conciliação já existente.

## O que depende de vocês
1. Aprovar a leitura do Asaas no cartão (Etapa 1).
2. Escolher Pluggy ou Belvo depois da comparação, criar a conta no fornecedor e fazer o consentimento de cada banco.
3. Decisões do Daniel na tabela de contratos.

## Detalhes técnicos
- Asaas: leitura pelo conector/servidor existente (`/finance/balance`, `/financialTransactions`, `/payments` com filtros de data), sem endpoints de escrita.
- Prévia: consulta a `asaas_charges`, `asaas_events`, `financial_installments` e `financial_statement_lines`; nada gravado.
- Avisos: `REVOKE EXECUTE ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated`, checagem de capacidade dentro da função `SECURITY DEFINER` com `search_path` fixo.
- Open Finance: `createServerFn` lendo o segredo do fornecedor no servidor; linhas com `bank_id` = ID da transação e hash para deduplicação.

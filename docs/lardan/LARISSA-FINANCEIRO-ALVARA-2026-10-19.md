# Larissa: financeiro completo e alvarás — 19/10/2026

## Entrega
- Larissa Reginalda mantém os papéis Financeiro e Cobrança, com concessão individual das 28 capacidades `finance.*` existentes. Sem Master e sem ampliar acesso das demais pessoas. MFA preservado.
- Aba Judicial: cada alvará possui “Registrar liberação do alvará”, conta de destino, data real e identificação do comprovante. Confirmação cria baixa oficial contra a dívida original e entrada na conta, sem novo título.
- Parcelas Asaas continuam no mecanismo oficial de acordos e lote; alvará nunca gera cobrança.
- Desconto final aguarda o total efetivamente recebido entre Asaas e alvará. Estorno de recebimento retira desconto que deixou de ser devido; novo recebimento do alvará recompõe o desconto sem duplicar.
- Telas financeiras em cache são invalidadas após a confirmação do alvará.

## Provas
1. Consulta real: concessão `enabled=true`; papéis `{financeiro,cobranca}`; 28 permissões financeiras.
2. Navegador, sessão real de Larissa: Configurações financeiras com ações habilitadas e Auditoria com registros reais. Nenhuma configuração alterada.
3. Ficha real da Ana Paula: formulário do alvará de R$315,65 aberto com conta/data/identificação. Nenhum recebimento real confirmado.
4. Testes isolados: 8 aprovados, cobrindo exclusividade de acesso, bloqueios, divisão Asaas/alvará, baixa de R$500, idempotência, estorno antes/depois da quitação e desconto de R$100.
5. Regressões: 17 testes de baixa automática/tarifas e 5 testes de acordos/lote aprovados.
6. Navegador isolado: alvará fictício de R$500 confirmado, ficha recarregada, “Recebido em 19/10/2026 · ISO Alvará” relido. Dados fictícios somente na base local descartável.
7. Sinal automático do projeto: build OK.

Capturas locais: `/tmp/browser/larissa/configuracoes.png`, `auditoria.png`, `alvara-dialog.png`, `iso-selection.png`.

## Caminho
Financeiro → Pagar e receber para lançar/consultar contas. Cobrança → ficha → Judicial → Acordos judiciais lançados → Registrar liberação do alvará → conta/data/identificação → Confirmar recebimento. Só confirmar quando o dinheiro efetivamente entrar.
Asaas: no acordo marcar apenas parcelas cobradas → salvar → Gerar cobranças no Asaas ou Cobrança em lote → Acordos.

## Limites e cuidados
- Não há novo disparo Asaas real nem comprovação de entrega de avisos neste trabalho.
- Estornar uma baixa Asaas não transforma um callback repetido em recebimento novo. Um recebimento posterior real exige tratamento financeiro explícito; não existe automatismo de rebaixa da mesma cobrança estornada.
- As datas negociadas ficam no plano do acordo; as parcelas originais do Financeiro não são reescritas automaticamente. Portanto, não afirmar que a projeção financeira já usa os novos vencimentos do acordo.
- Cenários concorrentes de estorno e recebimento não receberam prova de carga nesta entrega.
- A concessão e regras aditivas já estão no backend compartilhado; o botão novo chega ao site oficial somente com publicação autorizada. Nada publicado.

## Texto para WhatsApp
Larissa, seu acesso ao Financeiro foi ampliado para todas as operações do módulo, mantendo seu acesso à Cobrança.

Depois da atualização do sistema, para registrar um alvará: Cobrança → ficha da cliente → Judicial → Acordos judiciais lançados → Registrar liberação do alvará. Escolha a conta que recebeu, informe a data da entrada e a identificação do comprovante e confirme. Faça isso somente quando o dinheiro realmente cair. O registro abate a dívida e lança a entrada no Financeiro, sem precisar lançar novamente.

Nas parcelas cobradas, mantenha “Cobrar no Asaas” marcado; desmarque a parcela do alvará. Depois de salvar, gere pelo botão azul ou por Cobrança em lote → Acordos. Os recebimentos confirmados pelo Asaas abatem as dívidas vinculadas; o alvará fica separado, sem boleto.
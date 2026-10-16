# Aplicação do patch de segurança e cobrança — 16/10/2026

## Resultado e provas

- Correções aplicadas em 0086, preservando 0084 (filtros Remessas) e 0085 (cancelamento das sete maletas), conforme autorização.
- `pdv_links_listar` registrada em 0087 com a definição lida da base, sem mudar comportamento ou permissões.
- Banco local novo: 325 migrações e 3 arquivos pendentes aplicados pela bancada existente.
- `bun test tests/isolado`: **235 aprovados, 0 falhas, 1.241 assertions**, 17 arquivos, 12,97 s: os 230 do pacote mais 5 de cancelamento.
- Compilação automática: **build OK**, última entrada observada em 23:06:02 UTC. Build/typecheck não executados manualmente; não há relatório separado de typecheck disponível.
- Playwright com sessão de Diego: Administração e Remessas renderizadas sem erros capturados; Nova remessa visível e lista vazia/totais zerados preservados.
- Rotina pública Asaas sem autorização: **HTTP 401**.
- Na base real, anon sem execução de `kit_consultora_info`/`pracas_resumo`; authenticated sem execução de `asaas_cartao_creditar`.
- **Não publicado.** Nenhuma cobrança real criada, sincronização externa disparada, dado histórico corrigido ou conta de cartão preenchida (2 contas Asaas, 0 configuradas).
- Fluxos de representante/cobrança testados na bancada isolada, não com cobrança real pela interface; crédito posterior pelo fluxo agendado não verificado ponta a ponta.

## Consultas somente leitura na base real

- Reativações: **1 evento / 1 pessoa** em `consultora.reativada_representante`; **0 com status anterior registrado**. Não é possível afirmar quantas eram bloqueadas/desligadas antes. Zero casos comprovados não significa zero ocorrências.
- **7 parcelas** liquidadas com saldo positivo pela fórmula antiga e desconto/abatimento, somando **R$ 1.113,81**. Todas têm saldo zero incluindo os ajustes. Nenhum lançamento histórico alterado; a função de cálculo foi corrigida pelo patch autorizado.

## Diferenças de aplicação

1. Journal/snapshots gerados pela ferramenta oficial, não copiados ou editados manualmente; posição 0086 autorizada.
2. Quatro regras do pacote adicionadas preservando a regra recente de cancelamento.
3. Ao transcrever 0086, retorno `forma` enviado acidentalmente como `o.pay_method`; 0087 alinhou a `_forma` do patch sem editar migração antiga. Retorno final conferido na base.
4. Assertion não nula nova de `espelho.server.ts` substituída por estreitamento equivalente, exigência da plataforma.
5. Metadados completados nas três páginas modificadas, exigência da plataforma; desenho e fluxo preservados.
6. Teste preexistente de cancelamento fechava a conexão compartilhada antes do novo arquivo: removido só esse encerramento antecipado, fora do patch. Os testes enviados não foram reescritos. Suíte completa final 235/235.

## Limitações do próprio pacote, sem alteração adicional

- Teste de cartão chama a rotina diretamente; o caminho de pendências exclui parcelas já quitadas/baixas existentes. Transferência posterior pelo agendamento não está provada e pode ser omitida nesse caminho. Não configurar conta de cartão antes de conferir.
- `least(credit_date, hoje)` pode antecipar crédito futuro; pacote sem teste novo de estorno dessa transferência.
- Recusas de CPF gravam auditoria e lançam exceção, revertendo o registro. Confirmado na bancada: recusas funcionam, mas nenhum evento `consultora.cobranca_cpf_recusado` permanece.
- Ficha enviada do representante ainda usa `valor − alocações`, não `fin_installment_saldo`; corrigir a função não garante que essa ficha deixe de mostrar casos com desconto.
- Escopo oficial `kit_cycle_in_scope` inclui participantes históricos de transferência; teste enviado não cobre acesso desses participantes ao contato.
- Marcador interno de transferência segue o padrão enviado; não houve teste adversarial de todas as formas de defini-lo.

Esses pontos foram registrados, não corrigidos: alterações adicionais dependem de autorização, pois o pedido foi aplicar o pacote sem refatorar.
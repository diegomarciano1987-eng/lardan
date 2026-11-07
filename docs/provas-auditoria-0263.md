# Pacote 0263 — auditoria e provas LARDAN

Leitura real autenticada como Diego: 2026-11-07T00:03:10.928588+00:00.

## Aplicação e limites
- Aplicadas as guardas de criação e troca da consultora, reaproveitamento de cadastro inativo e liberação oficial de reservas ao excluir maleta.
- Nenhuma reserva histórica liberada, cadastro unificado, dívida alterada, nota emitida ou publicação realizada nesta execução.
- Exemplos do pacote foram ajustados para retirar nomes e mensagens livres potencialmente pessoais.
- Ajustes adicionais: identificação de vitrine pela pessoa; itens fiscais adaptados ao esquema real. N2 lê os envios oficiais Focus por ambiente.
- Auditoria não equivale a diagnóstico definitivo: M7 inclui remessas finalizadas legitimamente com maletas em operação; P1 inclui cadastros oficialmente unificados; múltiplas maletas podem ser válidas; F6 não prova baixa faltante.

## Testes
- 8 testes novos aprovados, 34 asserções: permissões, 39 itens sem erro, bloqueada/suspensa/desligada, fluxo permitido, CPF inativo, exclusão e prévia/aplicação de reservas apenas na bancada.
- Bancada recriada do zero: 695 testes aprovados, 2 falhas anteriores no emissor TSM, 3.330 asserções no total. As duas falhas alegam duas pessoas com o CNPJ da TSM na preparação isolada.
- Uma repetição sem recriar a bancada apresentou interferências; o resultado acima é o da execução limpa.
- Compilação da prévia: build OK. Não houve alteração de telas nem emissão/postagem/teste de entrega física.

## Resultado completo — 39 itens
| Código | Quantidade | Verificação | Exemplos (até cinco) |
|---|---:|---|---|
| E1 | 3613 | Saldo negativo de estoque | deposito DEP-01 · 15068 · -138; deposito DEP-01 · 14659 · -96; deposito DEP-01 · 15066 · -74; deposito DEP-01 · 14654 · -63; deposito DEP-01 · 14655 · -52 |
| E2 | 1 | Reservado maior que o saldo | DEP-01 · 18235 · saldo -15 reservado 1 |
| E3 | 0 | Reserva ativa em maleta que saiu, foi cancelada ou encerrada | sem dados |
| E4 | 0 | Reserva ativa vencida | sem dados |
| E5 | 0 | Saldo negativo dentro da maleta | sem dados |
| M1 | 0 | Maleta com consultora sem cadastro ligado | sem dados |
| M2 | 0 | Consultora com mais de uma maleta aberta | sem dados |
| M3 | 14 | Maleta conferida ou enviada sem peças | MAL-00325 · conferida; MAL-00327 · conferida; MAL-00328 · conferida; MAL-00329 · conferida; MAL-00330 · conferida |
| M4 | 0 | Maleta em trânsito há mais de 15 dias | sem dados |
| M5 | 0 | Entregue há mais de 7 dias sem aceite | sem dados |
| M6 | 0 | Maleta em operação com acerto vencido | sem dados |
| M7 | 170 | Remessa fechada com maleta aberta (finalização não implica encerramento) | Remessa 927 · MAL-00358 · transito; Remessa 927 · MAL-00340 · transito; Remessa 927 · MAL-00395 · transito; Remessa 927 · MAL-00359 · transito; Remessa 927 · MAL-00407 · transito |
| M8 | 20 | Maletas transferidas do SmallData | SmallData 924 kit 1 · conferida · transito; SmallData 924 kit 2 · conferida · transito; SmallData 924 kit 3 · conferida · transito; SmallData 924 kit 4 · conferida · transito; SmallData 924 kit 5 · conferida · transito |
| P1 | 5 | Documento repetido em cadastros | LC-000941 = LC-001470; LC-003310 = 26; LC-003392 = 7687; LC-003737 = 6512; LC-003419 = LC-007417 |
| P2 | 0 | Representantes com nome repetido | sem dados |
| P3 | 6 | Representante ativo sem documento | LC-001607; LC-001622; LC-001546; LC-001624; LC-001575 |
| P4 | 1 | Representante legado ligado a cadastro com outro primeiro nome | 3009 → 867 |
| P5 | 176 | Consultora ativa sem conta | 9158; 9164; 9165; LC-001470; 9044 |
| P6 | 0 | Conta consultora sem cadastro ligado | sem dados |
| P7 | 8 | Consultora ativa sem praça ou representante | 26 · sem praça; LC-001470 · sem praça · sem representante; LC-007661 · sem praça · sem representante; LC-007658 · sem praça · sem representante; LC-007667 · sem praça · sem representante |
| P8 | 0 | Representante da maleta diferente do cadastro | sem dados |
| F1 | 0 | Pedido pago sem título ligado | sem dados |
| F2 | 0 | Falha ao cancelar cobrança de pedido | sem dados |
| F3 | 0 | Compra da vitrine não paga com reserva vencida | sem dados |
| F4 | 1811 | Parcelas a receber vencidas há mais de 30 dias | 2026-023046 · 05/01/24 · 34128; 2026-023239 · 05/01/24 · 71647; 2026-023110 · 05/01/24 · 87845; 2026-023240 · 11/01/24 · 47250; 2026-023329 · 11/01/24 · 58772 |
| F5 | 0 | Pedido concluído sem forma de pagamento | sem dados |
| F6 | 69 | Aviso Asaas com erro não processado | PAYMENT_CHECKOUT_VIEWED · pay_eam9hwjp6bskrzj4; PAYMENT_CHECKOUT_VIEWED · pay_44bzuy6ne15fzeuy; PAYMENT_CHECKOUT_VIEWED · pay_1bf7ai5r1jth1qwc; PAYMENT_CHECKOUT_VIEWED · pay_ejl78idxgz85cwos; PAYMENT_CHECKOUT_VIEWED · pay_zyntvzjb71o8u29s |
| F7 | 0 | Nenhum aviso Asaas nas últimas 48 horas | sem dados |
| F8 | 0 | Sincronização Asaas sem rodar há mais de 36 horas | sem dados |
| M9 | 0 | Maleta aberta de cadastro bloqueado, desligado ou suspenso | sem dados |
| V1 | 0 | Vitrine pública de cadastro não ativo | sem dados |
| N1 | 0 | Nota parada ou rejeitada há mais de um dia | sem dados |
| N2 | 134 | Notas em produção (inventário; não altera ambiente) | remessa · autorizado · lardan-mal-remessa-mw59uwfx-s52o7w3g; remessa · autorizado · lardan-mal-remessa-mw57fh4p-ixog8z08; remessa · autorizado · lardan-mal-remessa-mw5apv45-528pb94c; remessa · autorizado · lardan-mal-remessa-mw58uzc0-e7uwkb4z; remessa · autorizado · lardan-mal-remessa-mw3z38ew-tukczxch |
| C1 | 0 | Envio Correios com erro | sem dados |
| C2 | 0 | Entrega cinco dias além do previsto | sem dados |
| C3 | 0 | Etiqueta sem postagem no prazo | sem dados |
| A1 | 0 | Convite com falha no envio | sem dados |
| A2 | 3 | Convites pendentes vencidos | LC-007667; LC-001546; 9014 |
| A3 | 2 | Contas Master | 934884cf; 10789c54 |

## Prévia de reservas presas
- Aplicado: false; reservas: 0; unidades: 0; exemplos: sem dados.

## Configurações verificadas
| Rotina | Frequência | Ativa | Última execução / limite de prova |
|---|---|---|---|
| Vitrine — expiração | A cada 10 minutos | Sim | Horário individual do cron não disponível; F3 = 0 nesta leitura |
| Central de Leads | A cada minuto | Sim | Último envio de registro: 06/11/2026 19:32:05 UTC (16:32:05 SP); fila pendente = 0. Não é prova do último disparo do cron |
| Rede — localizar | A cada minuto | Sim | Horário individual do cron não disponível |
| Fiscal — processar | A cada minuto | Sim | Horário individual do cron não disponível |
| Asaas — sincronização | 09:00 UTC diariamente (06:00 SP) | Sim | Último início registrado: 06/11/2026 09:00:02 UTC. Metadados do agendamento legado não expõem o destino; nome e registro de execução conferidos |

- Todos os 12 buckets existentes são privados: assinaturas, avatars, avisos, biblioteca-lardan, candidaturas, consultora-pos-venda, correios, extratos-bancarios, imports, media, termos-maleta, vitrine-originais. Isso confirma a configuração, não uma nova auditoria de todas as políticas de acesso.
- Confirmação de e-mail, proteção de senha vazada e limite de e-mails/hora: NÃO VERIFICADOS; não existe leitura desses três valores nas ferramentas disponíveis. Nenhuma configuração foi escrita para tentar descobri-los.
- Fiscal real: provider Focus, environment producao, emission_active true, producao_todas true, producao_automatico false. O pedido do pacote dizia homologação; a configuração já estava em produção. Foi preservada, sem ativar, desativar ou emitir.
- N2 = 134 registros de envio em produção: quantidade de registros, não necessariamente 134 notas autorizadas.

## Pontos para decisão posterior
- E1: 3.613 linhas de saldo negativo; conferir implantação/histórico antes de qualquer ajuste.
- E2: uma linha com reserva acima do saldo (peça 18235).
- M3: 14 maletas sem quantidade alocada positiva; requer conferência individual.
- F6: 69 avisos Asaas com erro pendente; exemplos são visualizações de checkout e não comprovam pagamento sem baixa.
- P1/P3/P5/P7: conferir cadastros, unificações, documentos, acessos e carteira sem alterações automáticas.
- P4 mantém o vínculo legado já conhecido; não foi reescrito.
- Publicação e qualquer correção dos dados exigem autorização separada.

# Pacote 0407 — entrega e provas

Aplicado somente na prévia. Não publicado. Sem migração, sem lançamento financeiro, sem exclusão e sem alteração na ativação da Lara.

## Alterações
- Dados → Sua opinião → Teste DISC → Maleta → Assinatura.
- O link DISC é preparado automaticamente ao entrar na etapa, uma vez por candidata; o botão manual continua disponível para tentar novamente se houver falha.
- Depois de salvar a conclusão do teste, tenta consultar crédito e decidir imediatamente. Reserva por 3 minutos; espera no máximo 20 segundos. A rotina retoma pendências após a reserva vencer.
- Ajuste de segurança em relação ao arquivo recebido: reserva condicional somente de linha pendente, sem tentativa anterior e já disponível. Não toma uma linha que a rotina já reservou. O temporizador é limpo ao terminar.
- Recusa nunca automática; maleta continua dependente da aprovação oficial.

## Provas
- 20/20 testes Vitest: 6 de processamento imediato + 14 de rascunhos/assinaturas.
- 12/12 testes de cálculo de candidatura (Bun).
- 29/29 testes de banco isolado: 0395, 0398 e teste 0284.
- Total: 61 testes aprovados. A primeira execução usou Vitest indevidamente no arquivo legado bun:test; reexecutado com Bun, sem modificar esse arquivo.
- Banco local descartável: 644 migrações + 4 arquivos pendentes; nenhuma escrita de cenário na operação real.
- Navegador autenticado como representante sintético: link gerado e lido de volta pela tela sem tocar em preparar, botão copiar disponível, nenhuma opção de escolher maleta antes de aprovar, teste real aberto com autorização e botão Começar. Sem erros de tela.
- Imagens reais do aplicativo em ambiente isolado com dados sintéticos, não montagens e não consultas reais da Assertiva.
- Compilação da prévia: OK.

### Limitações
Não concluí um teste real de candidata nem fiz consulta real paga à Assertiva. A conclusão imediata, falhas e limite de tempo foram exercitados com dependências simuladas em testes; as regras oficiais de decisão e aprovação foram exercitadas no banco isolado. Não foi validado o percurso completo até aprovação na tela com consulta externa real. O limite de 20 segundos encerra a espera, não cancela a consulta em andamento; a fila fica como recuperação se a execução terminar.

## Todos os agendamentos existentes (conferência de 27/11/2026)
Todos os 13 constam ativos. Horários cron em UTC; horário brasileiro abaixo em UTC−3. Para chamadas HTTP gerenciadas, a autenticação usa a credencial gerenciada de cron pelo helper oficial, como Fiscal. Não criei nem alterei agendamentos, pois Captação e Lara já existem.

Base das URLs abaixo: https://www.lardan.com.br (mesmo caminho na produção estável). Horários de rotinas até duas vezes por hora podem ser distribuídos em cerca de 30 segundos após o minuto programado.

| ID | Nome | Destino | Frequência |
|---|---|---|---|
| 1 | cob-regua-diaria | SQL: public.cob_regua_executar(), conforme migração 0035; sem URL HTTP | diariamente 09h UTC / 06h Brasília |
| 2 | asaas-sync-matinal | Destino não exposto pela listagem segura; /api/public/asaas/sync-matinal é o caminho oficial documentado, mas a vinculação deste job não foi confirmada | diariamente 09h UTC / 06h Brasília |
| 3 | rede-localizar-consultoras | https://www.lardan.com.br/api/public/rede/localizar | cada minuto |
| 4 | central-leads-enviar | https://www.lardan.com.br/api/public/central-leads/enviar | cada minuto |
| 5 | vitrine-expirar | https://www.lardan.com.br/api/public/vitrine/expirar | cada 10 minutos |
| 6 | fiscal-processar | https://www.lardan.com.br/api/public/fiscal/processar | cada minuto |
| 7 | zapsign-conferir-pendentes | https://www.lardan.com.br/api/public/zapsign/conferir | cada 10 minutos |
| 8 | asaas-automatico | SQL: public.asaas_auto_rodar(150), conforme migração 0285; sem URL HTTP | cada 10 minutos |
| 9 | asaas-extrato-hora | https://www.lardan.com.br/api/public/asaas/extrato-hora | minuto 7 de cada hora |
| 10 | asaas-saldo-espelho | https://www.lardan.com.br/api/public/asaas/saldo-sync | cada minuto |
| 11 | captacao-processar | https://www.lardan.com.br/api/public/captacao/processar | cada minuto; POST gerenciado, corpo {"origem":"agendamento"} |
| 12 | correios-rastrear | https://www.lardan.com.br/api/public/correios/rastrear | 11h e 18h UTC / 08h e 15h Brasília |
| 13 | lara-processar | https://www.lardan.com.br/api/public/lara/processar | cada minuto; POST gerenciado, corpo {"origem":"agendamento"} |

Os handlers de Captação, Lara e Fiscal usam authenticateCronRequest antes do processamento. A existência do agendamento não demonstra o sucesso de cada execução; não executei mensagens, não ativei a Lara e não publiquei o 0407.

## Texto para Daniel
Daniel, o pacote 0407 deixa o atendimento do representante mais claro: a opinião dele fica separada do DISC, que é respondido pela candidata. O link fica pronto sozinho ao chegar nessa etapa. Ao finalizar o teste, o sistema tenta analisar o cadastro imediatamente, mantendo a rotina automática como recuperação se houver demora ou falha. A aprovação continua seguindo as regras da Lardan, qualquer situação que exige avaliação segue para você e nenhuma recusa acontece automaticamente. As melhorias estão testadas na prévia e aguardam autorização do Diego para publicação.

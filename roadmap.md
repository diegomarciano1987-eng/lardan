# Roadmap

## Pacote 0293/0294 — ajustes do Asaas pedidos pelo Diego (12/11/2026)
- [x] 1/8. Pix com maleta aberta entra em 3.1.1 ligado à consultora (adiantamento); 21 exceções (R$ 5.075,76, 20 consultoras) já passaram pela regra nova. Joyce (R$ 166,75, valor que não casa) segue na exceção.
- [x] 2. Acerto abate os Pix que a consultora já pagou pelo app; o resto vira o título do acerto (e a conferência abate o que entrar depois).
- [x] 3. Negativação em 4.1.5: títulos de agosto e setembro reclassificados (R$ 326,70) e os novos já nascem em 4.1.5.
- [x] 4. Tarifa de boleto em 4.1.2: 90 tarifas (R$ 179,10) reclassificadas; novas já nascem em 4.1.2.
- [x] 5. Pix/TED e demais tarifas seguem 5.1.3; notificações seguem 5.1.1.
- [x] 6. Texto do extrato corrigido ("de hora em hora"; a rotina já roda de hora em hora). Publicar — aguardando o Diego clicar em Publicar.
- [x] 7a. Mesma fatura + mesmo valor de baixa importada liga sozinho (2 tarifas de cartão duplicadas desfeitas e religadas).
- [x] 7b. Mesa: aba "Transferência interna".
- [x] 7c. Mesa: "Baixas já realizadas" acha a baixa da própria cobrança e busca fora dos 60 dias (Eliane 871021163 aparece).
- [x] 9. TED judicial: 7.1.7 + Administrativo (automático, palpite da Mesa e os 3 TEDs do Asaas já lançados).
- [ ] Aguardando Diego: mudar também para Administrativo os 7.1.7 antigos do banco/planilha (25 do Santander, 145 da planilha, 9 manuais)?
- [ ] Aguardando Diego: as 3 transferências de R$ 300 marcadas "Ignorar" podem ser religadas pela aba nova (opcional).
- [x] Testes: 12 novos + 2 antigos atualizados; bancada completa 825/825 (antes do 0294) e baterias do Asaas/acerto 39/39 depois.

## Pacote 0275 — resistência para o pico (08/11/2026)
- [x] Nota fiscal (produção ligada): falha de rede/tempo/5xx com a Focus confere pela mesma referência antes de liberar outra nota; fila confere sozinha as notas sem resposta; fila fiscal reservada por 5 min.
- [x] Correios: um pedido de token só no pico (sem estourar o limite de 3/s); 401 renova o token e tenta uma vez.
- [x] Asaas: avisos "abriu a página/boleto" não entram mais na fila de revisão (os 69 pendentes saem).
- [x] Fotos do celular compactadas (≤1600 px) antes de subir: troca/garantia, divergência da conferência, pós-venda (antes recusava foto > 5 MB).
- [x] App: consultas com 10 s de frescor e sem repetir erro de permissão 3 vezes (menos carga quando alterna WhatsApp ↔ app).
- [x] 18 índices nos caminhos quentes (carteira do representante, maletas a receber, baixa Asaas, pedidos).
- [x] Testes: 9 novos; bancada completa 728/728 (teste da DANFE agora limpa o CNPJ da TSM que deixava para trás).
- [x] Banco: estrutura como migração 0276; limpeza dos avisos do Asaas como pacote de dados (db/aplicados/0276).
- [ ] Publicar — aguardando aprovação do Diego.

## Pacote 0269 — convite do representante e movimento ativa consultora (08/11/2026)
- [x] Convite do representante para consultora inativa da carteira dele não trava mais (ativa no próprio convite).
- [x] Qualquer movimento em nome de inativa ativa na hora (bloqueada/desligada nunca); busca de maleta mostra inativas.
- [x] Ajuste único: 617 consultoras com movimento em aberto ativadas (131 → 748 ativas), auditado.
- [x] Testes: 8 isolados novos; bancada completa 713/713. Prova real da Gracielle (simulação desfeita) ok.
- [ ] Aguardando Diego: ativar também as 1.406 marcadas "ativa" no SmallData sem movimento em aberto?
- [ ] Publicar (só o servidor do convite precisa; o banco já está valendo).

## Pacote 0266 — teste interno do Daniel (08/11/2026)
- [x] 1. Contrato assinado aparece como assinado para o representante (verificar na hora + conferência automática a cada 10 min). Contrato do Guilherme corrigido pela própria ZapSign.
- [x] 2. Busca da maleta de abertura encontra a candidata recém-cadastrada (nome por partes, CPF, protocolo).
- [x] 3. Etiqueta da maleta sem o número solto (11, 10, 9…).
- [x] 4. Romaneio com "Abertura 0N" ao lado da remessa.
- [x] 5. Nova candidata / Fazer abertura em tela cheia de verdade no celular.
- [x] 6. Tela da remessa: "ABERTURA 0N" e "MALETA 0N" (hoje sempre 01: o banco aceita uma maleta por consultora na remessa).
- [x] Testes: 8 isolados novos + 9 unitários; bancada completa 705/705. Provas: docs/provas-0266.md.
- [ ] Aviso automático da ZapSign não chegou no contrato do Guilherme; cadastro do aviso no painel da ZapSign não verificável daqui (a conferência a cada 10 min cobre).

## Pacote 0263 — auditoria e integridade (06/11/2026)
- [x] Guardas e liberação oficial aplicadas (0263–0265); 8 novos testes passaram; bancada limpa: 695 passaram, 2 falhas TSM anteriores ao pacote.
- [x] Auditoria real autenticada: 39 itens sem erro; prévia de reservas = 0, nenhuma correção de dados executada. Relatório: docs/provas-auditoria-0263.md.
- [x] Agendamentos ativos, 12 buckets privados, Focus já em produção conferidos sem mudar configurações; Asaas último início 06/11 09:00 UTC, Central último envio 19:32 UTC.
- [ ] Horários individuais dos cron e confirmação de e-mail/HIBP/limite horário não verificáveis pelas ferramentas de leitura disponíveis.
- [ ] Publicação e eventuais correções de dados aguardam autorização explícita de Diego; não executadas neste pacote.

## Pacote 0259-2 — prévia por CPF das remessas SmallData (06/11/2026)
- [x] Substituir somente a prévia (0260), preservando os vínculos 3009/3010; 9 testes isolados passaram, 43 asserções.
- [x] Repetir prévia real de 924/925 como Diego: ambas bloqueadas por CPF ausente no cadastro Cloud de Marcelo/Guilherme; 10 maletas/350 peças em cada, nenhuma peça sem cadastro, zero transferidas. Não aplicar nem publicar.
- [x] Aplicar com autorização explícita de Diego em 06/11 às 21:49 UTC: identidade confirmada pelos dois representantes ativos; registrar exceção pontual sem alterar CPF nem vínculos 3009/3010. Aceitar falta, sem expedir nem publicar.

## 0254 — maletas das remessas 924/925 do SmallData para o Cloud (06/11/2026)
- [x] Extração JFLEX de 06/11: remessa 924 (rep. 3009, praça 14) e 925 (rep. 3010, praça 42), 10 maletas de abertura cada (cliente interno LARDAN), 35 peças por maleta, todas conferidas na saída. 924 → remessa 926 do Cloud; 925 → remessa 925.
- [x] Prévia, aplicar (motor oficial: abertura com o representante → itens → conferir; expedir só se pedido) e desfazer; 9 testes isolados.
- [x] Aplicar as duas remessas autorizadas e conferir persistência, 20 maletas/700 peças e idempotência.

## 0251 — abertura na rua, contrato Danilo, trocas pelos Correios (06/11/2026)
- [x] Fluxo único da nova candidata (dados → perfil → maleta → assinaturas), sem aprovação interna; prova com desfazer automático e telas.
- [x] Contrato: {{email}}, {{rg}}, {{estado_civil}}, {{data_nascimento}} do cadastro; 2 testes.
- [x] Trocas: código reverso e envio da peça nova pelos Correios; prévia conferida em troca real. Nenhuma postagem real gerada.
- [x] Publicar após aprovação de Diego.

## Pacote 0228 — documentos assinados (05/11/2026)
- [x] Aba e armazenamento privado aplicados; carteira preservada, segredos e produção mantidos.
- [x] 16 testes isolados + 5 transporte passaram; 209 documentos conferidos, 87 vinculados/63 cópias; PDF real HTTP 200 aberto. Provas: docs/provas-documentos-assinados-0228.md.
- [ ] Publicação solicitada após validação; confirmação depende do serviço de publicação. 122 documentos sem correspondência aguardam conferência humana em Integrações.

## Pacote 0213 — compra por peça e forma combinada (05/11/2026)
- [x] Arquivos aplicados e venda_forma confirmada no banco compartilhado; nenhuma venda existente alterada. Botões novos usam Button e ações da foto se acomodam no celular.
- [x] 18 testes isolados e 9 de WhatsApp aprovados; compra por peça/foto conferida na vitrine Larissa (1280×1800 e 390×844), cartão selecionável, sem transbordamento; Central aberta como Diego, sem erros de execução. Provas: docs/provas-0213.md. Não gerada cobrança real.
- [ ] Publicação aguarda aprovação de Diego; classificação de leitura já vale no banco compartilhado, botões dependem de publicar.

## Pacote 0199 — auditoria do app da consultora (03/11/2026)
- [x] Pacote 0199–0201 revisado aplicado em 03/11 (gravado como 0200/0201/0202): segurança, acerto×cobrança, cockpit. Prévia de reprocessamento: 0 ajustes. Não publicado.
- [x] Revisar pacote contra 0198 e executar na bancada isolada: 582 testes passaram, sem usar a base real.
- [x] (resolvido no pacote 0199–0201) Aplicação bloqueada: maleta_total_sugerido não limita histórico à carteira da colaboradora; ajustes alteram valores já conferidos, não têm recuperação idempotente de falhas e não atualizam dívida oficial existente. Aguardar autorização para corrigir o pacote em vez de aplicar byte-exato.
- [x] Alterações provisórias removidas da aplicação; banco compartilhado intacto, sem publicação. Os 582 testes não comprovam segurança dos cenários ausentes.
- [ ] Configurações hospedadas de confirmação de e-mail, senhas vazadas e limite de envio não verificadas; leitura desses valores não disponível nas ferramentas consultadas.

## Pacote fiscal 0165 — emissor TSM (29/10/2026)
- [x] Cadastro fiscal aplicado via ferramenta de dados (não DDL); duplicidade unificada após autorização, LC-003419 → LC-007417, auditoria 554e2c5c-245b-4531-a99e-3b0e185400b7. SQL adaptado somente para ignorar IDs oficialmente unificados; endereço antigo e vínculos preservados.
- [x] Emissor definido, CNPJ/IE/endereço/IBGE = true; Focus/homologacao/false conferidos no banco, RPC autenticada e tela /admin/integracoes. 514 testes isolados passaram; 3 cenários fiscais novos; testes de preço antigos alinhados à regra para baixo já aprovada. Build OK. Não ativa nem comprova emissão completa: prontidão ainda informa pendências da cadeia/acerto e cadastros.

## App da consultora — velocidade e topo compacto (28/10/2026)
- [x] Navegação com resposta imediata, cache compartilhado 60s, pré-carregamento seletivo, busca 250ms; aceite inicial preservado e erro de atualização não apaga resultado anterior.
- [x] Liga compacta e colapsável no topo do Início; barra monetária e comissão do consultora_ganhos, sem inventar faixas ou ganhos garantidos.
- [x] 23 testes unitários + 19 isolados; 24 cliques medidos 66–136ms, 15 toques seguidos e erro de atualização 503; 375×667, 412×915 e desktop. Diego Silva não tem maleta operacional: barra verificada em cópia isolada (R$150/R$500, comissão R$30), não em venda real. Sem teste de carga de mil usuárias; falta publicar.

## Plano solicitado — aceite e personalização do romaneio (28/10/2026)
- [x] Entregar provas por pedido e texto comercial completo para Daniel, com limitações explícitas (Files: provas-aceite-romaneio).
- [x] Aviso de venda mínima no topo de todas as abas da consultora e no cabeçalho do PDF; texto/valor editáveis pelo Daniel em Textos e Pix, sem inventar valor inicial. 850 reais apenas na base isolada.
- [x] Diamante LARDAN transparente alinhado à logo; PDF real 3 folhas inspecionadas, centros coincidentes.
- [x] Referência 70/70 no PDF real, telefone por identidade com troca de login, editor sem perder edição, aceite por clique no celular/desktop e persistência. 510 testes isolados + 7 impressoras; assinatura externa/impresso físico não testados. Trava global de navegação é do app, não um bloqueio universal novo de todas as RPCs.
- [x] Preparar plano com aceite bloqueante e assinatura preservada, teste do clique e persistência em ambiente isolado.
- [x] Incluir correção da referência exata da etiqueta, diagnóstico do salvamento do Daniel e telefone por colaboradora.
- [x] Incluir provas PDF real × cadastro para representante, consultora, remessa, peças e demais campos personalizados.

## Impressão de Remessas e Pix — 28/10/2026
- [x] Expor configurações de impressoras A4/etiquetas por estação em Remessas, com confirmação de destino e limites honestos do navegador.
- [x] Textos personalizados em Configurações e Remessas → Configurar impressora → Textos e Pix; permissão Master preservada.
- [x] Pix global oficial Asaas vinculado via ação autenticada; QR sem valor fixo no pedido/romaneio, sem baixa automática.
- [x] Preferências persistidas e impressão real da Iris pelo botão Romaneio; 70 itens em 3 folhas, QR das folhas 1 e 3 decodificados. Testes isolados e unitários OK. Impressoras físicas dependem de teste da estação; telas dependem de publicar.

## Conciliação Asaas/bancos — correções (relatório Diego 25/10/2026)
- [ ] 1. Baixa parcial Maria Celina (R$ 299,22, fatura 935298558, título 2026-024776 parc. 2 R$ 656,22). DIAGNÓSTICO: não foi automático — estorno manual do Daniel Maciel em 21/10 02:31 ("feita por engano; vincular ao título correto"). Alocação original estava correta (357,00 + 299,22 = 656,22). Baixa SmallData de R$ 357,00 (13/10) não existe em nenhuma tabela importada — falta importar pagamentos.csv. PENDENTE: confirmar com Diego antes de refazer a alocação (conflita com estorno deliberado do Daniel)
- [ ] 2. Sincronização Asaas: cron de COBRANÇAS rodou todos os dias 21–25/10 (09:00, concluída). O que parou foi o EXTRATO: imports em 20/10 e depois só 25/10 manual. Causa: sync-matinal não cobre extrato. FIX: incluir extrato no sync matinal
- [ ] 3. Lilian (R$ 283,93, fatura 932859028): pessoa FOI identificada (party vinculada), mas ela não tem NENHUM título no Lardan Cloud — fiado dela nunca foi importado. FIX: importar fiado dela do SmallData ou criar título pela mesa
- [ ] 4. PIX duplicado R$ 115,56 (20/10, Santander): só existe UMA linha no banco (status ignorada) — a duplicidade não está mais presente; dedup por hash funcionou. Verificar com Diego se ele viu duplicado no arquivo do banco
- [ ] 5. DRE igual ao Conta Azul: Notificação Asaas → 4.1.3 (hoje 5.1.1); Taxa de boleto → 4.1.2 (hoje 5.1.3); empréstimo R$ 180 mil Caixa fora da estrutura. PENDENTE: mapear chart_of_accounts e corrigir classificações

## Melhorias
- [ ] 6. Opção "é transferência" na mesa de conciliação
- [ ] 7. Importar OFX direto (Santander, Sicoob, Caixa, Itaú)
- [ ] 8. Tela/alerta para 15 cobranças "Recebidas no Asaas" (R$ 2.588,74)
- [ ] 9. Comissão automática de consultoras (acertos SmallData)
- [ ] 10. Relatório de vendas por praça e representante
- [ ] 11. Inadimplência por representante no DRE
- [ ] 12. Filtro por tipo nas 693 pendências do DRE

## Fundo do sistema (vidro cinematográfico)
- [x] 13. Fundo cinza carbono 30% mais claro (base oklch L 0.235 → 0.3055; camadas de luz elevadas na mesma proporção). Cartões, menus, dock, gráficos e consultora intactos. Medido na prévia: fundo central #322f33 (antes #201d20). Falta publicar

## Fundo da consultora igual ao sistema — 25/10
- [x] Consultora (dark, celular e computador): imagem do site removida; fundo carbono premium idêntico ao do sistema (provado em 390x844 e 1440x1000 como Diego Silva)

## Excluir documento judicial anexado por engano — 26/10
- [x] Botão Excluir na ficha de cobrança (aba Judicial): confirmação + motivo obrigatório, apaga o arquivo do cofre, grava histórico na ficha e auditoria (quem removeu, qual documento, motivo). Migração 0157 (cob_judicial_doc_excluir), teste isolado cobranca-doc-excluir (4 testes), prova real na ficha da Silvia Helena: "ACORDO REGIANE assinado.pdf" removido por Diego via tela. Falta publicar

## Mapa de Inteligência da Rede (26/10/2026)
- [x] 14. Todas as consultoras no mapa da cidade (ativa verde e maior, inativa cinza), sem coordenada = centro da cidade tracejado
- [x] 15. Localização por rua (geo-2) + botão "Localizar ruas da cidade" + agendamento a cada minuto (vale após publicar)
- [x] 16. Contagem por município única por IBGE (Londrina estava dividida em "Londrina"/"LONDRINA")
- [ ] 17. Restante da rede refinado por rua aos poucos pelo agendamento (depende de publicar)

## Preço para baixo + 9 botões (28/10/2026)
- [x] Regra de preço para baixo (degraus R$ 5 → x4,90/x9,90); simulação: 16.919 de 17.314 variantes baixam, 0 sobem. Aplicação real aguarda Daniel/Master em Configurações → Pedido e preço
- [x] App da consultora no celular: 9 botões grandes; Minhas clientes = lista; Jornada e Liga separadas

## 28/10 noite
- [x] Salvar Textos e Pix / calibração Argox / regra pré-baixa (erro "UPDATE requires a WHERE clause") — migrações 0174/0175
- [x] Preço para baixo aplicado: 16.919 variantes, lote preco-20261028-192646-9fd2, 0 subiram; 2 maletas em montagem recalculadas. Botão Aplicar/Desfazer pela tela estoura tempo (fazer por aqui)
- [x] QZ: não pede mais a lista de impressoras a cada etiqueta; instrução override.crt visível (depende de copiar o arquivo em cada PC)
- [x] Etiqueta PPLA: barras sem texto embaixo, referência/preço uma vez (teste)

## Financeiro Asaas (nov/2026)
- [ ] A: destravar fila Asaas (617 avisos parados; 62 pagas sem título R$ 12.879,94; 5 sincronizações presas)
- [ ] B: "valor parecido" só sugere; relatório de fiados antigos já quitados em acertos
- [ ] B2: Pix sem identificação → nome+CPF do pagador, único ou manual
- [ ] C: acordo Larissa: parcelas no Asaas, aguardando 1º pagamento, prazo venc.+5d, cancela no Asaas e avisa Larissa
- [ ] D: "Pago por outra forma" no Contas a Receber (Pix ↔ link Asaas), valida acordo

## Pacote 0214 — nota fiscal de teste na maleta conferida (05/11/2026)
- [x] Migração 0214 aplicada (cycle_id/composicao_versao, uma nota viva por maleta, só homologação); fiscal_settings conferido: focus/homologacao/emissão desligada. Código copiado byte-exato; build OK.
- [x] 5 testes isolados passaram no banco novo (452 migrações). Prova de tela: remessa 925 como Master, 21 maletas conferidas com botão "Nota fiscal (teste)" ativo. Emissão real na Focus não testada (homologação).
- [ ] Publicação aguarda aprovação de Diego (junto da 0213); regras do banco já valem, botões dependem de publicar.

## Pacote 0228 — Correios, etapa 1
- [x] Inspecionar pacote e aplicar conexão/diagnóstico Master sem postagem, cobrança ou migração.
- [x] Configuração do pacote salva sem substituir o código de acesso existente; ambiente homologação conforme o pacote.
- [x] 7 testes locais passaram, compilação OK; painel aberto como Diego e clique real em Testar conexão confirmado. Provas: docs/provas-correios-0228.md.
- [x] Produção (05/11): conexão aceita, 100 serviços do contrato, PAC 03298 e PAC reverso 03301 R$ 25,94 em 7 dias (caixa padrão). Serviço 03310 recusa preço (400); rastreio não testado.
- [ ] Publicação depende de autorização de Diego.

## Cobrança — plano 3° a 8° (por etapas)
- [x] Etapa A: importar planilha do jurídico (prévia + aplicar Master, aba Processos, alerta 5 dias sem protocolo)
- [x] Etapa B: Kanban novo + KPIs por período (prorrogação única registrada; envio ao Judicial manual após 5 dias)
- [x] Etapa C: termo de confissão ZapSign por acordo (código WhatsApp + selfie + documento); modelo é minuta aguardando revisão do jurídico
- [x] Etapa D: faturas de venda nascem na 3.1.1; TED judicial sugere 7.1.7 + devedora pelo nº do processo, sem baixa automática (0234, 7 testes isolados)
- [ ] Conferir com Diego: 3 títulos do PDV sem classificação (R$ 699,50) e 3 cobranças Asaas pagas sem baixa automática
- [x] Etapa E: aba Histórica até 2025 (0235/0236): fatura única = acordo de 1 parcela sem juros/desconto, prévia, lote até 200, envio pelo disparo oficial; Judicial/acordo/Asaas aberto ficam de fora; Régua Asaas esconde quem só deve até 2025. 7 testes isolados + 6 unitários; prévia real sem gravar.

## Pacote 0273/0274 — maleta designada usada para abertura
- [x] Representante escolhe qualquer maleta com ele (ainda não entregue) para a abertura
- [x] Nota já emitida não trava: troca na hora + pendência fiscal para a montagem na tela da remessa
- [x] Testes isolados (6) + regressão do app do representante/abertura/acerto

- [x] 0277 — "Acordos atrasados" abre a lista nominal de quem está em atraso (mesma conta do indicador)

## Pacote 0278 — candidata do link e maletas de abertura (10/11/2026)
- [x] Link do representante (?rep=lc-…) grava a candidata na carteira dele na hora (origem "Veio pelo seu link")
- [x] Aba Abertura: lista "Candidatas esperando abertura" com botão Fazer abertura
- [x] Painel Master: card mostra o representante da candidata
- [x] Maletas de abertura com "ABERTURA 01 · Remessa X" e em ordem (abertura, depois remessa)
- [x] Testes isolados + provas de tela

- [x] 0279 Transferir maleta em 2 momentos (equipe/Daniel e representante): antes da nota e na rua com nota/promissória; pendência fiscal única, promissória antiga cancelada/guardada, nova enviada. Testes 13 novos + bateria 751/751.
- [ ] 0279 publicar (aguarda Diego)
- [x] 0280 Mudar remessa/representante de maleta pronta; devolver maleta à empresa (app do representante + confirmação da montagem, peças voltam ao estoque); Correios para maleta em trânsito; 30 dias só sem representante. 9 testes novos + bateria 760/760.
- [ ] 0280 publicar (aguarda Diego)

## Pacote 0281 — recebimento de maletas na Qualidade + correções 0280 (11/11/2026)
- [x] Corrigir "Saldo insuficiente (-95 peças)" ao confirmar chegada da maleta devolvida
- [x] Correios: valor declarado abaixo do mínimo (R$ 25,63) recusado — ajustar para o mínimo/máximo aceito
- [x] Mudar remessa: escolher representante primeiro, depois a remessa (ou digitar o número); listar todas as remessas
- [x] Responder: devolução não gera nota automática (pendência para a montagem)
- [x] Aba "Recebimento de maletas" na Qualidade (bipar maleta, chegando, conferir peças, pendente por representante)
- [x] Expedição de retorno no app do representante (tudo que estava com ele precisa voltar)
- [x] Testes isolados (9 novos, bateria 769/769) + 5 unitários Correios + provas de tela
- [ ] Publicar (pedido do Diego) e Daniel testar com maleta real

## 0282 — revisão 0266–0281 (pacote do Diego)
- [x] Aplicar mudança de banco 0282 (raio-x M3/F6/F9, ABERTURA sem repetição, fila fiscal x pendência, encerrar não reativa)
- [x] Código: fila do Asaas na rotina da manhã + botão usando a mesma função
- [x] Testes: 7 novos, bateria isolada 776/776; mudança roda duas vezes sem erro
- [x] Publicar — aprovado pelo Diego em 11/11 (publicação pedida 14h30)
- [ ] 12/11 após 6h: devolver bloco fila_avisos da rotina e F6 do raio-x (esperado perto de 19) — aguarda a rotina rodar

## 0285 — Asaas rodando sozinho (pedido do Diego, 11/11)
- [x] Gislaine R$ 315,44: linha solta e lançada (título 3.1.1 já baixado)
- [x] Botão "Processar fila" só processa pendentes, com tempo máximo
- [x] Pix/fatura recebidos baixam sozinhos (pay_, fatura, código, CPF); sem nada em aberto → 3.1.1; maleta em acerto → exceção
- [x] Juros automáticos até o menor entre R$ 50 e 10% do saldo
- [x] "Não, é novo" com pay_ lança preso à cobrança (nunca dois lançamentos); desfazer com motivo
- [x] Rotina a cada 10 min, extrato de hora em hora, relatório "Asaas automático"
- [x] Primeira passada em produção: 41 recebimentos (R$ 10.441,87) lançados e conciliados, 3 exceções
- [x] Maleta em vendas também vai para a exceção; 14 lançamentos (R$ 3.641,31) desfeitos e postos na exceção
- [x] 576 títulos "Não identificado" (R$ 123.534,06) passaram para a pessoa da cobrança; 349 linhas do extrato ligadas à baixa já lançada
- [x] Tarifas 5.1.3 (348, R$ 712,48), notificações/negativação 5.1.1 por mês (2 meses, R$ 326,70), transferências conferidas (55, R$ 62.138,04)
- [ ] TED judicial 7.1.7 automático: a Mesa já sugere processo + 7.1.7 (0234); nenhum TED pendente hoje (25 conciliados, 83 ignorados/repetidos) — baixa sozinha fica para quando houver TED novo para testar
- [ ] Publicar (painel, Mesa e extrato de hora em hora só funcionam publicados)

## Pacote 0283 (Etapa 1)
- [x] Segunda maleta com motivo (equipe e representante), desfazer devolução (Master), Correções do administrador, Qualidade em 3 abas
- [x] Etapa 2 (0284): teste de candidatura completo (site enxuto, link, análise, representante, parâmetros)
- [ ] Textos DEVOLUTIVA/ENTREVISTA/ACOMP do protótipo (aguarda Daniel)
- [ ] MAL-00359 x MAL-00441: qual maleta está com Leila Maria (aguarda Diego)
- [ ] Publicar 0283 (aguarda aprovação)

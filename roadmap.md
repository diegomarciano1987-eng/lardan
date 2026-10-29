# Roadmap

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

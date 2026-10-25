# Roadmap

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

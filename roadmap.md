# Roadmap

## Conciliação Asaas/bancos — correções (relatório Diego 25/10/2026)
- [ ] 1. Baixa parcial Asaas desfeita sozinha (Maria Celina, linha 17/10 R$ 299,22, fatura 935298558, título 2026-024776 parc. 2 R$ 656,22; ajuste −299,22 reaparece e linha volta a pendente; baixa SmallData de R$ 357,00 em 13/10 não aparece; remover ajuste se for sobra)
- [ ] 2. Sincronização automática Asaas parou de 21 a 25/10 (cron sync-matinal)
- [ ] 3. Cobrança recebida vira "Não identificado" (Lilian R$ 283,93, fatura 932859028) — vínculo automático por cliente Asaas
- [ ] 4. Duplicidade não detectada: PIX R$ 115,56 CPF 07382168956 de 20/10 entrou 2x no Santander
- [ ] 5. DRE igual ao Conta Azul: Notificação Asaas → 4.1.3 Taxas de Cartão/Site/Plataformas (hoje 5.1.1); Taxa de boleto → 4.1.2 Emissões de Boletos (hoje 5.1.3); empréstimo R$ 180 mil Caixa fora da estrutura no lucro de outubro

## Melhorias
- [ ] 6. Opção "é transferência" na mesa de conciliação (PIX R$ 19.000 Asaas→TSM, aplicações/resgates Santander)
- [ ] 7. Importar OFX direto do banco (Santander, Sicoob, Caixa, Itaú) sem ajuste
- [ ] 8. Tela/alerta para 15 cobranças "Recebidas no Asaas" (R$ 2.588,74) não ficarem esquecidas
- [ ] 9. Comissão automática de consultoras (acertos SmallData: bruta − líquida, por semana e praça)
- [ ] 10. Relatório de vendas por praça e representante (importar relatório de cobrança SmallData)
- [ ] 11. Inadimplência por representante no DRE (ligar título ao representante)
- [ ] 12. Filtro por tipo nas 693 pendências do DRE (sem conta contábil, sem centro de custo, extrato não conciliado)

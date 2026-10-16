# Conferência financeira — nove pontos de 16/10/2026

## Resultado e limites

Sem publicação. O backend é compartilhado: correção autorizada da data do aluguel e unificação de Daniel já estão nos dados reais. Não foram criados títulos nem realizadas novas conciliações reais para testar.

1. **Editar parcela:** corrigida referência inexistente `asaas_charges.status` para `external_status`. Teste altera R$ 138,15 para R$ 138,13 e vencimento, conferindo total/evento. Parcela real da impressora não alterada.
2. **Classificação na Mesa:** vínculo existente mostra e preserva classificação do título; palpite aprendido só vale para novo título. Teste preserva Aluguel e centro de custo. Caminho visual completo da Mesa não exercitado nesta etapa.
3. **Data do estorno:** rotina protegida com data esperada, motivo, snapshot e atualização atômica dos movimentos. Estorno de R$ 3.100 do título 2026-007482 corrigido de 16/10 para 09/10 pelo formulário autenticado. Consulta posterior confirmou data 2026-10-09, valor -310000, um snapshot e movimento de contrapartida de 310000 na mesma data. Valores/vínculo original preservados. Testes cobrem autorização e data anterior à baixa; rotina também bloqueia futuro/período fechado.
4. **Estorno duplicado:** detalhe informa `ja_estornada`; tela real não exibe Estornar na baixa original de R$ 3.100. Contrapartida exibe Editar data. Segunda chamada não duplica estorno no teste.
5. **Daniel e duplicados:** prévia sem conflito, seguida da rotina oficial: LC-003221 → LC-001617. Migrados um papel, dois contatos, um endereço, um título e um perfil. Registro `19623525-cb47-4777-a3ac-64381bd5d395`; ficha canônica aberta após execução. Alerta remoto protegido por nome/documento, CPF mascarado; homônimo pode ser confirmado como outra pessoa, documento igual bloqueado. Reversão da fusão não validada.
6. **Busca anterior:** reabertura após IDENTIFICADO confirmou busca vazia.
7. **Parcelamento anterior:** reabertura após 12 e 123,45 confirmou quantidade/valor vazios; demais campos reiniciam também.
8. **Busca contábil:** sempre disponível com pesquisa remota; A receber conferido com 3.1.1 e opção retornada.
9. **Atalhos:** guarda suspende atalhos com alvo editável/seletor aberto, incluindo Ctrl/⌘+Enter nesses estados. Interação da Mesa não testada nesta etapa.

## Provas

- 243 testes isolados aprovados, zero falhas, 1.265 assertions, 18 arquivos; oito testes novos.
- 10 testes financeiros existentes aprovados: parcelamento, classificação e fluxo/DRE.
- Primeira execução travou na reserva de conexão do teste novo; corrigido para helper existente, suíte completa subsequente aprovada.
- Compilação automática OK em 2026-10-16T23:25:42Z.
- Formulário autenticado, pesquisa contábil, alerta e correção real conferidos; nenhum erro de página no fluxo dos controles.
- Capturas temporárias em `/tmp/browser/nove-financeiro/`: conta-busca.png, duplicados.png, aluguel-corrigido.png, daniel-unificado.png. Não distribuir captura da ficha com dados pessoais.

Pendências anteriores mantidas no roadmap: publicação, Maria Vieira, tarifas duplicadas, limites do patch anterior, extratos, Infinity Pay, Rede e centavos dos cartões. Nada executado implicitamente fora do escopo.
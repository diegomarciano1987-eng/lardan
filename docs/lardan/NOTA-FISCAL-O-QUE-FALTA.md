# Nota fiscal: o que existe e o que falta (22/10/2026)

Resumo: **não é só ligar o token da Focus.** O banco tem a cadeia fiscal pronta e testada, mas fora da produção, e não existe nenhum código que converse com a Focus.

## Pronto

- Produção: `fiscal_settings` com trava (só Master, auditoria), `nfe_chave_valida`, `fiscal_prontidao()` (contagens).
- Bancada isolada (db/pendentes 01, 02, 04, 06, 11): documentos fiscais imutáveis, referências entre notas, tentativas, eventos, fila (`fiscal_outbox`), `fiscal_doc_preparar/validar/enfileirar`, retorno do provedor só pelo servidor, autorização exigindo chave válida do emissor, cancelamento, acerto (`kit_acertos`) e preços versionados.
- Roteiro fiscal observado nas 73.969 notas do JFLEX (`fiscal_roteiro_referencia`): remessa 5917/6917, devolução como entrada 1918/2918 com referência, venda 5114/6114, perda 5927 (SP 6949), CSOSN 102, PIS/COFINS 07, NCM 71171900, valor = 1/3 do varejo.

## Falta (em ordem)

1. **Promover os pacotes 01, 02, 04, 06 e 11** a migrações oficiais (rodada própria, com autorização). Sem isso não existe documento fiscal nem acerto na produção.
2. **Montar a nota a partir do roteiro**: hoje `fiscal_doc_preparar` deixa de propósito "natureza, CFOP, regime e valor fiscal (1/3) pendentes". Falta a regra que, para cada tipo (remessa, devolução, venda, perda), preenche natureza, CFOP por UF, CSOSN, PIS/COFINS, NCM, valor 1/3, texto complementar e a referência à NF de remessa.
3. **Integração Focus (servidor)**: cliente da API (emitir, consultar, cancelar, inutilizar), processador da fila (a cada minuto, com nova tentativa e chave de idempotência = id do documento), webhook `/api/public/focus/webhook` com segredo, guarda do XML e do DANFE. Nada disso existe hoje.
4. **Numeração e série**: o JFLEX emite na **série 2**. Ou o Lardan começa em série nova, ou continua a série 2 a partir da última nota do JFLEX — e o JFLEX **para de emitir** no dia da virada. Duas origens na mesma série = rejeição por duplicidade.
5. **Contador**: validar o roteiro, a base de 1/3 do varejo, a perda fora do PR (6949) e a regra de devolução sem nota simbólica.
6. **Focus**: conta da empresa, certificado A1 enviado, token de **homologação** primeiro, plano para ~2.300 notas/mês.
7. **Regra de expedição**: a maleta só sai com a NF de remessa autorizada e o DANFE impresso junto da promissória.
8. **Cadastro**: CPF válido, endereço completo com código IBGE. A `fiscal_prontidao()` mostra quantos faltam; com os cadastros vindos do histórico esse número cresce.
9. **Homologação ponta a ponta**: remessa → devolução parcial → venda → perda → cancelamento, conferindo XML e DANFE com o contador, antes de virar para produção.

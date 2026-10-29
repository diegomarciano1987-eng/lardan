# Pacote 0165 — resultado de 29/10/2026

## Cadastro e segurança
TSM COMERCIO DE SEMIJOIAS LTDA / LARDAN SEMIJOIAS; CNPJ 43.319.208/0001-80; IE 90908301-01. Endereço principal: Avenida dos Estudantes, 1277, Setor 1, Ibiporã/PR, CEP 86200-055, IBGE 4109807. O endereço anterior permanece, não principal.

Diego autorizou a conferência/unificação. Prévia oficial mostrou 5 títulos financeiros, 2 contatos, 1 endereço, 1 ficha de consultora, 1 vínculo de representante, 1 papel e 3 referências no lastro fiado. Execução oficial manteve LC-007417 ativa; LC-003419 permanece histórica, com documento preservado. Unificação registrada: `554e2c5c-245b-4531-a99e-3b0e185400b7`; evento fiscal `fiscal.emissor_cadastrado` confirmado.

O pacote é exclusivamente de dados, portanto foi aplicado pela ferramenta de dados, sem gerar migração DDL e sem sobrescrever a 0165 existente. SQL em `db/aplicados/0165_emissor_fiscal_tsm.sql`; única adaptação funcional: ignorar duplicadas já registradas pela unificação oficial. Notas/auditoria podem ganhar novo registro numa repetição; não foi alegada idempotência absoluta desses textos.

## Resultados solicitados
Retorno real de `fiscal_prontidao` em sessão autenticada:
```json
{"uf":"PR","ie_ok":true,"cnpj_ok":true,"ibge_ok":true,"definido":true,"endereco_ok":true}
```
Configuração real:
```json
{"provider":"focus","environment":"homologacao","emission_active":false}
```
Nenhuma instrução alterou regra de valor fiscal, responsável ou fundamento. Nenhuma emissão, cobrança, venda ou liquidação foi disparada.

## Provas
- Tela autenticada `/admin/integracoes`: emissor com cinco indicadores “Sim”, UF PR; “Emissão desligada · focus · homologacao”. Captura inspecionada: `/tmp/browser/fiscal0165/prontidao.png`.
- Banco: endereço principal novo e anterior não principal; empresa/emissor ligado; auditoria fiscal confirmada.
- 514 testes passaram, 0 falhas, 2468 verificações, 52 arquivos; bancada Postgres local sem cópia de dados operacionais.
- Três testes novos: dados oficiais/estado desligado/endereço preservado/repetição sem duplicar empresa ou endereço; recusa de duplicidade; seleção após unificação mantendo CNPJ histórico.
- Duas expectativas antigas de preço para cima foram atualizadas à regra para baixo já aprovada; nenhuma regra de preço da operação foi modificada.
- Prévia sem erros de compilação.

## Como consultar e limites
Sistema → Integrações → Nota fiscal — prontidão. Cadastro já vale na base compartilhada, sem publicar. Não significa liberação para emitir: o relatório ainda aponta pendências de cadastro e cadeia fiscal/acerto. Nenhuma chamada externa à Focus nem emissão homologada/produção foi realizada.
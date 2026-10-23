# Aplicação 0128/0129 — 23/10/2026
- 0128: já aplicada antes; SQL do pacote igual (só a quebra de linha final). Teste igual.
- 0129: aplicada como drizzle/migrations/0129_codigo_smalldata_no_cadastro.sql, idêntica ao pacote (fora espaços). Teste codigo-smalldata.test.ts e PROMPT copiados; regra no AGENTS.md.
- Bateria: 391 pass, 0 fail, 1.852 verificações, 34 arquivos.
- Carla Vicente Ferreira: ligada ao 8705 (party_codigos_legados cliente/8705 e legado_consultoras codcli 8705). party_codigo_smalldata_adotar como Diego (Master): LC-003109 → 8705; party_codigo_historico registra LC-003109→8705 às 15:04:54 UTC; audit_logs cadastro.codigo_smalldata = 1. search_registry('LC-003109') acha a Carla. Mesmo id: 0 títulos, 0 cobranças Asaas, 0 maletas Lardan, 2 maletas SmallData (codcli 8705).
- Prévia em lote: não terminou dentro do tempo limite (API autenticada e ferramenta de serviço). Nada gravado: party_codigo_historico continua com 1 linha.

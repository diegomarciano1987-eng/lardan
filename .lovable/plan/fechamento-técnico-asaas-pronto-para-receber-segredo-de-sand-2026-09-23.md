# Fechamento técnico Asaas — pronto para receber segredo de sandbox

Escopo restrito ao módulo Asaas/financeiro. Sem conexão, sem chave real, gate desligado, banco compartilhado e site publicado intocados. Favicon e arquivos alheios saem do pacote.

## Problemas já confirmados na leitura inicial
- `asaas_exec_adiar` (08) grava `lease_until=NULL` mantendo `processando`; reservar/pendentes não retomam.
- Configuração concorrente: `index.ts` (`ASAAS_MODO/AMBIENTE/API_KEY`, `configuracaoDoServidor`) usada por `cobranca.functions.ts` e `demo.functions.ts`.
- `TransporteHttpAsaas` sempre cai em `fetchBloqueado`, mesmo com tudo válido.
- Paginação: transporte e simulador calculam próximo offset por `data.length`; importador herda.
- Cobrança cria intenção e importação abre lote antes de validar conta/segredo/gate.
- Tela exibe "Saída externa desligada" fixo.
Os demais itens (posse do cliente sem token, concorrência de consultas na importação) serão reproduzidos no banco isolado antes da correção.

## 1. Estado de espera de retentativa
- Novo estado `aguardando_retentativa` (com `next_attempt_at`, `failure_class`); transições estritas e auditadas.
- `reservar`/`pendentes` só pegam após o prazo, com `FOR UPDATE SKIP LOCKED` (um único trabalhador).
- 401/403 → `credencial_indisponivel` visível como pendência operacional, sem nova intenção; 429 respeita Retry-After válido (limites mín./máx.); consulta indisponível adia; desconhecido sempre consulta antes de reenviar; terminal permanece terminal.
- Relógio controlado nos testes (parâmetro `_agora` só no executor interno).

## 2. Preflight no servidor
- Rotina interna `asaas_exec_preflight(installment|lote)` derivando parcela → título → empresa → conta padrão, somada à checagem de segredo/UUID/gate no servidor.
- Falha: nenhuma intenção, lote, tentativa ou mudança em título/parcela/cobrança; mensagem sanitizada.

## 3. Configuração única
- Remover `lerConfiguracao`/`configuracaoDoServidor` e variáveis antigas; resolver por conta: estado + ambiente do banco, `secret_ref` só com nome, segredo lido no servidor, `ASAAS_CONNECTED_ACCOUNT_ID`, `ASAAS_EGRESS_ENABLED`.
- Server function autenticada (leitura financeira) devolve apenas: simulada, preparada, sandbox configurado, saída desligada, credencial ausente/incompatível, suspensa, indisponível.
- Documentação com placeholders `ASAAS_SANDBOX_LARDAN`, `ASAAS_WEBHOOK_LARDAN`, `ASAAS_CONNECTED_ACCOUNT_ID`, `ASAAS_EGRESS_ENABLED`.

## 4. Fábrica de transporte
- Simulado → simulador; sandbox → HTTP com `fetch` real injetado somente se conta, ambiente, prefixo `$aact_hmlg_`, UUID e gate forem válidos; produção bloqueada estruturalmente; gate ≠ 1 → recusa antes de qualquer DNS/requisição. Headers `access_token`, `Content-Type`, `User-Agent`.

## 5. Paginação oficial
- Próximo offset = offset + limit solicitado enquanto `hasMore`; corrigido em transporte, simulador, importador, rotina do banco (valida avanço = limit) e docs.
- Provas: normal, curta com hasMore, vazia com hasMore, 100 brutos/0 mantidos, interrupção/retomada, 1.005 cobranças sem omissão/repetição/ciclo.

## 6. Cliente concorrente
- Posse com `lease_token` + tentativa; persistir cliente exige token atual; renovação durante chamada lenta; expiração durante POST lento leva o próximo a consultar por referência antes de criar.
- Importação com limite de concorrência de consultas (fila de até N simultâneas).

## 7. Interface
- Estado real da conta selecionada; botões de cobrança, recuperação, link e importação desabilitados com motivo; avisos permanentes (não liquida, link não prova pagamento, não prova venda, não emite nota, eventos aguardam conciliação, simulação não pagável). Validação 1280 px e 390 px.

## 8. Migrações e segurança
- Novo `db/pendentes/09-asaas-retentativa-preflight.sql`, aplicado no pacote atômico; reconstrução do zero e atualização a partir do estado do pacote anterior (05+07+08 aplicados, depois 09).
- Verificação de privilégios após cada etapa: `asaas_exec_*` apenas service_role; perfis desativado/sem pessoa recusados; consultora/representante/visitante sem acesso; produção bloqueada; nenhum segredo persistido.

## 9–10. Provas e pacote
- Bateria isolada completa, HTTP com fetch falso, duas instâncias, retentativas com relógio controlado, typecheck, navegador 1280/390 com registro de hosts (Asaas deve falhar antes do acesso).
- ZIP novo com relatório, logs completos, capturas reais, roteiro, lista de arquivos, manifesto SHA-256 conferido contra o conteúdo, comparação com o pacote anterior; sem favicon nem arquivos alheios; nada declarado que não esteja no ZIP.

## Detalhes técnicos
Arquivos: `db/pendentes/09-*.sql`, `src/lib/asaas/{index,transporte-http.server,simulador,importacao,cobranca,cobranca.functions,importacao.functions,demo.functions,servidor.server}.ts`, `src/lib/asaas-painel.ts`, `AsaasReceber.tsx`, `AsaasImportacao.tsx`, `tests/isolado/asaas-*.test.ts`, `tests/asaas/transporte-http.test.ts`, `docs/lardan/ASAAS-RECEBIVEIS.md`, `roadmap.md`.

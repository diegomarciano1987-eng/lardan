# Fechamento final da preparação Asaas

## Diagnóstico confirmado no código atual

- **Conta ainda controlável pela tela:** `cobranca.functions.ts` recebe `accountId` para gerar e recuperar link, e cria o transporte antes de derivar a conta da intenção/cobrança. `AsaasReceber.tsx` envia esse identificador.
- **Configuração global, não por conta:** `index.ts` lê `ASAAS_MODO`, `ASAAS_AMBIENTE` e uma única `ASAAS_API_KEY`; `criarTransporte(accountId)` usa a mesma chave para qualquer conta e não consulta o cadastro da conta.
- **Rede sem chave adicional:** o `fetch` padrão está bloqueado, mas não existe uma habilitação separada que continue obrigatória quando modo e credencial forem configurados.
- **Estados contraditórios possíveis:** `environment`, `state`, `is_active`, `modo_execucao` e `ambiente_provedor` não formam uma única máquina de estados. A restrição atual valida apenas modo/ambiente; `asaas_import_abrir` aceita conta preparada/inativa e ainda usa `environment` para definir simulação.
- **Fallback silencioso:** `asaas_cobranca_preparar` usa `coalesce(modo_execucao,'simulado')`.
- **Importação operacional ausente:** `AsaasImportacao.tsx` chama somente `demoImportar`; não existe ação comum autenticada que resolva conta/transporte no servidor.
- **Lote cruza contas na tela:** o lote retomado busca o último registro sem `account_id`; a chave de cache também não contém a conta.
- **Cursor incorreto:** `TransporteHttpAsaas.pagina` calcula o próximo offset por `data.length`; depois o filtro local reduz `itens`, e `buscarPaginas` envia ao banco apenas `_offset` e os itens mantidos. A rotina SQL avança por `_offset + jsonb_array_length(_itens)` e o laço para quando a página filtrada fica vazia.
- **Banco não valida ordem da página:** `asaas_import_pagina` aceita cursor regressivo, salto e repetição sem conferir posição bruta consumida.
- **Cliente duplicável em concorrência:** não há reserva transacional por `(account_id, party_id)`. Duas intenções podem consultar ausência e criar ao mesmo tempo. A consulta local usa `LIMIT 1`, escolhendo silenciosamente quando há mais de um vínculo.
- **Falhas ainda colapsadas:** `executarIntencao` trata toda `RecusadoPeloProvedor`, incluindo credencial e limite, como rejeição definitiva. Não persiste `Retry-After` nem prazo de retomada.
- **Link pode usar transporte errado:** `obterLinkDaCobranca` recebe `accountId` do navegador; a checagem posterior compara somente o modo, não a conta nem o ambiente.
- **Migração intermediária insegura:** `05-asaas-receber.sql` cria e concede a `authenticated` as rotinas antigas de resultado, processamento e evento; `07` só as remove depois. Os arquivos são aplicados separadamente, sem uma transação que cubra o conjunto.
- **Webhook apenas parcial:** há validação de envelope e persistência service-role, mas não há manipulador bloqueado que derive a conta por configuração segura do endpoint, valide token separado da API e responda após persistir.
- **Documentação desatualizada:** ainda descreve as rotinas antigas como fluxo atual e resultados de rodadas anteriores.
- **Limites financeiros preservados:** o código de evento apenas atualiza o espelho; não cria liquidação, alocação ou razão. Esse comportamento será mantido e coberto por regressão.

## Implementação

### 1. Migração final, atômica e reconstruível
- Consolidar as mudanças Asaas ainda pendentes para aplicação dentro de transação única, eliminando do arquivo 05 a criação/concessão das três rotinas antigas.
- Criar máquina canônica de estados da conta: `preparada`, `simulada`, `sandbox_conectada`, `producao_conectada`, `suspensa`, com restrições completas sobre os campos legados.
- Manter produção impossível de ativar nesta rodada.
- Restringir referências de segredo a nomes próprios Asaas; armazenar somente a referência, nunca o valor.
- Revogar alteração direta dos campos críticos e criar rotina autorizada, validada e auditada para configuração futura.
- Criar resolução interna da conta para intenção, cobrança e lote; somente `service_role`, sem expor segredo ou cabeçalhos.
- Adicionar estruturas de cursor bruto, próxima tentativa e coordenação de cliente por conta+pessoa.
- Testar rollback por falha deliberada e reconstrução do zero sem janela de execução insegura.

### 2. Configuração e transporte decididos pelo servidor
- Substituir a configuração global por resolução por conta, lendo no servidor apenas o segredo referenciado e validando UUID de conta quando a instalação suportar uma só conta conectada.
- Exigir habilitação adicional de saída externa, desligada por padrão, além de modo conectado e credencial.
- Bloquear conta preparada, suspensa, inativa ou incoerente em importação, criação, consulta e evento.
- Garantir correspondência exata entre conta, modo e ambiente do transporte.
- Retornar à interface somente estado público sanitizado: simulação isolada, preparado com rede bloqueada, sandbox configurado, produção configurada, incoerente ou suspensa.

### 3. Importação comum e paginação correta
- Criar ação autenticada de importação que derive conta e transporte no servidor e reutilize `abrirLote`, `buscarPaginas` e `gerarPrevia` para simulação e futuro sandbox.
- Manter a semeadura sintética em ação separada, exclusiva do ambiente isolado.
- Fazer a tela usar a ação comum; filtrar retomada, consultas e chaves de cache por conta.
- Modelar `offset solicitado`, `limite solicitado`, `quantidade bruta`, `próximo offset` e `quantidade mantida`.
- Persistir o cursor bruto do provedor; continuar com página filtrada vazia quando `hasMore=true`.
- Recusar no banco cursor regressivo, página fora de ordem e avanço incompatível, aceitando repetição idempotente da mesma página.

### 4. Coordenação de cliente entre processos
- Reservar `(account_id, party_id)` no banco antes de localizar/criar cliente.
- Sob a reserva: verificar vínculo local, consultar referência externa, criar apenas se ainda ausente e persistir imediatamente.
- Em resposta perdida, retomar por consulta da referência antes de novo POST.
- Recusar múltiplos vínculos sem cliente canônico; nunca usar `LIMIT 1` arbitrário.
- Provar com duas instâncias concorrentes: um cliente externo e duas cobranças.

### 5. Falhas, retomadas e links
- Separar falha pré-envio, validação 400/422, credencial 401/403, limite 429 com `Retry-After`, resultado desconhecido após POST, falha de GET e referência ambígua.
- Persistir códigos, categoria e prazo de nova tentativa; manter a mesma intenção durante falha recuperável.
- Fazer recuperação de link aceitar somente `chargeId`; derivar conta, ambiente e ID externo internamente antes de criar o transporte.
- Guardar URL não homologada para revisão sem exibi-la como pagável; liberar host por configuração segura e fechada.
- Cobrir troca maliciosa de conta, ambiente e transporte, IDs externos iguais entre contas, usuário sem permissão e conta suspensa.

### 6. Contrato de webhook inativo
- Criar manipulador interno testável, sem rota pública ativa.
- Validar `asaas-access-token` com segredo diferente da API, limite de corpo e conta derivada da configuração segura.
- Persistir primeiro, deduplicar por conta+evento, responder rapidamente e deixar processamento posterior idempotente.
- Guardar evento desconhecido para revisão; nunca gerar baixa, alocação ou razão.

### 7. Interface e documentação
- Exibir o estado real por conta sem dizer “Conectado” quando a rede estiver bloqueada.
- Impedir ações incompatíveis com o estado da conta.
- Atualizar a documentação, remover referências às rotinas antigas e preservar explicitamente os limites comerciais, fiscais e financeiros indicados.
- Atualizar tipos necessários sem tocar em arquivos gerados protegidos manualmente; usar a geração oficial quando aplicável.

## Provas isoladas obrigatórias

- Recriar o banco isolado do zero e executar toda a suíte anterior.
- Acrescentar testes de paginação: página bruta 100/filtrada 0 com continuação, parcial, retomada, curta com `hasMore`, repetida, e mais de 1.000 cobranças sem omissão/ciclo/repetição.
- Testar duas contas, duas instâncias, concorrência de cliente/cobrança, reinício após envio e todos os estados/falhas.
- Provar que visitante e autenticado não executam nenhuma rotina interna.
- Executar transporte HTTP somente com `fetch` falso e testar o bloqueio padrão de todos os hosts Asaas.
- Executar verificação de tipos.
- Exercitar navegador isolado em 1280 px e 390 px com Financeiro, Diretoria, consultora, usuário desativado e usuário sem pessoa.
- Registrar os hosts contatados e confirmar ausência de domínios Asaas.
- Confirmar contadores de liquidações, alocações e razão inalterados.

## Pacote final

- Gerar ZIP versionado com código, pendentes, testes, documentação, capturas reais, logs realmente executados, relação exata de arquivos e manifesto SHA-256 de cada item.
- Descompactar em diretório limpo, validar manifesto e instrução reproduzível antes da entrega.
- Manter banco compartilhado e site publicado intocados.

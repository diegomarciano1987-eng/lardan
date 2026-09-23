# Preparação: acerto, Asaas e cadeia fiscal

Rodada longa, sem ligar nada. Nenhuma integração conectada, nenhuma nota emitida,
nenhuma cobrança criada, nada publicado e nada aplicado ao banco compartilhado.

## Ponto de atenção antes de começar

Você pediu "migrações aditivas ainda não aplicadas ao compartilhado". No fluxo
normal da plataforma, gravar uma migração e aplicá-la ao banco compartilhado é o
mesmo ato — não dá para versionar uma migração sem aplicá-la.

Proposta: as mudanças de banco desta rodada ficam em **`db/pendentes/*.sql`**,
fora da pasta oficial de migrações. O ambiente isolado passa a aplicar a pasta
oficial **e depois** a pasta pendente, de modo que tudo é validado localmente.
Só numa rodada futura, com sua autorização, cada arquivo é promovido a migração
oficial (aí sim aplicado ao compartilhado), sem edição do conteúdo já validado.

## Entrega em fases

### Fase 1 — Fundação de dados (SQL pendente + testes isolados)

1. **Preços versionados**: vigência coerente, moeda, faixa de percentual,
   proibição de duas regras/preços vigentes conflitantes, histórico aprovado
   imutável, encerramento por nova versão, criador/aprovador/fundamento,
   distinção informado × calculado × aprovado, precisão e arredondamento,
   tabela de snapshot de preço por operação. Valor fiscal nunca derivado do
   varejo; "um terço" continua sem percentual e sem efeito.
2. **Domínio do acerto** (nome próprio, sem confundir com baixa financeira):
   cabeçalho com ciclo, revisão, papéis separados, período, situação, hash,
   chave de repetição, política de preço, totais, conferente/aprovador, motivo
   de ajuste, acerto anterior e título futuro. Itens com remessa inicial,
   acréscimos, vendas comprovadas, devoluções, mantidas, garantia, perdas,
   divergências, saldo sob responsabilidade, fontes de comprovação e preço
   congelado. Estados completos, mas **só rascunho, conferência e bloqueio
   liberados**; aprovação, título, venda Lardan→consultora, preparação fiscal e
   cobrança ficam travados enquanto a regra comercial estiver aberta.
3. **Evidência de venda da consultora**: camada explícita, separada da venda
   Lardan→consultora, exigindo item, variante, consultora e ciclo; cancelamento
   e devolução por evento compensatório; sem efeito em estoque ou financeiro.
   O significado atual de `concluido` nos pedidos não é alterado.

### Fase 2 — Asaas preparado e desligado

4. **Endurecimento das estruturas**: empresa proprietária, ambiente,
   identificador externo da conta, referência ao segredo (nunca o segredo),
   versão de configuração, últimos sucesso/erro/ponto de sincronização,
   produção impossível de ativar, unicidade de evento por conta + ID, conta
   imutável após criação, identidade canônica `asaas:<conta>` na origem do
   título, verificações de valores, parcela/título/pessoa/ambiente coerentes,
   vínculo só por rotina oficial, histórico de mudanças e acesso mínimo a
   CPF/CNPJ, e-mail e payload.
5. **Adaptador desacoplado**: contrato no servidor + transporte simulado local
   (nenhuma chamada externa), URLs por lista fechada, autenticação por cabeçalho,
   criar/atualizar/cancelar cobrança presentes e desabilitados.
6. **Importação**: modo histórico (prévia, sugestão de vínculo, duplicidade,
   aprovação) e modo sincronização (título pela identidade canônica, sem segunda
   obrigação), paginação `limit`/`offset` com máximo 100, retomada e repetição
   sem efeito duplicado.
7. **Mapa de eventos** (17 tipos), confirmação ≠ recebimento, tarifa separada do
   bruto, estorno/chargeback pelo motor existente, evento desconhecido
   classificado sem travar a fila. **Webhook criado e inativo**, testável só
   localmente.

### Fase 3 — Cadeia fiscal auditável

8. Eventos, tentativas, fila, referências múltiplas entre documentos, snapshots
   de partes e itens, versão de leiaute, conteúdo enviado/recebido, hash do XML,
   rejeição, protocolo, ambiente, provedor, chave de repetição e correlação.
9. Escrita direta revogada; rotinas oficiais para preparar, validar, enfileirar,
   registrar retorno, autorizar, rejeitar, cancelar e consultar. Autorizado vira
   imutável; cancelamento é evento.
10. Integridade item ↔ origem (composição, acréscimo, retorno, venda comprovada,
    linha do acerto), sem faturar duas vezes e sem exceder a origem.
11. Máquina de estados fiscal completa e adaptador fiscal neutro simulado, com
    marca explícita de simulação.

### Fase 4 — Telas preparatórias e documentação

12. Telas administrativas somente de leitura e simulação: saúde, conta e
    ambiente, prévia de importação, vínculos pendentes, cobranças pendentes,
    duplicidades, eventos com erro, documentos em preparação, pendências
    fiscais, cadeia de documentos, origem dos itens, bloqueios do acerto e
    auditoria. Avisos fixos: simulação, sandbox não conectado, produção
    bloqueada, documento não emitido, cobrança não criada, regra comercial
    pendente. Nenhum botão de rede. **Sem publicar.**
13. Documentos novos (`ACERTO-PREPARACAO.md`, `ASAAS-ADAPTADOR.md`,
    `FISCAL-CADEIA.md`, `VALIDACAO-FINANCEIRO-FISCAL.md`) e atualização de
    `FINANCEIRO-ARQUITETURA.md`, `INTEGRACOES.md` e `roadmap.md`.

### Fase 5 — Testes no ambiente isolado

Baterias novas em `tests/isolado/` cobrindo as três listas que você detalhou
(Asaas, fiscal e acerto), somadas às 41 provas já existentes. Nenhuma escrita na
base compartilhada.

## Encerramento

Relatório separando implementado, testado, apenas simulado, pendente de decisão,
de credencial, de contador e de provedor, além do que não foi aplicado ao banco
compartilhado e do que não foi publicado.

# Preços, fiscal e Asaas — o que foi preparado (nada ativo)

Situação: **estrutura aplicada no banco, operação desligada**. Nenhuma API foi
conectada, nenhum documento foi emitido, nenhuma cobrança foi criada e nenhum
dado real foi importado.

## 1. Preços separados e regras versionadas

`pricing_policies` guarda regras com vigência, precisão, arredondamento,
responsável e fundamento. Um gatilho impede que uma regra entre em vigor sem
percentual, fundamento, início de vigência e responsável.

A proporção informada verbalmente ("notas em torno de um terço do varejo")
está registrada como **pendente**, sem percentual e sem efeito algum. 33%,
33,33% e um terço não foram tratados como equivalentes e nenhum deles foi
adotado.

`variant_price_points` separa quatro valores por peça, sem derivar um do outro:
custo, preço ao consumidor, preço efetivo Lardan→consultora e valor fiscal.

## 2. Fiscal preparado, emissão desligada

- `fiscal_settings`: interruptor único, desligado, sem provedor, sem emissor e
  sem ambiente.
- `fiscal_documents`: documento por operação — remessa, acréscimo, venda,
  retorno e devolução simbólica —, ligado à movimentação de origem, com
  referência ao documento anterior, chave, protocolo, XML e representação.
  Devolução simbólica nasce marcada como **sem movimento físico**.
- `fiscal_document_items`: itens ligados ao item da movimentação de origem, com
  campos de CFOP, regime e natureza **vazios** (nenhum foi escolhido).
- Gatilho: enquanto a emissão estiver desligada, nenhum documento sai de
  "preparação"; documento autorizado não volta atrás — o caminho é o
  cancelamento, que não é estorno financeiro nem retorno de estoque.
- `fiscal_pendencias` registra o que falta definir: emissor e UF, regime,
  CPF/CNPJ e inscrição estadual dos destinatários, natureza e CFOP de cada
  operação, a base do "um terço" e a escolha do provedor.

Retorno físico **não** cancela a remessa original. Um documento fiscal não cria
uma segunda venda nem um segundo recebível para o mesmo acerto. Romaneio
continua sendo romaneio.

## 3. Asaas preparado, desligado

- `asaas_accounts`: teste e produção separados, nenhuma conta nasce ativa, com
  data de corte e marcação de saldo inicial já tratado.
- `asaas_customers`: cliente externo com vínculo opcional à pessoa interna e
  estado de revisão (pendente, vinculado, ambíguo, ignorado). Nada é unido por
  nome automaticamente.
- `asaas_charges`: cobrança externa identificada por conta + ID externo (único),
  com valor, vencimento, parcelamento, situação, taxas, recebimento e datas de
  confirmação e disponibilidade, ligada a título/parcela internos. Um gatilho
  impede marcar como "vinculada" uma cobrança sem título ou parcela. Casos sem
  vínculo comprovado permanecem pendentes.
- `asaas_events`: fila persistente de eventos, ID externo único (dedupe),
  tentativas, erro e situação — base para webhook seguro e reprocessamento.
- `asaas_import_runs`: lotes com prévia e efetivação, página, cursor de
  retomada, importados, duplicados, falhas e relatório.

Nada é associado automaticamente a maletas. Lançamentos manuais continuam
válidos: o motor financeiro existente (pessoas, títulos, parcelas, liquidações,
alocações, estornos e razão) é o mesmo — não foi criado financeiro paralelo.

## 4. O que ainda não existe

- Adaptador de rede do Asaas e simulações locais (próxima etapa).
- Qualquer chamada a API fiscal. Sem credenciais, nada é simulado como
  autorizado.
- Regra do acerto: continua não definida; a conferência física não gera
  obrigação financeira.

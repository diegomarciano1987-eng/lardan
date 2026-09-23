# Dados fiscais da empresa — configuração preparatória

Registro somente. **Nenhum cadastro real foi alterado, nenhuma nota foi emitida, nenhum provedor foi escolhido.**
A prioridade da rodada continua sendo Asaas; este documento não amplia a implementação fiscal.

## 1. Dados informados pelo cliente (declaração, não verificados por documento)

| Campo | Valor informado |
| --- | --- |
| Razão social | TSM COMERCIO DE SEMIJOIAS LTDA |
| Nome fantasia | LARDAN SEMIJOIAS |
| CNPJ | 43.319.208/0001-80 |
| Inscrição estadual | 90908301-01 |
| Regime | Simples Nacional |
| Endereço | Avenida dos Estudantes, 1277 — Setor 1 |
| CEP | 86.200-055 |
| Município / UF | Ibiporã / PR |

## 2. Evidência atribuída ao PDF "Credenciamento.pdf"

Conteúdo **conforme relatado pelo cliente**: consulta de autorização de uso de sistemas da Receita/PR;
situação da autorização "Autorizado"; finalidades NF-e modelo 55 e NFC-e modelo 65; sistema
"JFLEX — SISTEMA ADMINISTRATIVO LARDAN", código 77066, situação "Credenciado".

Limitação: o arquivo **não está disponível no ambiente de trabalho** desta rodada; o conteúdo acima não foi
conferido diretamente. Deve ser anexado ao pacote de revisão para que a evidência fique verificável.

A autorização do JFLEX **não** autoriza automaticamente o novo sistema nem qualquer provedor futuro.

## 3. Situação no banco em uso (consulta somente leitura, 23/09/2026)

- `business_entities`: **nenhuma empresa cadastrada**. Não há entidade a atualizar; a proposta cria a
  entidade vinculando-a à pessoa existente, sem duplicar a pessoa.
- `parties`: existe **uma** pessoa com o CNPJ 43319208000180 — código LC-003419, tipo organização,
  nome "Tsm Comercio de Semijoias Ltda", **situação inativa**, papel **consultora**, importada da planilha
  de consultoras em 18/09/2026 (linha 1800), com 1 endereço.
- `fiscal_settings`: 1 linha, emissão desligada, sem provedor, sem emissor, ambiente "nenhum".

### Conflitos encontrados

1. **A própria empresa está cadastrada como consultora.** A linha da planilha de consultoras trouxe o CNPJ
   da Lardan. Decisão humana necessária: o papel de consultora é um erro de importação ou há uma
   consultora que usa o CNPJ da empresa?
2. **Inscrição estadual gravada no campo RG** ("9090830101", sem a pontuação informada). Não foi movida.
3. Razão social só em `display_name`, com caixa diferente da informada; `legal_name` vazio.
4. Endereço existente não foi comparado campo a campo com o informado; revisar antes de aplicar.

## 4. Proposta de atualização (não aplicada)

`db/pendentes/06-fiscal-emitente-proposta.sql` — pacote revisável, **fora das migrações automáticas**:
- localiza a pessoa pelo CNPJ canônico e **aborta** se houver zero ou mais de uma;
- cria a entidade empresarial ligada a essa pessoa somente se nenhuma entidade tiver o mesmo CNPJ;
- aponta `fiscal_settings.emitter_entity_id` para a entidade, **mantendo a emissão desligada** e sem provedor;
- não altera papel de consultora, RG, endereço nem situação da pessoa (dependem da decisão do item 3).

## 5. Pendências da futura emissão

- Situação do novo sistema/provedor perante a Receita/PR (credenciamento próprio).
- Responsável técnico e requisitos aplicáveis ao sistema emissor.
- Certificado digital e configuração segura, quando necessários (somente no servidor).
- Séries e numeração já utilizadas pelo JFLEX; última nota por série.
- Convivência ou migração entre emissores sem duplicidade de numeração.
- Tratamento das notas antigas ainda relacionadas a maletas abertas.
- Classificação fiscal de produtos e operações (NCM, CFOP, CST/CSOSN, CEST, alíquotas) — pelo contador.
- Valor comercial devido pela consultora no acerto.
- Significado do "um terço".

Nada disso foi presumido. O JFLEX não foi alterado e nenhuma cessação de uso foi solicitada.

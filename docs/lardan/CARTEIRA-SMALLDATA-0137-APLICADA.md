# Carteira SmallData — aplicação autorizada em 23/10/2026

Autorização: documento “Para o Lovable — 0137: aplicar a carteira pelo SmallData”, referente ao pacote 0136-2. Execução pelo cliente oficial na sessão Master de Diego. Nenhum representante histórico foi ligado manualmente; nenhuma interface publicada.

## 1. Conferência antes

| Código SmallData | Representante no histórico | Situação | Consultoras |
|---|---|---|---:|
|16|DANIEL DE FREITAS MACIEL (LOJA)|igual ao SmallData|7|
|16|DANIEL DE FREITAS MACIEL (LOJA)|vazio: será preenchido|1|
|1515|TATIANE SIMONELLI DE OLIVEIRA|cadastro sem papel Representante|1|
|3003|LOANNA GONÇALVES QUINA AZEVEDO|representante sem cadastro|97|
|3004|SUELI APARECIDA DE ALMEIDA|igual ao SmallData|22|
|3008|CLEVERSON FRANCK|igual ao SmallData|58|
|3009|MARCELO MARLOS DE OLIVEIRA|cadastro sem papel Representante|2.213|
|3010|GUILHERME AUGUSTO PELEGRINI DA SILVA|cadastro sem papel Representante|1.733|
|5673|DANIEL DE FREITAS MACIEL|diferente do SmallData: mantido|3|
|5673|DANIEL DE FREITAS MACIEL|igual ao SmallData|1.047|
|5673|DANIEL DE FREITAS MACIEL|vazio: será preenchido|44|
|5674|LARISSA REGINALDA DOS SANTOS|cadastro sem papel Representante|1|
|6512|KETLLIN DE SOUZA SILVA|representante sem cadastro|1|
|sem código|sem representante|consultora sem representante no SmallData|6|

Consulta de praças: **3.958 sem praça**, **1.276 com praça**.
Prévia autenticada: representante **45**, praça **3.617**, perfil_novo **0**, mais_de_um_representante **0**, aplicado **false**. As 45 consultoras propostas para representante pertencem a Daniel. A quantidade corresponde exatamente à prévia aprovada; não foi necessário interromper por divergência.

## 2. Aplicação

```json
{
  "lote": "cvs-20261023-154230-de45",
  "praca": 3617,
  "aplicado": true,
  "perfil_novo": 0,
  "representante": 45,
  "por_representante": [
    { "consultoras": 45, "representante": "Daniel de Freitas Maciel" }
  ],
  "reps_sem_cadastro": [],
  "mais_de_um_representante": 0
}
```

“Praça 3.617” significa vínculos de praça preenchidos em consultoras, não novas praças criadas. Sem alteração de papéis, sem criação de perfis e sem substituição de vínculos existentes.

## 3. Conferência depois

| Campo no log do lote | Registros |
|---|---:|
|representante|45|
|praça|3.617|
|total|3.662|

Praças: **339 ainda sem praça**, **4.895 com praça**.
Auditoria: **0 campos com valor anterior alterados**, **1 ator**, evento `consultoras.vinculo_smalldata` confirmado com o mesmo lote e quantidades.
Nova prévia autenticada: representante **0**, praça **0**, perfis **0**; nada pendente para repetição da mesma rotina. Os 339 sem praça não receberam atribuição inventada.
Desfazer disponível pela rotina oficial, mas **não executado**; depende de pedido de Diego. Interface **não publicada**.
# Importação industrial — LARDAN Cloud

Documento vivo do motor de importação de produtos e entradas de estoque.

## 1. Duas identidades separadas

| Conceito | Onde vive | O que guarda |
| --- | --- | --- |
| **Arquivo** | `import_files` | impressão digital SHA-256 (calculada no servidor), nome, tamanho, tipo, quantidade de linhas e colunas, cabeçalhos, versão do leitor, autor e data |
| **Execução** | `import_jobs` | o arquivo usado, modo, de-para, valores padrão, local, data, documento, motivo, simulação ou execução real, versão das regras, estado, checkpoint, motivo de cancelamento |

O navegador nunca decide a identidade: ele envia o conteúdo e o servidor
calcula o hash (`registrarArquivo`, em `src/lib/importacao/arquivo.functions.ts`).
O mesmo arquivo pode ter várias execuções — simulação, execução real,
execução com outro de-para e correção de linhas recusadas.

## 2. Estados

```
rascunho → recebendo → recebido → validando → pronto
                                     ↓            ↓
                                 simulando → simulado → (execução real)
                                     ↓
   processando ⇄ pausando/pausado → concluido | concluido_com_erros
                                     ↓
                                 falhou | cancelado
```

Transições inválidas são recusadas pelo próprio banco
(`import_state_can` + gatilho em `import_jobs`). Cancelar exige motivo escrito
e não desfaz o que já foi gravado — o que entrou continua registrado e auditado.

## 3. Concorrência

Cada bloco de processamento reserva as linhas com `FOR UPDATE SKIP LOCKED` e
grava um token de trabalhador com validade de 5 minutos. Se a aba fechar ou o
trabalhador morrer, a reserva expira e a retomada pega exatamente as linhas
que faltavam. Nenhuma transação fica aberta durante todo o lote.

## 4. Recepção segura

- Formatos: `.xlsx`, `.xls`, `.csv`, conferidos pelo conteúdo.
- Limites: 20 MB, 50.000 linhas, 120 colunas, 5.000 caracteres por célula.
- Fórmulas e macros nunca são executadas (`cellFormula: false`, leitura de valores).
- Só a primeira aba é lida; abas extras viram aviso visível.
- Colunas repetidas são renomeadas e avisadas.
- Todo valor é texto: SKU, EAN, código legado e zeros à esquerda são preservados.
- Exportação de recusadas neutraliza fórmulas (`=`, `+`, `-`, `@`) — sem CSV injection.

## 5. Identificação e efeitos

Ordem de identificação: SKU → código legado → código de barras. Divergência
entre códigos vira **conflito** e pede revisão manual — nunca sobrescreve.

Campos de produto (nome, descrição, categoria, coleção, fornecedor, material,
banho) e de variante (SKU, código legado, EAN, tamanho, cor, preço, custo,
quantidade) são separados. Categoria, coleção e fornecedor criados pela
importação nascem como rascunho, com nome normalizado (sem duplicar por acento,
caixa ou espaço) e nunca são publicados sozinhos.

Valores em reais (`R$ 1.299,90`, `1299,90`) viram centavos inteiros. Custo só é
gravado por quem tem permissão de custo. Preço ou custo negativo é recusado.

A importação **não publica** direto: quando a planilha pede publicação, ela
passa pela operação canônica `publish_products` e os impedimentos ficam
registrados na linha.

## 6. Modos

- **Somente cadastrar** — não movimenta estoque.
- **Cadastrar e dar entrada** — exige local ativo, data, documento e quantidade
  inteira não negativa; a entrada usa a operação canônica com chave de
  idempotência, então reenviar o mesmo lote não lança estoque duas vezes.
- **Simular** — grava só os efeitos previstos nas linhas, sem efeito comercial.
  Depois é possível promover a simulação a execução real; se a base mudou nesse
  intervalo, o sistema avisa.

## 7. Contadores

Todos os números da tela vêm de `import_job_counters`, calculado a partir das
linhas e dos efeitos registrados — nunca de somas soltas na aplicação.

## 8. Massa e provas

```
bun run massa:importacao:criar    # planilhas determinísticas em /tmp/lardan-importacao
bun run massa:importacao:limpar   # remove tudo com o prefixo IMPHOMOLOG
bun run test:importacao           # prova funcional (100 linhas, todos os cenários)
bun run test:importacao:carga     # 100, 1.000, 10.000 e 30.000 linhas
```

A massa é gerada por semente fixa: mesma escala ⇒ mesmo arquivo ⇒ mesma
impressão digital. Ela inclui, em posições fixas: peças novas, atualizações,
duplicadas dentro do arquivo, conflito de código, nome vazio, custo negativo,
quantidade negativa, quantidade zero, preços brasileiros com e sem símbolo,
códigos com zeros à esquerda, categorias, coleções, fornecedores e pedidos de
publicação.

## 9. Resultados medidos

Prova funcional (100 linhas): 92 efeitos de criação, 8 linhas recusadas
(as três recusas planejadas por bloco de 50), 0 duplicações, 0 movimentações
indevidas. Tabela por escala em `TESTES-E-EVIDENCIAS.md`.

## 10. Ainda não suportado

Download de imagem por endereço (URL) não é executado nesta versão: a linha é
aceita e recebe aviso explícito de que a imagem precisa ser enviada pela
biblioteca de mídia. Nenhuma requisição externa parte do servidor durante a
importação.

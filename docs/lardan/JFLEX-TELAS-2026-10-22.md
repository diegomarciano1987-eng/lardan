# Histórico JFLEX — telas e importação (22/10/2026)

## O que foi construído

A estrutura (migração 0112) já estava aplicada. Este pacote entrega as telas e
a importação, tudo usando a biblioteca `src/lib/historico-jflex.ts` e o parser
`src/lib/historico-jflex-csv.ts` do pacote recebido.

1. **Tela de importação** — `Configurações → Histórico JFLEX` (`/admin/historico-jflex`),
   **só Master**. Escolhe os 10 CSV de uma vez (`pracas.csv` … `acertos_praca.csv`),
   mostra linhas reconhecidas por arquivo, barra de progresso por bloco de 1.000
   linhas, para ao primeiro erro, relatório de vínculo automático e pendências.
   Os arquivos têm nome, CPF e endereço: ficam **só na memória do navegador** —
   nenhum log, nenhuma cópia, o agente nunca abriu os CSV reais.
2. **Fichas de pessoa** — aba **Histórico JFLEX** em Cobrança → ficha e em
   Cadastros → pessoa: resumo (maletas, giro, valor, ticket médio, perdidas,
   defeitos, praça), categorias com giro comparado à praça, top produtos,
   evolução por ano e maletas com as notas.
3. **Cockpit de remessas** — Remessas ganhou o seletor **Operação Lardan ↔
   Histórico JFLEX**. No histórico: busca (nº, praça, representante, consultora),
   situação, período, paginação e painel de detalhe com categorias e maletas.
4. **Rede** — nova aba **Histórico JFLEX** com ranking por praça, representante,
   cidade, UF, consultora ou categoria, filtros de período/praça/categoria e
   evolução mensal de valor e giro.
5. **App da consultora** — cartão **O que eu mais vendo** no início: peças
   vendidas, giro, categorias favoritas e as peças que mais saem. Escondido
   quando o cadastro dela não está ligado ao histórico.
6. **Montagem da maleta** — painel **Sugestão de composição (histórico JFLEX)**:
   total editável (padrão = `remessa_parametros.pecas_cliente_nova`, fallback 80),
   selo de confiança e explicação. Só mostra — não reserva peça nem muda estoque.
7. **Prontidão fiscal** — bloco recolhível **Roteiro observado no JFLEX**
   (remessa 5917, devolução 1918, venda 5114, perda 5927), somente leitura,
   não ativa nada.

Regras respeitadas: nenhuma tela grava em maletas, estoque, pedidos, financeiro
ou fiscal; nenhuma tela cria pessoa a partir do histórico; vínculo manual só
liga a cadastro existente, com auditoria e botão de desfazer; CPF sempre
mascarado; consultora vê só o próprio histórico.

## Provas executadas

- **Typecheck** (`tsgo --noEmit`): **0 erros**.
- **Suíte isolada** (banco recriado, dados sintéticos): **298 pass, 0 fail**,
  incluindo as baterias `historico-jflex.test.ts` (16 testes: permissão de
  importação, reimportação idempotente, vínculo sem criar pessoa, RLS, operação
  intocada, coerência do cockpit/rede/montagem e numeração de remessa) e
  `historico-csv.test.ts` (5 testes do parser).
- **Build**: OK (log de build em 20:49Z).
- Duas correções de bancada: `tests/isolado/base.ts` agora passa o banco
  explicitamente (o `bun` ignorava o banco da URL e conectava em `postgres`) e a
  bateria reproduz as quatro referências fiscais já cadastradas no projeto.

## Nenhum CSV importado

Os 10 CSV do pacote **não foram importados**: a tela de importação ainda não
existia. O importe é **sua** etapa, pelo preview, na tela acima (só Master).
Reimportar é seguro: o banco atualiza, não duplica.

## Pendências que seguem abertas

- Importar os 10 CSV (Diego, pela tela Master).
- Carga operacional das maletas na rua (ativação de consultoras e praça da
  remessa) — aguarda os arquivos de maletas; é separada do histórico.
- Publicação: **nada publicado**; mudanças só valem após publicar.

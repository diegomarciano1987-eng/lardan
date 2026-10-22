# Pacote 0123 — aplicação e provas

Conferência em 22/10/2026. Nada publicado.

## Resultado

- SQL aplicado pela ferramenta oficial como `drizzle/migrations/0123_acerto_com_remessa_aberta.sql`: comparação byte a byte idêntica ao ZIP.
- Journal e snapshot oficiais gerados; tipos regenerados pela mesma ferramenta.
- Confirmada no banco a retirada do filtro `r.status = 'fechada' AND m.fechamento IS NOT NULL` das quatro funções previstas.
- Confirmada a retirada da exclusão de cadastros internos em `legado_rede_mensal`.
- Ranking possui somente a assinatura nova de sete parâmetros, com `_data = 'acerto'` por padrão; permissão protegida preservada.
- Nenhuma coluna apagada e nenhum dado operacional alterado pela correção.

## Validação

- `bash tests/isolado/subir.sh`: banco local recriado do zero, 361 migrações e quatro arquivos pendentes aplicados; duas migrações de conteúdo ignoradas conforme configuração existente.
- `bun test tests/isolado`: **335 aprovados, zero falhas, 1.670 asserções, 29 arquivos**.
- Regressão nova confirma duas maletas acertadas (uma de remessa ainda aberta), inclusão em maio pela data do acerto e ausência em maio pela data de saída.
- Sinal automático de compilação: `build OK`, 22/10/2026 às 23:37:44 UTC. Não foi executado build ou typecheck manual; não há resultado separado de typecheck para declarar.
- Navegador autenticado como Master: `/admin/rede` → Histórico SmallData → ranking por praça; **30 linhas reais**, zero alertas no bloco. Captura anexada. Nenhuma gravação realizada.

## Comparação real, somente leitura

Há **22.977 acertos importados** nesta conferência — o estado anterior de “zero acertos” não é mais atual.

Comparação de novembro/2023 a outubro/2026, com junção completa entre os meses dos dois conjuntos: **36 meses, todos iguais, diferença zero em cada mês, nenhum mês sem correspondência**. Novembro e dezembro/2023 têm total zero em ambos os conjuntos.

Exemplos: fevereiro/2026 R$ 303.105,16; agosto/2026 R$ 271.290,19; setembro/2026 R$ 293.874,80; outubro/2026 R$ 182.353,34.

```sql
WITH bi AS (
  SELECT to_char(fechamento,'YYYY-MM') mes, sum(valor_venda_cents) v
  FROM public.legado_maletas
  WHERE tipo='remessa' AND fechamento IS NOT NULL GROUP BY 1
), sd AS (
  SELECT to_char(data,'YYYY-MM') mes, sum(valor_cents) v
  FROM public.legado_acertos_consultora WHERE tipo='remessa' GROUP BY 1
)
SELECT coalesce(sd.mes,bi.mes) mes, bi.v maletas_cents,
       sd.v acertos_cents, bi.v-sd.v diferenca_cents
FROM sd FULL JOIN bi USING(mes) ORDER BY 1;
```

## Diferenças de integração e limites

- SQL e leitura `rankingRede` entraram conforme o pacote. No teste novo, a asserção não nula `!` foi substituída por `?.`: uma linha ausente continua fazendo o teste falhar.
- A documentação foi ajustada para não afirmar uma prova antes de executá-la; resultado real registrado aqui. Adicionada regra técnica ao AGENTS.md.
- Uma suspeita inicial sobre o texto da função mensal foi descartada pela leitura da definição real: o trecho procurado existia e a alteração foi confirmada após aplicação.
- A captura verifica o ranking real; os quatro demais caminhos não foram todos exercitados em tela. A suíte fornecida adiciona regressão específica do ranking, não testes novos independentes para cada uma das outras funções.
- Mantido o SQL exato: o ranking livre não acrescenta filtro de cadastros internos; não confundir com a exclusão já existente no BI de consultoras.
- A correção do banco já vale para as leituras compartilhadas, inclusive as utilizadas pela versão publicada. O novo código da interface permanece sem publicação.
- Não é carga operacional das maletas na rua: peças na vitrine ainda dependem do arquivo analítico e da carga própria, fora do escopo desta correção.
# BI do histórico SmallData (migrações 0116 e 0117)

Tela: **Rede → Histórico SmallData** (`src/components/admin/historico/BiHistorico.tsx`), acima do ranking livre.
Rotinas: `legado_bi_*` (só equipe, via `legado_pode_ver`), biblioteca `src/lib/historico-bi.ts`.

## O que a tela mostra

| Bloco | Rotina | Para que serve |
| --- | --- | --- |
| Frases prontas | `legado_bi_insights` | O que salta aos olhos no recorte, com números |
| KPIs + período anterior | `legado_bi_painel.kpis/anterior` | Valor, giro, venda por maleta, % que voltou sem venda, venda por consultora |
| Valor e giro por mês | `legado_rede_mensal` | Evolução |
| Quanto cada maleta vende | `painel.distribuicao` | Faixas de % vendido (nada, até 5%, 5–10%…) |
| Top 10 consultoras | `legado_bi_top` | Geral ou por praça; por valor, peças, giro ou venda por maleta; ritmo das 3 últimas |
| Concentração | `painel.pareto` | Quanto da venda vem das 10/20/50% melhores |
| Jornada | `legado_bi_jornada.curva` | Giro e "pegou a próxima" da 1ª à 12ª maleta |
| Entram e saem | `legado_bi_jornada.trimestres` | Ativas, novas e que pararam por trimestre |
| Mix | `painel.mix` | % do envio × % da venda por categoria |
| Tamanho, dias na rua, sazonalidade | `painel.tamanho/dias_na_rua/sazonalidade` | Onde o giro muda |
| Praça × categoria | `legado_bi_praca_categoria` | Mapa de calor: onde cada categoria vende acima/abaixo da rede |
| Atenção agora | `legado_bi_alertas` | Zeraram 2 seguidas, em queda, boas que sumiram, estreantes fortes |
| Peças que mais vendem | `legado_bi_produtos` | Top 20 com tendência de 90 dias |
| Ano a ano | `painel.anos` | Comparação anual |

## Regras dos números

- Venda só existe em maleta **acertada**. Maleta sem acerto aparece à parte (`maletas_sem_acerto`) e o aviso diz que o valor do período é parcial; o giro continua confiável.
- Curvas por maleta (faixas, tamanho, dias na rua, sazonalidade) usam maletas com **10+ peças**: kit de complemento não distorce.
- Jornada conta "maleta" por **remessa** da consultora (kits da mesma remessa somados).
- "Parou" = sem maleta nova há mais de 120 dias da última emissão registrada.
- Cadastros internos do SmallData (LARDAN, maleta de fotos/design) ficam fora: coluna gerada `legado_consultoras.interna`.

## Correções (0116)

1. **Valor devolvido zerado**: 282 maletas (quase todas das remessas 857–874) vieram com peças devolvidas e valor devolvido = 0, e o valor vendido saía igual ao enviado: **R$ 1,6 mi a mais de venda (14% do total)**. O valor certo vem das categorias da própria maleta; gatilhos corrigem em qualquer ordem de importação e o que já está no banco.
2. **Cadastros criados pelo histórico** (0114/0115): entraram todos "ativo", sem praça e sem checar nome repetido. Agora:
   - `legado_cadastros_revisao()` (Master): contagens e possíveis duplicadas por nome (CPF mascarado);
   - `legado_cadastros_ajustar(_aplicar)` (Master, prévia por padrão): define a praça e inativa quem estava inativa no SmallData ou sem maleta há 12+ meses — **só em cadastro sem nenhuma operação no Lardan**;
   - a rotina de cadastro passou a fazer isso sozinha e a pular quem tem o mesmo nome de um cadastro existente.
3. Bancada isolada agora em **UTF-8** (era SQL_ASCII): acentos se comportam como no Supabase.

## Leitura do histórico real (carga sem dados pessoais, nov/2023 a out/2026)

Total: 27.197 maletas acertadas, 3.895 consultoras, 1,81 mi de peças enviadas, 126.918 vendidas (giro 7,0%), R$ 9,85 mi vendidos, R$ 362 por maleta (mediana R$ 163).


- **32% das maletas acertadas voltaram sem nenhuma peça vendida.**
- **20% das consultoras fazem 71% da venda**; 10% fazem 51%; metade faz 94,5%.
- **1ª maleta gira 9,4%**; da 2ª à 6ª, 6,8%. 916 zeraram a 1ª; 77% delas ainda receberam a 2ª, e ela gira 3,3%.
- 47% das consultoras que pararam, pararam até a 3ª maleta.
- 843 consultoras zeraram as duas últimas maletas.
- Giro caindo: 8,3% (2024) → 6,7% (2025) → 5,8% (2026); venda média por maleta de R$ 426 → R$ 346 → R$ 305 (2026 ainda com maletas na rua).
- Mix: brinco é 63,4% do envio e 60,5% da venda (giro 6,7%); pulseira 9,5% do envio e 11,4% da venda (8,4%); anel 7,8%; tornozeleira 9,0%; piercing 3,4% e broche 1,6%.
- Novembro é o melhor mês (giro 8,8%).
- Maleta acertada entre 35 e 64 dias gira 7,6%; acima de 65 dias, 5,4%.
- Praças: Teodoro Sampaio 8,8–9,0% de giro; Ventania, Ponta Grossa e Votuporanga perto de 5,6%.

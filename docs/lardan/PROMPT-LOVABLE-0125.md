# Para o Lovable — 0125: venda do mês igual ao relatório de acertos do SmallData

Aplique exatamente como está. Não renomeie funções e não mude mensagens. Não publique a interface sem a minha aprovação.

## Por que

O Diego comparou o relatório "Total de acertos" do SmallData com o BI: fevereiro e agosto/2026 batiam, e os outros meses ficavam de R$ 500 a R$ 22 mil fora.

A causa: o valor e a data do acerto vinham do FECHAMENTO da maleta (T_REM_CLIENTE). O SmallData soma pela COBRANÇA do acerto ("Vlr. Bruto" na "Data Cob."). Os dois coincidem na maioria dos acertos, mas não em todos: cobrança lançada em outro dia ou mês, cobrança de atraso, maleta fechada sem cobrança.

Com a regra nova, os 34 meses (jan/2024 a out/2026) batem centavo por centavo com o relatório na bancada, com os dados reais.

## 1. Migração 0125_venda_pela_cobranca.sql

Arquivo: drizzle/migrations (pode renumerar; o conteúdo é o mesmo).

- Não apaga nada e não remove coluna. Pode rodar duas vezes.
- legado_acertos_consultora ganha a coluna fonte. As linhas atuais ficam 'remessa_cliente'; tudo o que for importado depois fica 'cobranca'.
- legado_maletas ganha fechamento_smalldata (a data original guardada) e sem_cobranca.
- Assim que houver acerto de fonte 'cobranca', só ele vale:
  - a maleta recebe o valor cobrado;
  - a data da cobrança vira a data do acerto;
  - maleta fechada sem cobrança fica com venda zero (sem_cobranca = true).
- Os totais do BI (cartões e venda por ano) passam a incluir as contas internas da Lardan, como o SmallData. Rankings, jornada e alertas continuam sem elas.
- Antes da importação do arquivo novo, nada muda nos números.

Testes: tests/isolado/bi-historico.test.ts (duas expectativas ajustadas à regra nova e uma seção 9 nova).
Esperado: `bash tests/isolado/subir.sh && bun test tests/isolado` → 354 pass, 0 fail.

## 2. Importação (o Diego faz pela tela)

Em Configurações → Histórico SmallData, como Master, importar só o arquivo acertos_consultora.csv novo (19.464 linhas, tirado do relatório de cobrança). Ele passa a valer no lugar do anterior pela regra acima; não é preciso apagar nada.

## 3. Prova depois da importação

Rode as consultas abaixo e me devolva o resultado inteiro:

```sql
select fonte, count(*) from public.legado_acertos_consultora group by 1;   -- cobranca = 19464

select count(*) filter (where sem_cobranca) as sem_cobranca,
       count(*) filter (where fechamento_smalldata is not null) as data_da_cobranca_diferente
  from public.legado_maletas;

with esperado(mes, centavos) as (values
  ('2024-01', 24103003),
  ('2024-02', 15157780),
  ('2024-03', 19452985),
  ('2024-04', 20666334),
  ('2024-05', 22275223),
  ('2024-06', 24048783),
  ('2024-07', 27402032),
  ('2024-08', 21996421),
  ('2024-09', 29848608),
  ('2024-10', 36366357),
  ('2024-11', 32242946),
  ('2024-12', 24407104),
  ('2025-01', 48467761),
  ('2025-02', 35001772),
  ('2025-03', 29271113),
  ('2025-04', 31845687),
  ('2025-05', 36686947),
  ('2025-06', 33244678),
  ('2025-07', 37421384),
  ('2025-08', 31589615),
  ('2025-09', 35550065),
  ('2025-10', 29517800),
  ('2025-11', 30909566),
  ('2025-12', 22116288),
  ('2026-01', 35927374),
  ('2026-02', 30310516),
  ('2026-03', 28853459),
  ('2026-04', 21753126),
  ('2026-05', 26324220),
  ('2026-06', 30556544),
  ('2026-07', 26119669),
  ('2026-08', 27129019),
  ('2026-09', 29475763),
  ('2026-10', 17160339)
), lardan as (
  select to_char(m.fechamento, 'YYYY-MM') mes, sum(m.valor_venda_cents) centavos
    from public.legado_maletas m join public.legado_remessas r on r.numero = m.remessa
   where m.tipo = 'remessa' and m.fechamento is not null
   group by 1
)
select e.mes, e.centavos / 100.0 as smalldata, coalesce(l.centavos, 0) / 100.0 as lardan,
       (coalesce(l.centavos, 0) - e.centavos) / 100.0 as diferenca
  from esperado e left join lardan l using (mes)
 order by 1;
```

A coluna diferenca tem que dar 0,00 nos 34 meses. Se algum mês não der, pare e me mande a linha.

Depois, abra Inteligência de rede → Histórico SmallData como Master e confira na tela março/2026 (R$ 288.534,59) e julho/2026 (R$ 261.196,69).

/**
 * 0310 — Previsibilidade: previsão de venda (R$ e peças), paradas e novas pelo histórico.
 * Banco ISOLADO; histórico sintético do SmallData com giro conhecido por consultora.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const base = 9_300_000 + Math.floor(Math.random() * 50_000);
const REM = 9_300_000 + Math.floor(Math.random() * 50_000);
let master: Conta, cons: Conta;

const tz = "America/Sao_Paulo";
const hoje = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()) + "T12:00:00Z");
const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1, 12));
const dia = (d: Date, n: number) => new Date(d.getTime() + n * 864e5).toISOString().slice(0, 10);
const mesAtras = (n: number, dd = 5) => new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() - n, dd, 12));

// 40 consultoras: 1–30 constantes (giro 4%..12%, pelo código), 31–40 param depois da 2ª maleta.
const ENV = 100_000; // R$ 1.000 por maleta
const PECAS = 100;

beforeAll(async () => {
  master = await criarConta({ nome: `prev-master-${base}`, papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `prev-cons-${base}`, papeis: ["consultora"], comParty: true });
  const giroSql = `(0.04 + (c % 5) * 0.02)`;
  await adm.unsafe(`insert into public.legado_consultoras (codcli, nome) select $1 + c, 'Prev ISO ' || c from generate_series(1, 40) c on conflict (codcli) do nothing`, [base]);
  // 13 remessas fechadas (uma por mês), acerto 45 dias depois da saída, fechada 2 dias depois do vencimento.
  // Consultoras 1–30 recebem em todas; 31–40 param depois da 2ª maleta.
  await adm.unsafe(`
    with r as (select i, ($2::date - make_interval(months => i))::date + 4 as em from generate_series(2, 14) i),
    ins_r as (insert into public.legado_remessas (numero, emissao, vencimento, status) select $3 + i, em, em + 45, 'fechada' from r returning numero),
    m as (select r.i, r.em, c from r cross join generate_series(1, 40) c where c <= 30 or (14 - r.i + 1) <= 2)
    insert into public.legado_acertos_consultora (remessa, codcli, valor_cents, data)
    select $3 + m.i, $1 + m.c, round($4 * ${giroSql.replace(/c /g, "m.c ")}), m.em + 47 from m`, [base, dia(ini, 0), REM, ENV]);
  await adm.unsafe(`
    with r as (select i, ($2::date - make_interval(months => i))::date + 4 as em from generate_series(2, 14) i),
    m as (select r.i, r.em, c from r cross join generate_series(1, 40) c where c <= 30 or (14 - r.i + 1) <= 2)
    insert into public.legado_maletas (remessa, codcli, kit, tipo, emissao, fechamento, pecas_enviadas, pecas_devolvidas, valor_enviado_cents, valor_devolvido_cents, valor_acerto_cents)
    select $3 + m.i, $1 + m.c, 1, 'remessa', m.em, m.em + 47, $5, $5 - round($5 * ${giroSql.replace(/c /g, "m.c ")}), $4,
           $4 - round($4 * ${giroSql.replace(/c /g, "m.c ")}), round($4 * ${giroSql.replace(/c /g, "m.c ")}) from m`, [base, dia(ini, 0), REM, ENV, PECAS]);
  // remessa aberta com acerto NESTE mês (dia 20): 30 maletas na rua
  const emAberta = mesAtras(1);
  await adm.unsafe(`insert into public.legado_remessas (numero, emissao, vencimento, status) values ($1,$2,$3,'aberta')`, [REM + 1, dia(emAberta, 0), dia(ini, 19)]);
  await adm.unsafe(`insert into public.legado_maletas (remessa, codcli, kit, tipo, emissao, fechamento, pecas_enviadas, valor_enviado_cents)
                    select $1, $2 + c, 1, 'remessa', $3, NULL, $4, $5 from generate_series(1, 30) c`, [REM + 1, base, dia(emAberta, 0), PECAS, ENV]);
}, 30_000);

afterAll(async () => {
  await adm.unsafe(`delete from public.legado_acertos_consultora where codcli between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_maletas where codcli between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_remessas where numero between $1 and $2`, [REM, REM + 99]);
  await adm.unsafe(`delete from public.legado_consultoras where codcli between $1 and $2`, [base, base + 99]);
});

type Painel = {
  venda: { realizado_cents: number; pipeline_cents: number; previsto_cents: number; faixa_min_cents: number; faixa_max_cents: number;
    maletas_previstas: number; giro_rede_pct: number; pontualidade_pct: number };
  pecas: { previsto: number; pipeline: number };
  paradas: { acertam_sem_proxima: number; previstas: number; taxas: { faixa: string; giro: string; volta_pct: number; maletas: number }[];
    risco: { nome: string; chance_parar_pct: number }[] };
  novas: { ate_agora: number; previstas: number };
  serie: { mes: string; vendido_cents: number }[];
};

describe("0310 previsibilidade", () => {
  test("só equipe com financeiro/rede; consultora não vê", async () => {
    expect((await rpc(cons, "previsibilidade_painel", {})).ok).toBe(false);
    expect((await rpc(null, "previsibilidade_painel", {})).ok).toBe(false);
  });

  test("venda do mês: maletas que acertam no mês × giro de cada consultora × pontualidade", async () => {
    const r = await rpc<Painel>(master, "previsibilidade_painel", {});
    expect(r.erro).toBeNull();
    const v = r.dados.venda;
    expect(v.maletas_previstas).toBeGreaterThanOrEqual(30);
    // as 30 maletas: giro médio das 30 ≈ 8% de R$ 1.000 = R$ 2.400 no total (sem contar o resto da bancada)
    expect(Number(v.pipeline_cents)).toBeGreaterThan(30 * ENV * 0.04 * 0.5);
    expect(Number(v.previsto_cents)).toBeGreaterThanOrEqual(Number(v.realizado_cents));
    expect(Number(v.faixa_min_cents)).toBeLessThanOrEqual(Number(v.previsto_cents));
    expect(Number(v.faixa_max_cents)).toBeGreaterThanOrEqual(Number(v.previsto_cents));
    expect(Number(r.dados.pecas.pipeline)).toBeGreaterThan(0);
    expect(r.dados.serie.length).toBeGreaterThan(0);
  });

  test("paradas: quem para depois da 2ª maleta aparece nas taxas de volta", async () => {
    const r = await rpc<Painel>(master, "previsibilidade_painel", {});
    const t = r.dados.paradas.taxas;
    expect(t.length).toBeGreaterThan(0);
    const media = (f: string) => {
      const x = t.filter((y) => y.faixa === f);
      const n = x.reduce((s, y) => s + y.maletas, 0);
      return n ? x.reduce((s, y) => s + y.volta_pct * y.maletas, 0) / n : null;
    };
    const quatro = media("4ª ou mais");
    const duas = media("2ª–3ª");
    if (quatro !== null && duas !== null) expect(quatro).toBeGreaterThan(duas);
    // todas as 30 acertam no mês e ainda não têm a próxima maleta
    expect(r.dados.paradas.acertam_sem_proxima).toBeGreaterThanOrEqual(30);
    expect(Number(r.dados.paradas.previstas)).toBeGreaterThanOrEqual(0);
  });
});

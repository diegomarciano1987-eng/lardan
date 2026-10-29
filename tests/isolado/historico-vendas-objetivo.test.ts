/**
 * 0180 — Histórico de vendas e Objetivo de venda (regras aprovadas em 29/10/2026).
 * Banco ISOLADO, dados sintéticos. Referência fixa 10/11/2026 → entram os meses fechados até outubro/2026.
 * 0183: objetivo = 3 melhores meses de sempre (ou os que tiver) + 15%.
 * Faixas da bancada: 0 → 20% · 200 → 25% · 500 → 30% · 650 → 35% · 1.200 → 40%.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, VISITANTE, type Conta } from "./base";

const base = 700000 + Math.floor(Math.random() * 90000);
let seq = 0;
const REF = "2026-11-10";
let minimoAntes: string | null = null;
let master: Conta, cobranca: Conta;

type Obj = { tipo: "meta" | "objetivo"; objetivo_cents: number; media_cents?: number; piso: boolean; meses_com_acerto: number;
  comissao_objetivo_cents: number; meses: { mes: string; acerto: boolean; vendido_cents: number | null; comissao_cents: number | null; estimada: boolean }[] };

async function consultora(nome: string) {
  const c = await criarConta({ nome: `hv-${nome}-${base}`, papeis: ["consultora"], comParty: true });
  const cod = base + ++seq;
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
  await adm.unsafe(`insert into public.party_codigos_legados (party_id, sistema, codigo) values ($1,'cliente',$2)`, [c.partyId, String(cod)]);
  return { ...c, cod };
}
/** acerto do sistema antigo; comissao = null → sem cobrança registrada */
async function acerto(cod: number, remessa: number, data: string, reais: number, comissao: number | null = null, tipo = "remessa") {
  const cents = Math.round(reais * 100);
  await adm.unsafe(`insert into public.legado_acertos_consultora (remessa, codcli, valor_cents, data, tipo) values ($1,$2,$3,$4,$5)`, [remessa, cod, cents, data, tipo]);
  if (comissao != null)
    await adm.unsafe(`insert into public.legado_cobrancas (chave, codcli, tipo, data, remessa, venda_bruta_cents, venda_liquida_cents, total_pago_cents)
                      values ($1,$2,1,$3,$4,$5,$6,$6)`, [`HV${cod}-${remessa}`, cod, data, remessa, cents, cents - Math.round(comissao * 100)]);
}
const calc = async (party: string, ref = REF) =>
  ((await adm.unsafe(`select public.consultora_objetivo_calc($1, $2::date) o`, [party, ref])) as { o: Obj }[])[0]!.o;

beforeAll(async () => {
  master = await criarConta({ nome: `hv-master-${base}`, papeis: ["master"], comParty: true });
  cobranca = await criarConta({ nome: `hv-cob-${base}`, papeis: ["cobranca"], comParty: true });
  minimoAntes = ((await adm.unsafe(`select proxima_maleta_minimo_cents::text m from public.pedido_config limit 1`)) as { m: string | null }[])[0]?.m ?? null;
  await adm.unsafe(`update public.pedido_config set proxima_maleta_minimo_cents = 65000 where true`);
});
afterAll(async () => {
  await adm.unsafe(`update public.pedido_config set proxima_maleta_minimo_cents = $1 where true`, [minimoAntes]);
  await adm.unsafe(`delete from public.legado_cobrancas where chave like 'HV%'`);
  await adm.unsafe(`delete from public.legado_acertos_consultora where codcli > $1 and codcli <= $2`, [base, base + 100]);
});

describe("objetivo de venda (0183: 3 melhores meses de sempre + 15%)", () => {
  test("3 melhores meses de todo o histórico: 1.320, 1.230 e 1.140 → média 1.230 + 15% = R$ 1.414,50 → R$ 1.420,00 (40%)", async () => {
    const c = await consultora("tres");
    await acerto(c.cod, base * 10 + 1, "2025-12-12", 1320, 396);
    await acerto(c.cod, base * 10 + 2, "2026-02-12", 1230, 369);
    await acerto(c.cod, base * 10 + 3, "2026-03-12", 1140, 342);
    await acerto(c.cod, base * 10 + 4, "2026-08-12", 900, 270);
    await acerto(c.cod, base * 10 + 5, "2026-10-12", 800, 240);
    await acerto(c.cod, base * 10 + 6, "2026-11-05", 5000, 2000);   // mês da referência ainda aberto: não entra
    const o = await calc(c.partyId!);
    expect(o).toMatchObject({ tipo: "objetivo", meses_com_acerto: 3, media_cents: 123000, objetivo_cents: 142000, piso: false, comissao_objetivo_cents: 56800 });
    expect(o.meses.map((m) => [m.mes, m.vendido_cents, m.comissao_cents])).toEqual([["2025-12", 132000, 39600], ["2026-02", 123000, 36900], ["2026-03", 114000, 34200]]);
  });

  test("menos de 3 meses: usa os que tiver (1.000 e 600 → R$ 920,00)", async () => {
    const c = await consultora("dois");
    await acerto(c.cod, base * 10 + 11, "2026-08-03", 1000, 300);
    await acerto(c.cod, base * 10 + 12, "2026-10-28", 600, 180);
    const o = await calc(c.partyId!);
    expect(o).toMatchObject({ tipo: "objetivo", meses_com_acerto: 2, objetivo_cents: 92000 });
    expect(o.meses.map((m) => m.mes)).toEqual(["2026-08", "2026-10"]);
  });

  test("vários acertos no mesmo mês somam como um mês (400 + 500 = 900; com 700 → média 800 → R$ 920,00)", async () => {
    const c = await consultora("mesmo-mes");
    await acerto(c.cod, base * 10 + 15, "2026-09-02", 400, 100);
    await acerto(c.cod, base * 10 + 16, "2026-09-25", 500, 150);
    await acerto(c.cod, base * 10 + 17, "2026-06-10", 700, 210);
    expect(await calc(c.partyId!)).toMatchObject({ meses_com_acerto: 2, media_cents: 80000, objetivo_cents: 92000 });
  });

  test("1 mês de R$ 500 → R$ 575 → R$ 580 → piso de R$ 650,00", async () => {
    const c = await consultora("um");
    await acerto(c.cod, base * 10 + 21, "2026-09-15", 500, 150);
    expect(await calc(c.partyId!)).toMatchObject({ tipo: "objetivo", objetivo_cents: 65000, piso: true, comissao_objetivo_cents: 22750 });
  });

  test("arredonda sempre para cima na dezena: R$ 780,30 × 1,15 = R$ 897,35 → R$ 900,00", async () => {
    const c = await consultora("arred");
    await acerto(c.cod, base * 10 + 31, "2026-10-01", 780.3, 234.09);
    expect((await calc(c.partyId!)).objetivo_cents).toBe(90000);
  });

  test("acerto com venda zero conta como R$ 0 quando está entre os meses usados (900 e 0 → 450 → piso)", async () => {
    const c = await consultora("zero");
    await acerto(c.cod, base * 10 + 41, "2026-08-20", 900, 270);
    await acerto(c.cod, base * 10 + 42, "2026-09-20", 0, 0);
    expect(await calc(c.partyId!)).toMatchObject({ meses_com_acerto: 2, media_cents: 45000, objetivo_cents: 65000, piso: true });
  });

  test("sem nenhum acerto: só a meta mínima; parada com histórico usa os melhores meses; perdida não é venda", async () => {
    const nova = await consultora("nova");
    expect(await calc(nova.partyId!)).toMatchObject({ tipo: "meta", objetivo_cents: 65000, meses_com_acerto: 0 });
    const parada = await consultora("parada");
    await acerto(parada.cod, base * 10 + 51, "2025-05-10", 2000, 800);
    await acerto(parada.cod, base * 10 + 52, "2026-09-10", 400, null, "perdida");
    expect(await calc(parada.partyId!)).toMatchObject({ tipo: "objetivo", meses_com_acerto: 1, objetivo_cents: 230000 });
  });

  test("comissão: a recebida quando existe; sem cobrança, estimada pelas faixas de hoje", async () => {
    const c = await consultora("estim");
    await acerto(c.cod, base * 10 + 61, "2026-08-05", 1000, 250);       // recebeu 25%, não os 35% de hoje
    await acerto(c.cod, base * 10 + 62, "2026-09-05", 400, null);       // sem cobrança → 25% de 400 (faixa de R$ 200)
    const o = await calc(c.partyId!);
    expect(o.meses[0]).toMatchObject({ comissao_cents: 25000, estimada: false });
    expect(o.meses[1]).toMatchObject({ comissao_cents: 10000, estimada: true });
  });
});

describe("Lardan + sistema antigo, gravado na maleta e no PDF", () => {
  let cons: Awaited<ReturnType<typeof consultora>>, ciclo = "", remNumero = 0, remId = "";

  beforeAll(async () => {
    cons = await consultora("lardan");
    const deposito = await criarDeposito(`hv-${base}`);
    const praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça HV ${base}`])).linhas[0]!.id;
    await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [cons.partyId, praca]);
    const v = await criarVariante(`hv-${base}`, 10000);
    await porEstoque(v, deposito, 20);
    const rem = (await rpc<{ id: string; numero: number }>(master, "remessa_criar", { _praca: praca, _deposito: deposito })).dados;
    remId = rem.id;
    remNumero = Number(((await adm.unsafe(`select numero from public.remessas where id=$1`, [remId])) as { numero: number }[])[0]!.numero);
    // acerto Lardan fechado em outubro (R$ 1.000, comissão 300) da MESMA remessa que também veio do sistema antigo
    await adm.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(`insert into public.kit_pre_baixas (cycle_id, consultora_party_id, remessa_id, status, total_vendido_cents, vendido_final_cents, comissao_cents, fechada_em)
                       values (gen_random_uuid(), $1, $2, 'encerrada', 100000, 100000, 30000, '2026-10-15 15:00-03')`, [cons.partyId, remId]);
    });
    await acerto(cons.cod, remNumero, "2026-10-15", 999.99, 300);   // a mesma remessa no sistema antigo: não pode contar
    await acerto(cons.cod, base * 10 + 71, "2026-09-10", 600, 180);
    // maleta nova da consultora, ainda em montagem
    const m = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remId, _consultora: cons.partyId });
    ciclo = m.dados.cycle_id;
    await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: v, _qty: 5 });
  });
  afterAll(async () => {
    await adm.begin(async (tx) => { await tx.unsafe(`set local session_replication_role = replica`); await tx.unsafe(`delete from public.kit_pre_baixas where consultora_party_id=$1`, [cons.partyId]); });
  });

  test("a mesma remessa nos dois sistemas conta uma vez (vale a Lardan)", async () => {
    const o = await calc(cons.partyId!);
    expect(o.meses.map((m) => m.vendido_cents)).toEqual([60000, 100000]);
    expect(o).toMatchObject({ meses_com_acerto: 2, objetivo_cents: 92000 });
  });

  test("objetivo fica gravado na conferência e não muda com acerto novo", async () => {
    const antes = ((await adm.unsafe(`select objetivo_memoria from public.kit_cycles where id=$1`, [ciclo])) as { objetivo_memoria: unknown }[])[0]!.objetivo_memoria;
    expect(antes).toBeNull();
    const r = await rpc(master, "kit_conferir", { _cycle: ciclo, _note: null });
    expect(r.erro).toBeNull();
    const g = ((await adm.unsafe(`select objetivo_cents, objetivo_memoria->>'tipo' tipo from public.kit_cycles where id=$1`, [ciclo])) as { objetivo_cents: string; tipo: string }[])[0]!;
    expect(g.tipo).toBeTruthy();
    // acerto enorme depois da conferência: a maleta continua com o mesmo objetivo
    await acerto(cons.cod, base * 10 + 72, new Date().toISOString().slice(0, 10), 9000, 3600);
    const pedido = await rpc<{ objetivo: Obj }>(master, "kit_pedido_dados", { _cycle: ciclo });
    expect(pedido.erro).toBeNull();
    expect(String(pedido.dados.objetivo.objetivo_cents)).toBe(String(g.objetivo_cents));
    await rpc(master, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
    const depois = ((await adm.unsafe(`select objetivo_cents::text o from public.kit_cycles where id=$1`, [ciclo])) as { o: string }[])[0]!.o;
    expect(depois).toBe(String(g.objetivo_cents));
  });

  test("histórico: a consultora vê só o dela; a equipe com permissão vê; outros não", async () => {
    const h = await rpc<{ resumo: { vendido_cents: number; acertos: number }; meses: { mes: string; vendido_cents: number; maletas: unknown[] }[]; objetivo_da_maleta: boolean }>(cons, "consultora_historico_vendas");
    expect(h.erro).toBeNull();
    // outubro: acerto Lardan R$ 1.000 + o acerto de R$ 9.000 lançado hoje (29/10) no teste anterior
    expect(h.dados.meses.find((m) => m.mes === new Date().toISOString().slice(0, 7))!.vendido_cents).toBeGreaterThanOrEqual(100000);
    expect(h.dados.resumo.vendido_cents).toBe(100000 + 60000 + 900000);
    expect(h.dados.objetivo_da_maleta).toBe(true);
    const outra = await consultora("outra");
    const h2 = await rpc<{ resumo: { acertos: number } }>(outra, "consultora_historico_vendas");
    expect(h2.dados.resumo.acertos).toBe(0);
    expect((await rpc(VISITANTE, "consultora_historico_vendas")).ok).toBe(false);
    expect((await rpc(cons, "consultora_historico_vendas_equipe", { _party: outra.partyId })).ok).toBe(false);
    expect((await rpc(cobranca, "consultora_historico_vendas_equipe", { _party: cons.partyId })).ok).toBe(true);
    for (const fn of ["consultora_objetivo_calc", "consultora_acertos_vendas", "historico_vendas_de", "comissao_pelas_faixas", "kit_cycle_objetivo"]) {
      const x = (await adm.unsafe(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [fn])) as { x: boolean }[];
      expect(`${fn}:${x[0]!.x}`).toBe(`${fn}:false`);
    }
  });
});

describe("card do objetivo no PDF do pedido", () => {
  test("nova: Meta mínima com o texto configurado; veterana: 3 meses + Objetivo; sem objetivo: nada", async () => {
    const { cardObjetivo, mesCurto } = await import("../../src/lib/pedido-consignacao");
    expect(mesCurto("2026-08")).toBe("Ago/26");
    const meta = cardObjetivo({ tipo: "meta", objetivo_cents: 65000, piso: true, meses_com_acerto: 0, comissao_objetivo_cents: 22750, meses: [] }, "Venda **pelo menos** isso");
    expect(meta).toContain("Meta mínima para a próxima maleta");
    expect(meta).toContain("R$ 650,00");
    expect(meta).toContain("<strong>pelo menos</strong>");
    const vet = cardObjetivo({ tipo: "objetivo", objetivo_cents: 92000, piso: false, meses_com_acerto: 2, comissao_objetivo_cents: 32200, percentual_objetivo: 35,
      meses: [{ mes: "2026-07", acerto: true, vendido_cents: 100000, comissao_cents: 30000, estimada: false },
              { mes: "2026-08", acerto: false, vendido_cents: null, comissao_cents: null, estimada: false },
              { mes: "2026-09", acerto: true, vendido_cents: 60000, comissao_cents: 15000, estimada: true }] });
    for (const t of ["Jul/26", "R$ 1.000,00", "sem acerto", "(estimada)", "Objetivo de venda", "R$ 920,00", "R$ 322,00", "média dos seus 2 melhores meses + 15%"]) expect(vet).toContain(t);
    expect(cardObjetivo(null)).toBe("");
    expect(cardObjetivo({ tipo: "meta", objetivo_cents: null, piso: true, meses_com_acerto: 0, comissao_objetivo_cents: null, meses: [] })).toBe("");
  });
});

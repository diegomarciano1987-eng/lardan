/**
 * 0408 — Plano de melhorias do Daniel, rodada 1. Banco ISOLADO, dados sintéticos.
 *  1. Carteira vencida: o painel dá o mesmo saldo e as mesmas devedoras da Cobrança; faixas somam o vencido.
 *  2. Estoque: "unidades" só soma saldo positivo; o negativo aparece como "faltam contar".
 *  3. Régua: a etapa nova substitui a anterior aberta; reorganizar a fila joga as atrasadas para dias úteis
 *     sem mexer em follow-up de pessoa.
 *  4. Trocas: filtro de paradas há 30 dias e praça preenchida pelo cadastro.
 *  5. Site e cadastros: "sem descrição" contado; lista de incompletos com o que falta.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const um = async <T>(sql: string, p: unknown[] = []) => { const r = (await adm.unsafe(sql, p)) as T[]; if (!r[0]) throw new Error("Cenário não criado"); return r[0]; };
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const dia = (n: number) => { const d = new Date(`${hojeSP()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

let master: Conta, cob: Conta, fin: Conta, consultora: Conta, qual: Conta;
let emp: string, devedora: string;

async function pessoa(nome: string, doc: string | null = null) {
  return (await um<{ id: string }>(`insert into parties(kind, display_name, legal_name, code, doc_digits) values ('pessoa',$1,$1,$2,$3) returning id`,
    [nome, `PD${marca}${Math.floor(Math.random() * 1e6)}`, doc])).id;
}
async function parcela(party: string, venc: string, cents: number) {
  const t = await um<{ id: string }>(`insert into financial_titles(party_id, direction, descricao, emissao, competencia, valor_cents, origem, status, business_entity_id)
     values ($1,'receivable','plano ${marca}', $2, $2, $3, 'manual', 'ativo', $4) returning id`, [party, venc, cents, emp]);
  return (await um<{ id: string }>(`insert into financial_installments(title_id, numero, vencimento, valor_cents) values ($1,1,$2,$3) returning id`, [t.id, venc, cents])).id;
}
const parcelas: string[] = [];

beforeAll(async () => {
  master = await criarConta({ nome: `pd-master-${marca}`, papeis: ["master"] });
  cob = await criarConta({ nome: `pd-cob-${marca}`, papeis: ["cobranca"] });
  fin = await criarConta({ nome: `pd-fin-${marca}`, papeis: ["financeiro"] });
  qual = await criarConta({ nome: `pd-qual-${marca}`, papeis: ["qualidade"] });
  consultora = await criarConta({ nome: `pd-cons-${marca}`, papeis: ["consultora"], comParty: true });
  emp = (await um<{ id: string }>("insert into business_entities(legal_name) values($1) returning id", [`ISO Empresa Plano ${marca}`])).id;
  devedora = await pessoa(`Dora Devedora ${marca}`);
  parcelas.push(await parcela(devedora, dia(-10), 10000));
  parcelas.push(await parcela(devedora, dia(-120), 25000));
  await parcela(devedora, dia(15), 7000);
});

describe("1. carteira vencida (0408)", () => {
  test("mesmo saldo e mesmas devedoras da Cobrança; faixas somam o vencido; inadimplência coerente", async () => {
    const p = await rpc<Record<string, unknown>>(cob, "painel_carteira_vencida");
    const k = await rpc<Record<string, unknown>>(cob, "cob_kpis");
    expect(p.erro).toBeNull();
    expect(Number(p.dados!["vencido_cents"])).toBe(Number(k.dados!["vencido_cents"]));
    expect(Number(p.dados!["devedoras"])).toBe(Number(k.dados!["devedoras"]));
    const faixas = p.dados!["faixas"] as { faixa: string; cents: number }[];
    expect(faixas.reduce((a, f) => a + Number(f.cents), 0)).toBe(Number(p.dados!["vencido_cents"]));
    const carteira = Number(p.dados!["carteira_cents"]);
    expect(carteira).toBe(Number(p.dados!["vencido_cents"]) + Number(p.dados!["a_vencer_cents"]));
    expect(Number(p.dados!["inadimplencia_pct"])).toBeCloseTo(Math.round((1000 * Number(p.dados!["vencido_cents"])) / carteira) / 10, 1);
  });
  test("o Financeiro também lê; consultora é recusada", async () => {
    expect((await rpc(fin, "painel_carteira_vencida")).erro).toBeNull();
    expect((await rpc(consultora, "painel_carteira_vencida")).erro).not.toBeNull();
  });
});

describe("2. estoque (0408)", () => {
  test("unidades = só saldo positivo; negativos viram 'faltam contar'", async () => {
    const r = await rpc<Record<string, number>>(master, "stock_overview");
    const s = await um<{ pos: string; neg: string; liq: string }>(
      `select coalesce(sum(quantity) filter (where quantity>0),0) pos, coalesce(-sum(quantity) filter (where quantity<0),0) neg, coalesce(sum(quantity),0) liq from public.stock_balances`);
    expect(Number(r.dados!["unidades"])).toBe(Number(s.pos));
    expect(Number(r.dados!["faltam_contar"])).toBe(Number(s.neg));
    expect(Number(r.dados!["unidades_liquidas"])).toBe(Number(s.liq));
  });
});

describe("3. agenda da Cobrança (0408)", () => {
  let antiga: string, nova: string, manual: string;
  beforeAll(async () => {
    antiga = (await um<{ id: string }>(`insert into cob_tarefas(party_id, origem, regua_dias, chave, titulo, vence_em, installment_ids) values ($1,'regua',1,$2,'D+1 · teste',$3,$4::uuid[]) returning id`, [devedora, `pd:${marca}:1`, dia(-100), parcelas.slice(0, 2)])).id;
    nova = (await um<{ id: string }>(`insert into cob_tarefas(party_id, origem, regua_dias, chave, titulo, vence_em, installment_ids) values ($1,'regua',15,$2,'D+15 · teste',$3,$4::uuid[]) returning id`, [devedora, `pd:${marca}:15`, dia(-20), parcelas.slice(0, 2)])).id;
    // follow-up de pessoa (outra devedora: um follow-up novo já fecha as tarefas da régua da mesma pessoa)
    const outra = await pessoa(`Olga Outra ${marca}`);
    parcelas.push(await parcela(outra, dia(-40), 5000));
    manual = (await um<{ id: string }>(`insert into cob_tarefas(party_id, origem, titulo, vence_em) values ($1,'manual','Ligar de novo',$2) returning id`, [outra, dia(-5)])).id;
  });
  test("a régua fecha a etapa anterior aberta quando existe uma mais avançada", async () => {
    await adm.unsafe(`select public.cob_regua_executar()`);
    const a = await um<{ status: string; motivo_fim: string }>(`select status, motivo_fim from cob_tarefas where id=$1`, [antiga]);
    expect(a).toEqual({ status: "cancelada", motivo_fim: "Substituída pela etapa seguinte da régua" });
    expect((await um<{ status: string }>(`select status from cob_tarefas where id=$1`, [nova])).status).toBe("aberta");
  });
  test("reorganizar: atrasada da régua vai para hoje ou próximo dia útil; follow-up de pessoa não muda", async () => {
    expect((await rpc(consultora, "cob_agenda_reorganizar", { _por_dia: 40 })).erro).not.toBeNull();
    const r = await rpc<{ reorganizadas: number }>(cob, "cob_agenda_reorganizar", { _por_dia: 40 });
    expect(r.erro).toBeNull();
    expect(Number(r.dados!.reorganizadas)).toBeGreaterThanOrEqual(1);
    const n = await um<{ v: string; dow: number }>(`select vence_em::text v, extract(isodow from vence_em)::int dow from cob_tarefas where id=$1`, [nova]);
    expect(n.v >= hojeSP()).toBe(true);
    expect(n.dow).toBeLessThan(6);
    expect((await um<{ v: string }>(`select vence_em::text v from cob_tarefas where id=$1`, [manual])).v).toBe(dia(-5));
    const log = await um<{ n: string }>(`select count(*) n from audit_logs where action='cob.agenda.reorganizada' and actor_id=$1`, [cob.uid]);
    expect(Number(log.n)).toBeGreaterThanOrEqual(1);
  });
  test("dia útil pula sábado e domingo", async () => {
    const r = await um<{ a: string; b: string }>(`select public.cob_dia_util('2026-11-28'::date, 0)::text a, public.cob_dia_util('2026-11-27'::date, 1)::text b`);
    expect(r).toEqual({ a: "2026-11-30", b: "2026-11-30" });
  });
});

describe("4. trocas (0408)", () => {
  let consPraca: string, praca: { codigo: number; nome: string };
  beforeAll(async () => {
    const cod = 900000 + Math.floor(Math.random() * 99999);
    const pc = await um<{ id: string; codigo: number; nome: string }>(`insert into cob_pracas(codigo, nome) values ($1,$2) returning id, codigo, nome`, [cod, `PRACA TESTE ${marca}`]);
    praca = { codigo: pc.codigo, nome: pc.nome };
    consPraca = await pessoa(`Cleo Consultora ${marca}`);
    await adm.unsafe(`insert into consultant_profiles(party_id, praca_id) values ($1,$2)`, [consPraca, pc.id]);
  });
  test("troca nova sem praça recebe a praça do cadastro; paradas há 30 dias têm filtro e contagem", async () => {
    const t = await um<{ id: string; praca_nome: string; praca_codigo: number }>(
      `insert into qualidade_trocas(origem, consultora_party_id, aberto_em) values ('admin_manual',$1, now() - interval '40 days') returning id, praca_nome, praca_codigo`,
      [consPraca]);
    expect({ codigo: t.praca_codigo, nome: t.praca_nome }).toEqual(praca);
    const b = await rpc<{ total: number; itens: { id: string }[] }>(qual, "qualidade_troca_buscar", { _termo: "", _status: "paradas30", _limite: 200, _offset: 0 });
    expect(b.erro).toBeNull();
    expect(b.dados!.itens.some((i) => i.id === t.id)).toBe(true);
    const b15 = await rpc<{ itens: { id: string }[] }>(qual, "qualidade_troca_buscar", { _termo: "", _status: "paradas15", _limite: 200, _offset: 0 });
    expect(b15.dados!.itens.some((i) => i.id === t.id)).toBe(true);
    const r = await rpc<Record<string, number>>(qual, "qualidade_troca_resumo");
    expect(Number(r.dados!["paradas30"])).toBeGreaterThanOrEqual(1);
    expect(Number(r.dados!["paradas15"])).toBeGreaterThanOrEqual(Number(r.dados!["paradas30"]));
  });
});

describe("5. site e cadastros (0408)", () => {
  test("pendência 'sem descrição' aparece na vitrine", async () => {
    const r = await rpc<Record<string, number>>(master, "showcase_counts");
    expect(r.dados).toHaveProperty("sem_descricao");
  });
  test("cadastros incompletos listam o que falta; consultora é recusada", async () => {
    const semDoc = await pessoa(`Sem Documento ${marca}`);
    const r = await rpc<{ total: number; itens: { id: string; faltando: string[] }[] }>(master, "registry_incompletos", { _falta: "documento", _limite: 200, _offset: 0 });
    expect(r.erro).toBeNull();
    const achada = r.dados!.itens.find((i) => i.id === semDoc);
    expect(achada?.faltando).toContain("documento");
    expect(achada?.faltando).toContain("contato");
    expect((await rpc(consultora, "registry_incompletos", {})).erro).not.toBeNull();
  });
});

describe("rede (0408)", () => {
  test("território mantém a regra 0391 (ativo e aprovado) e o card ganha com_maleta_90d", async () => {
    const d = await um<{ d: string }>(`select pg_get_functiondef('public.network_geo_territorio'::regproc) d`);
    expect(d.d).toContain("'aprovado'");
    const o = await um<{ d: string }>(`select pg_get_functiondef('public.network_geo_overview'::regproc) d`);
    expect(o.d).toContain("com_maleta_90d");
  });
});

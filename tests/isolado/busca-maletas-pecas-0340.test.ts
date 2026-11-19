/**
 * 0340/0341 (Diego, 19/11/2026) — Etapa 1. Banco ISOLADO, dados sintéticos.
 *  - maleta é encontrada pelo número (MAL-xxxxx ou só os dígitos), pelo nome da consultora (por partes,
 *    sem acento) e pelo código dela; colaborador sem kit.view não vê nada;
 *  - peça é encontrada pela referência (LAN...), pelo nome por partes, pelo código de barras;
 *  - toda peça devolve a referência (variante, senão a do produto) para aparecer junto do nome.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, VISITANTE, type Conta } from "./base";

const base = 820000 + Math.floor(Math.random() * 80000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const REF = `LBM${marca}`.toUpperCase();
let master: Conta, rep: Conta, ana: Conta, mkt: Conta;
let vA = "", vB = "", cycle = "", kit = "", codigo = "";

async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}

beforeAll(async () => {
  master = await criarConta({ nome: `bm-master-${base}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `bm-rep-${base}`, papeis: ["representante"], comParty: true });
  ana = await criarConta({ nome: `bm-ana-${base}`, papeis: ["consultora"], comParty: true });
  mkt = await criarConta({ nome: `bm-mkt-${base}`, papeis: ["marketing"], comParty: true });
  codigo = String(90000 + Math.floor(Math.random() * 9999));
  await adm.unsafe(`update public.parties set display_name=$2, code=$3 where id=$1`, [ana.partyId, `Isabéla Aparecida ${marca} Rodrigues`, codigo]);
  const deposito = await criarDeposito(`bm-${marca}`);
  vA = await criarVariante(`bm-a-${marca}`, 7490);
  vB = await criarVariante(`bm-b-${marca}`, 7490);
  await adm.unsafe(`update public.product_variants set reference_code=$2, barcode=$3 where id=$1`, [vA, REF, `9${base}`]);
  // vB sem referência na variante: herda a do produto
  await adm.unsafe(`update public.products set reference_code=$2, name=$3 where id=(select product_id from public.product_variants where id=$1)`, [vB, `${REF}P`, `Anel Gota Rosé ${marca}`]);
  await porEstoque(vA, deposito, 5);
  const praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`BM ${marca}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
    on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`, [ana.partyId, rep.partyId, praca]);
  const acerto = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const remessa = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito, _data_acerto: acerto })).id;
  cycle = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: ana.partyId })).cycle_id;
  kit = ((await adm.unsafe(`select k.code from public.kit_cycles c join public.kits k on k.id=c.kit_id where c.id=$1`, [cycle])) as { code: string }[])[0]!.code;
});

type M = { cycle_id: string; maleta: string; consultora_codigo: string | null };
const achar = async (conta: Conta, termo: string) => {
  const r = await rpc<M[]>(conta, "maletas_buscar", { _termo: termo, _limite: 50 });
  return r;
};

describe("Busca de maleta", () => {
  test("pelo número completo e só pelos dígitos", async () => {
    expect((await achar(master, kit)).dados.map((m) => m.cycle_id)).toContain(cycle);
    // "00467" ou "467" (sem o MAL-): no banco isolado a primeira maleta é MAL-00001, então usa os dígitos com zeros
    const digitos = kit.replace(/\D/g, "");
    expect((await achar(master, digitos)).dados.map((m) => m.cycle_id)).toContain(cycle);
  });
  test("pelo nome da consultora, por partes e sem acento, e pelo código dela", async () => {
    const porNome = (await achar(master, `isabela ${marca}`)).dados;
    expect(porNome.map((m) => m.cycle_id)).toContain(cycle);
    expect(porNome.find((m) => m.cycle_id === cycle)?.consultora_codigo).toBe(codigo);
    expect((await achar(master, codigo)).dados.map((m) => m.cycle_id)).toContain(cycle);
  });
  test("quem não tem acesso a maletas não acha nada", async () => {
    const r = await achar(mkt, `isabela ${marca}`);
    expect(r.ok === false || (r.dados ?? []).length === 0).toBe(true);
    expect((await achar(VISITANTE, `isabela ${marca}`)).ok).toBe(false);
  });
});

type P = { id: string; referencia: string | null; produto: string };
describe("Busca de peça", () => {
  test("pela referência (minúscula também), com a referência na resposta", async () => {
    const r = await ok<P[]>(master, "pecas_buscar", { _termo: REF.toLowerCase(), _limite: 20 });
    expect(r[0]!.id).toBe(vA);
    expect(r[0]!.referencia).toBe(REF);
  });
  test("pelo nome por partes e pelo código de barras", async () => {
    expect((await ok<P[]>(master, "pecas_buscar", { _termo: `gota ${marca}`, _limite: 20 })).map((p) => p.id)).toContain(vB);
    expect((await ok<P[]>(master, "pecas_buscar", { _termo: `9${base}`, _limite: 20 }))[0]!.id).toBe(vA);
  });
});

describe("Referência junto do nome", () => {
  test("variante usa a própria referência; sem ela, a do produto", async () => {
    const r = (await ler<{ variant_id: string; referencia: string | null }>(ana, `select * from public.pecas_referencias($1::uuid[])`, [`{${vA},${vB}}`])).linhas;
    const m = new Map(r.map((x) => [x.variant_id, x.referencia]));
    expect(m.get(vA)).toBe(REF);
    expect(m.get(vB)).toBe(`${REF}P`);
  });
  test("visitante sem login não consulta", async () => {
    expect((await ler(VISITANTE, `select * from public.pecas_referencias($1::uuid[])`, [`{${vA}}`])).linhas ?? []).toHaveLength(0);
  });
});

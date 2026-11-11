/**
 * 0281 (Diego, 11/11/2026) — recebimento de maletas na Qualidade + expedição de retorno do representante,
 * e correções do 0280 (devolução com depósito negativo, remessa finalizada como destino).
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 700000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, montagem: Conta, qualidade: Conta, rep: Conta, repOutro: Conta, ana: Conta, bia: Conta, cris: Conta, duda: Conta, consultoraX: Conta;
let deposito = "", vA = "", praca = "", rem = "", remFinal = "";
let mAna = "", mBia = "", mCris = "", mDuda = "";

async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}
const transitoPara = async (cycle: string, para: string) =>
  um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 and status='transito' and to_party_id=$2 order by seq desc limit 1`, [cycle, para]);
const estoque = async () => Number((await um<{ q: number }>(`select coalesce(sum(quantity),0)::int q from public.stock_balances where location_id=$1 and variant_id=$2`, [deposito, vA])).q);
const codigo = async (cycle: string) => (await um<{ code: string }>(`select k.code from public.kit_cycles c join public.kits k on k.id=c.kit_id where c.id=$1`, [cycle])).code;

beforeAll(async () => {
  master = await criarConta({ nome: `r81-master-${base}`, papeis: ["master"], comParty: true });
  montagem = await criarConta({ nome: `r81-mont-${base}`, papeis: ["montagem"], comParty: true });
  qualidade = await criarConta({ nome: `r81-qual-${base}`, papeis: ["qualidade"], comParty: true });
  rep = await criarConta({ nome: `r81-rep-${base}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `r81-rep2-${base}`, papeis: ["representante"], comParty: true });
  ana = await criarConta({ nome: `r81-ana-${base}`, papeis: ["consultora"], comParty: true });
  bia = await criarConta({ nome: `r81-bia-${base}`, papeis: ["consultora"], comParty: true });
  cris = await criarConta({ nome: `r81-cris-${base}`, papeis: ["consultora"], comParty: true });
  duda = await criarConta({ nome: `r81-duda-${base}`, papeis: ["consultora"], comParty: true });
  consultoraX = await criarConta({ nome: `r81-x-${base}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`r81-${marca}`);
  vA = await criarVariante(`r81-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 40);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`R81 ${marca}`])).linhas[0]!.id;
  for (const c of [ana, bia, cris, duda]) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
      [c.partyId, rep.partyId, praca]);
  }
  const acerto = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  rem = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito, _data_acerto: acerto(40) })).id;
  remFinal = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: repOutro.partyId, _deposito: deposito, _data_acerto: acerto(50) })).id;
  const montar = async (c: Conta) => {
    const id = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: c.partyId })).cycle_id;
    await ok(master, "kit_item_upsert", { _cycle: id, _variant: vA, _qty: 3 });
    await ok(master, "kit_conferir", { _cycle: id, _note: null });
    return id;
  };
  mAna = await montar(ana);
  mBia = await montar(bia);
  mCris = await montar(cris);
  mDuda = await montar(duda);
  await ok(master, "remessa_expedir_representante", { _remessa: rem });
  for (const m of [mAna, mBia, mCris, mDuda]) await ok(rep, "kit_transfer_confirm", { _transfer: (await transitoPara(m, rep.partyId!)).id, _payload: {} });
  // Bia: entregue, aceita, acerto em campo com TODAS as peças de volta (nada a pagar) e fechado
  await ok(rep, "kit_transfer_forward", { _cycle: mBia, _payload: { note: "Entregue em mãos" } });
  await ok(bia, "kit_transfer_confirm", { _transfer: (await transitoPara(mBia, bia.partyId!)).id, _payload: {} });
  await ok(bia, "kit_aceitar", { _cycle: mBia, _itens: [{ variant_id: vA, qty_accepted: 3, qty_divergent: 0 }], _idempotency_key: `r81b-${marca}` });
  await ok(rep, "rep_acerto_campo_devolucao", { _cycle: mBia, _leituras: [{ variant_id: vA, qtd: 3 }] });
  await ok(rep, "pre_baixa_fechar", { _cycle: mBia });
  // Duda: idem, mas vai chegar no balcão sem expedição
  await ok(rep, "kit_transfer_forward", { _cycle: mDuda, _payload: { note: "Entregue em mãos" } });
  await ok(duda, "kit_transfer_confirm", { _transfer: (await transitoPara(mDuda, duda.partyId!)).id, _payload: {} });
  await ok(duda, "kit_aceitar", { _cycle: mDuda, _itens: [{ variant_id: vA, qty_accepted: 3, qty_divergent: 0 }], _idempotency_key: `r81d-${marca}` });
  await ok(rep, "rep_acerto_campo_devolucao", { _cycle: mDuda, _leituras: [{ variant_id: vA, qtd: 3 }] });
  await ok(rep, "pre_baixa_fechar", { _cycle: mDuda });
});

describe("1. o que está com o representante", () => {
  test("lista o acerto fechado para devolver e as maletas ainda com ele; outro representante não vê", async () => {
    const p = await ok<{ a_devolver: { cycle_id: string; motivo: string; pecas: number }[]; com_voce: { cycle_id: string }[] }>(rep, "retorno_rep_pendentes", { _rep: rep.partyId });
    expect(p.a_devolver.find((x) => x.cycle_id === mBia)).toMatchObject({ motivo: "acerto", pecas: 3 });
    expect(p.com_voce.map((x) => x.cycle_id)).toEqual(expect.arrayContaining([mAna, mCris]));
    expect((await rpc(repOutro, "retorno_rep_pendentes", { _rep: rep.partyId })).erro ?? "").toMatch(/Sem permissão/);
  });
});

describe("2. expedição de retorno", () => {
  test("maleta não entregue exige motivo; outro representante não expede; expedição registra acerto + devolução", async () => {
    expect((await rpc(rep, "retorno_expedir", { _rep: rep.partyId, _cycles: [mBia, mCris] })).erro ?? "").toMatch(/diga por que/);
    expect((await rpc(repOutro, "retorno_expedir", { _rep: rep.partyId, _cycles: [mBia] })).erro ?? "").toMatch(/Sem permissão/);
    const e = await ok<{ numero: number; status: string; itens: { cycle_id: string; motivo: string; status: string }[] }>(rep, "retorno_expedir",
      { _rep: rep.partyId, _cycles: [mBia, mCris], _obs: "Levando na segunda", _motivo_nao_ficou: "Cris não quis ficar com a maleta" });
    expect(e.status).toBe("enviada");
    expect(e.itens.map((i) => [i.cycle_id, i.motivo, i.status]).sort()).toEqual([[mBia, "acerto", "a_caminho"], [mCris, "nao_ficou", "a_caminho"]].sort());
    expect((await rpc(rep, "retorno_expedir", { _rep: rep.partyId, _cycles: [mBia] })).erro ?? "").toMatch(/já está na expedição/);
    // devolução que está numa expedição não é desfeita por fora
    const d = await um<{ id: string }>(`select id from public.maleta_devolucoes where cycle_id=$1 and status='pedida'`, [mCris]);
    expect((await rpc(rep, "maleta_devolucao_cancelar", { _id: d.id, _motivo: "mudei" })).erro ?? "").toMatch(/expedição de retorno/);
  });

  test("representante e consultora não confirmam chegada nem veem o painel", async () => {
    expect((await rpc(rep, "retorno_receber", { _codigo: await codigo(mCris) })).erro ?? "").toMatch(/montagem ou a Qualidade/);
    expect((await rpc(ana, "retorno_painel", {})).erro ?? "").toMatch(/Sem permissão/);
  });
});

describe("3. recebimento na Qualidade", () => {
  test("bipou a maleta não entregue: peças voltam ao estoque mesmo com depósito negativo (estoque não contado)", async () => {
    // depósito com saldo negativo (peças na rua ainda não contadas): a entrada não pode ser recusada
    await adm.unsafe(`update public.stock_balances set quantity = -50 where location_id=$1 and variant_id=$2`, [deposito, vA]);
    const antes = await estoque();
    const r = await ok<{ motivo: string; pecas: number; repetida: boolean; precisa_conferir: boolean }>(qualidade, "retorno_receber", { _codigo: await codigo(mCris) });
    expect(r).toMatchObject({ motivo: "nao_ficou", pecas: 3, repetida: false, precisa_conferir: false });
    expect(await estoque()).toBe(antes + 3);
    expect((await um<{ s: string }>(`select status::text s from public.kit_cycles where id=$1`, [mCris])).s).toBe("cancelada");
    const de_novo = await ok<{ repetida: boolean }>(qualidade, "retorno_receber", { _codigo: await codigo(mCris) });
    expect(de_novo.repetida).toBe(true);
    expect(await estoque()).toBe(antes + 3);
  });

  test("bipou a maleta do acerto: chegada registrada, vai para conferir peças; conferência encerra", async () => {
    const r = await ok<{ motivo: string; precisa_conferir: boolean; expedicao_status: string }>(qualidade, "retorno_receber", { _codigo: await codigo(mBia) });
    expect(r).toMatchObject({ motivo: "acerto", precisa_conferir: true, expedicao_status: "recebida" });
    const p = await ok<{ conferir: { cycle_id: string }[]; chegando: unknown[] }>(qualidade, "retorno_painel", {});
    expect(p.conferir.some((x) => x.cycle_id === mBia)).toBe(true);
    const antes = await estoque();
    const c = await ok<{ status: string }>(master, "pre_baixa_conferir", { _cycle: mBia, _leituras: [{ variant_id: vA, qtd: 3 }], _aplicar: true });
    expect(c.status).toBe("encerrada");
    expect(await estoque()).toBe(antes + 3);
    const p2 = await ok<{ conferir: { cycle_id: string }[] }>(qualidade, "retorno_painel", {});
    expect(p2.conferir.some((x) => x.cycle_id === mBia)).toBe(false);
  });

  test("chegou no balcão sem expedição: registra e recebe; aparece como pendente antes", async () => {
    const p = await ok<{ pendentes: { representante_party_id: string; maletas: { cycle_id: string }[] }[] }>(qualidade, "retorno_painel", {});
    expect(p.pendentes.find((x) => x.representante_party_id === rep.partyId)?.maletas.some((m) => m.cycle_id === mDuda)).toBe(true);
    const r = await ok<{ numero: number; motivo: string }>(montagem, "retorno_receber", { _codigo: await codigo(mDuda) });
    expect(r.motivo).toBe("acerto");
    const e = await um<{ origem: string; status: string }>(`select e.origem, e.status from public.retorno_expedicoes e where e.numero=$1`, [r.numero]);
    expect(e).toMatchObject({ origem: "balcao", status: "recebida" });
  });

  test("maleta que não está voltando é recusada com explicação", async () => {
    expect((await rpc(qualidade, "retorno_receber", { _codigo: await codigo(mAna) })).erro ?? "").toMatch(/não está voltando/);
  });

  test("não veio: volta a ser pendência do representante", async () => {
    const e = await ok<{ itens: { item_id: string }[] }>(rep, "retorno_expedir", { _rep: rep.partyId, _cycles: [mAna], _motivo_nao_ficou: "Ana viajou, maleta volta" });
    expect((await rpc(qualidade, "retorno_nao_veio", { _item: e.itens[0]!.item_id, _motivo: "ab" })).erro ?? "").toMatch(/mínimo/);
    const r = await ok<{ expedicao_status: string }>(qualidade, "retorno_nao_veio", { _item: e.itens[0]!.item_id, _motivo: "Não estava no malote" });
    expect(r.expedicao_status).toBe("com_falta");
    const p = await ok<{ a_devolver: { cycle_id: string; nao_veio: boolean }[] }>(rep, "retorno_rep_pendentes", { _rep: rep.partyId });
    expect(p.a_devolver.find((x) => x.cycle_id === mAna)).toMatchObject({ nao_veio: true });
  });
});

describe("4. mudar remessa: remessa finalizada recebe maleta conferida", () => {
  test("finalizada aparece na lista e aceita maleta conferida; maleta em montagem não", async () => {
    await adm.unsafe(`update public.remessas set status='fechada' where id=$1`, [remFinal]);
    const m = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: consultoraX.partyId })).cycle_id;
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3) on conflict (party_id) do nothing`, [consultoraX.partyId, rep.partyId, praca]);
    const l1 = await ok<{ id: string }[]>(master, "remessas_destino_lista", { _cycle: m });
    expect(l1.some((x) => x.id === remFinal)).toBe(false);
    expect((await rpc(master, "remessa_maleta_mudar_remessa", { _cycle: m, _remessa: remFinal, _motivo: "passar para o outro" })).erro ?? "").toMatch(/só recebe maleta já conferida/);
    await ok(master, "kit_item_upsert", { _cycle: m, _variant: vA, _qty: 1 });
    await ok(master, "kit_conferir", { _cycle: m, _note: null });
    const l2 = await ok<{ id: string; representante_party_id: string }[]>(master, "remessas_destino_lista", { _cycle: m });
    expect(l2.find((x) => x.id === remFinal)?.representante_party_id).toBe(repOutro.partyId!);
    const r = await ok<{ representante_party_id: string }>(master, "remessa_maleta_mudar_remessa", { _cycle: m, _remessa: remFinal, _motivo: "Ibaiti passa para o Guilherme" });
    expect(r.representante_party_id).toBe(repOutro.partyId!);
  });
});

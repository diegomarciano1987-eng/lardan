/**
 * 0280 (Diego, 11/11/2026) — (1) trocar a remessa/representante de maleta pronta sem mexer na
 * consultora nem nas peças; (2) devolver à empresa a maleta que a consultora não ficou (antes do
 * aceite): o representante pede, a montagem confirma e as peças voltam ao estoque.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 600000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, montagem: Conta, repDiego: Conta, repGui: Conta, ana: Conta, bia: Conta, cris: Conta;
let deposito = "", vA = "", praca = "", remDiego = "", remGui = "";
let mAna = "", mBia = "", mCris = "";

async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}
const transitoPara = async (cycle: string, para: string) =>
  um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 and status='transito' and to_party_id=$2 order by seq desc limit 1`, [cycle, para]);
const estoque = async () => Number((await um<{ q: number }>(`select coalesce(sum(quantity),0)::int q from public.stock_balances where location_id=$1 and variant_id=$2`, [deposito, vA])).q);

beforeAll(async () => {
  master = await criarConta({ nome: `d80-master-${base}`, papeis: ["master"], comParty: true });
  montagem = await criarConta({ nome: `d80-mont-${base}`, papeis: ["montagem"], comParty: true });
  repDiego = await criarConta({ nome: `d80-repd-${base}`, papeis: ["representante"], comParty: true });
  repGui = await criarConta({ nome: `d80-repg-${base}`, papeis: ["representante"], comParty: true });
  ana = await criarConta({ nome: `d80-ana-${base}`, papeis: ["consultora"], comParty: true });
  bia = await criarConta({ nome: `d80-bia-${base}`, papeis: ["consultora"], comParty: true });
  cris = await criarConta({ nome: `d80-cris-${base}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`d80-${marca}`);
  vA = await criarVariante(`d80-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 50);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`D80 ${marca}`])).linhas[0]!.id;
  for (const c of [ana, bia, cris]) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
      [c.partyId, repDiego.partyId, praca]);
  }
  const acerto = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  remDiego = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: repDiego.partyId, _deposito: deposito, _data_acerto: acerto(60) })).id;
  remGui = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: repGui.partyId, _deposito: deposito, _data_acerto: acerto(75) })).id;
  const montar = async (c: Conta) => {
    const id = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remDiego, _consultora: c.partyId })).cycle_id;
    await ok(master, "kit_item_upsert", { _cycle: id, _variant: vA, _qty: 3 });
    await ok(master, "kit_conferir", { _cycle: id, _note: null });
    return id;
  };
  mAna = await montar(ana);
  mBia = await montar(bia);
  mCris = await montar(cris);
});

describe("1. trocar remessa e representante de maleta pronta", () => {
  test("só a equipe; motivo obrigatório", async () => {
    expect((await rpc(repDiego, "remessa_maleta_mudar_remessa", { _cycle: mAna, _remessa: remGui, _motivo: "passar pro Gui" })).erro ?? "").toMatch(/Sem permissão/);
    expect((await rpc(master, "remessa_maleta_mudar_remessa", { _cycle: mAna, _remessa: remGui, _motivo: "ab" })).erro ?? "").toMatch(/motivo/);
  });

  test("conferida: muda remessa e representante, consultora e peças ficam iguais", async () => {
    const antes = await um<{ itens: number }>(`select coalesce(sum(qty_allocated),0)::int itens from public.kit_balances where cycle_id=$1`, [mAna]);
    const r = await ok<{ representante_party_id: string }>(master, "remessa_maleta_mudar_remessa", { _cycle: mAna, _remessa: remGui, _motivo: "Guilherme vai atender Ibaiti" });
    expect(r.representante_party_id).toBe(repGui.partyId!);
    const c = await um<{ remessa_id: string; representante_party_id: string; consultora_party_id: string }>(
      `select remessa_id, representante_party_id, consultora_party_id from public.kit_cycles where id=$1`, [mAna]);
    expect(c).toMatchObject({ remessa_id: remGui, representante_party_id: repGui.partyId, consultora_party_id: ana.partyId });
    const depois = await um<{ itens: number }>(`select coalesce(sum(qty_allocated),0)::int itens from public.kit_balances where cycle_id=$1`, [mAna]);
    expect(depois.itens).toBe(antes.itens);
    const ev = await um<{ n: number }>(`select count(*)::int n from public.kit_events where cycle_id=$1 and kind='remessa.trocada'`, [mAna]);
    expect(ev.n).toBe(1);
  });

  test("em trânsito com o representante: a custódia passa para o novo representante", async () => {
    await ok(master, "remessa_expedir_representante", { _remessa: remDiego });
    await ok(repDiego, "kit_transfer_confirm", { _transfer: (await transitoPara(mBia, repDiego.partyId!)).id, _payload: {} });
    await ok(master, "remessa_maleta_mudar_remessa", { _cycle: mBia, _remessa: remGui, _motivo: "Guilherme vai atender Ibaiti" });
    const c = await um<{ custodian_party_id: string; status: string }>(`select custodian_party_id, status::text from public.kit_cycles where id=$1`, [mBia]);
    expect(c).toMatchObject({ custodian_party_id: repGui.partyId, status: "transito" });
  });

  test("a mesma consultora não fica com duas maletas na remessa de destino", async () => {
    expect((await rpc(master, "remessa_maleta_mudar_remessa", { _cycle: mAna, _remessa: remGui, _motivo: "de novo teste" })).erro ?? "").toMatch(/já está nesta remessa/);
  });
});

describe("2. devolver a maleta para a empresa", () => {
  test("representante de fora não pede; o da maleta pede com motivo", async () => {
    await ok(repDiego, "kit_transfer_confirm", { _transfer: (await transitoPara(mCris, repDiego.partyId!)).id, _payload: {} });
    expect((await rpc(repGui, "maleta_devolucao_pedir", { _cycle: mCris, _motivo: "não ficou com ela" })).erro ?? "").toMatch(/Sem permissão/);
    const r = await ok<{ status: string }>(repDiego, "maleta_devolucao_pedir", { _cycle: mCris, _motivo: "Cris não ficou com a maleta no acerto" });
    expect(r.status).toBe("pedida");
    expect((await rpc(repDiego, "maleta_devolucao_pedir", { _cycle: mCris, _motivo: "de novo" })).erro ?? "").toMatch(/já foi pedida/);
    const lista = await ok<{ cycle_id: string }[]>(repDiego, "maleta_devolucoes_lista", { _rep: repDiego.partyId });
    expect(lista.some((x) => x.cycle_id === mCris)).toBe(true);
  });

  test("representante não confirma a chegada; a montagem confirma e as peças voltam ao estoque", async () => {
    const d = await um<{ id: string }>(`select id from public.maleta_devolucoes where cycle_id=$1 and status='pedida'`, [mCris]);
    expect((await rpc(repDiego, "maleta_devolucao_receber", { _id: d.id })).erro ?? "").toMatch(/montagem/);
    const antes = await estoque();
    const r = await ok<{ pecas: number }>(montagem, "maleta_devolucao_receber", { _id: d.id });
    expect(r.pecas).toBe(3);
    expect(await estoque()).toBe(antes + 3);
    const c = await um<{ status: string }>(`select status::text from public.kit_cycles where id=$1`, [mCris]);
    expect(c.status).toBe("cancelada");
    // repetir não devolve de novo
    const again = await ok<{ repetida: boolean }>(montagem, "maleta_devolucao_receber", { _id: d.id });
    expect(again.repetida).toBe(true);
    expect(await estoque()).toBe(antes + 3);
  });

  test("depois do aceite não devolve por aqui (vai pelo acerto)", async () => {
    await ok(repGui, "kit_transfer_forward", { _cycle: mBia, _payload: { note: "Entregue em mãos" } });
    await ok(bia, "kit_transfer_confirm", { _transfer: (await transitoPara(mBia, bia.partyId!)).id, _payload: {} });
    await ok(bia, "kit_aceitar", { _cycle: mBia, _itens: [{ variant_id: vA, qty_accepted: 3, qty_divergent: 0 }], _idempotency_key: `d80-${marca}` });
    expect((await rpc(master, "maleta_devolucao_pedir", { _cycle: mBia, _motivo: "não ficou com ela" })).erro ?? "").toMatch(/aceite|acerto/);
  });
});

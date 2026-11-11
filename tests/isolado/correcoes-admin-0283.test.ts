/**
 * 0283 (Diego/Daniel, 11/11/2026) — correções do administrador: desfazer devolução feita por engano,
 * segunda maleta na mesma remessa com motivo, vincular histórico de vendas, excluir venda de teste e
 * cancelar remessa vazia. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 700000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, montagem: Conta, rep: Conta, ana: Conta, bia: Conta, marido: Conta;
let deposito = "", vA = "", praca = "", rem = "", remVazia = "";
let mAna = "", mExtra = "";

async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}
const transitoPara = async (cycle: string, para: string) =>
  um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 and status='transito' and to_party_id=$2 order by seq desc limit 1`, [cycle, para]);
const estoque = async () => Number((await um<{ q: number }>(`select coalesce(sum(quantity),0)::int q from public.stock_balances where location_id=$1 and variant_id=$2`, [deposito, vA])).q);

beforeAll(async () => {
  master = await criarConta({ nome: `c83-master-${base}`, papeis: ["master"], comParty: true });
  montagem = await criarConta({ nome: `c83-mont-${base}`, papeis: ["montagem"], comParty: true });
  rep = await criarConta({ nome: `c83-rep-${base}`, papeis: ["representante"], comParty: true });
  ana = await criarConta({ nome: `c83-ana-${base}`, papeis: ["consultora"], comParty: true });
  bia = await criarConta({ nome: `c83-bia-${base}`, papeis: ["consultora"], comParty: true });
  marido = await criarConta({ nome: `c83-marido-${base}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`c83-${marca}`);
  vA = await criarVariante(`c83-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 50);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`C83 ${marca}`])).linhas[0]!.id;
  for (const c of [ana, bia]) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
      [c.partyId, rep.partyId, praca]);
  }
  const acerto = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  rem = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito, _data_acerto: acerto(60) })).id;
  remVazia = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito, _data_acerto: acerto(70) })).id;
  const montar = async (c: Conta) => {
    const id = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: c.partyId })).cycle_id;
    await ok(master, "kit_item_upsert", { _cycle: id, _variant: vA, _qty: 3 });
    await ok(master, "kit_conferir", { _cycle: id, _note: null });
    return id;
  };
  mAna = await montar(ana);
  mExtra = await montar(bia);
  await ok(master, "remessa_expedir_representante", { _remessa: rem });
  for (const m of [mAna, mExtra]) await ok(rep, "kit_transfer_confirm", { _transfer: (await transitoPara(m, rep.partyId!)).id, _payload: {} });
});

describe("1. desfazer devolução feita por engano", () => {
  test("devolve, Master desfaz: peças voltam à maleta e ela fica com o representante", async () => {
    await ok(rep, "maleta_devolucao_pedir", { _cycle: mAna, _motivo: "entreguei para a cliente errada" });
    const d = await um<{ id: string }>(`select id from public.maleta_devolucoes where cycle_id=$1 and status='pedida'`, [mAna]);
    const antes = await estoque();
    await ok(montagem, "maleta_devolucao_receber", { _id: d.id });
    expect(await estoque()).toBe(antes + 3);
    expect((await rpc(montagem, "maleta_devolucao_desfazer", { _cycle: mAna, _motivo: "engano do Daniel" })).erro ?? "").toMatch(/Master/);
    expect((await rpc(master, "maleta_devolucao_desfazer", { _cycle: mAna, _motivo: "ab" })).erro ?? "").toMatch(/motivo/);
    const r = await ok<{ pecas: number; status: string }>(master, "maleta_devolucao_desfazer", { _cycle: mAna, _motivo: "engano do Daniel na entrega" });
    expect(r).toMatchObject({ pecas: 3, status: "transito" });
    expect(await estoque()).toBe(antes);
    const c = await um<{ status: string; custodian_party_id: string }>(`select status::text, custodian_party_id from public.kit_cycles where id=$1`, [mAna]);
    expect(c).toMatchObject({ status: "transito", custodian_party_id: rep.partyId });
    const b = await um<{ q: number }>(`select coalesce(sum(quantity),0)::int q from public.stock_balances where location_id=(select current_location_id from public.kit_cycles where id=$1)`, [mAna]);
    expect(b.q).toBe(3);
    // não desfaz duas vezes
    expect((await rpc(master, "maleta_devolucao_desfazer", { _cycle: mAna, _motivo: "de novo engano" })).erro ?? "").toMatch(/não está devolvida/);
  });
});

describe("2. segunda maleta para a mesma consultora", () => {
  test("sem motivo continua travado; com motivo o representante passa a 2ª maleta", async () => {
    expect((await rpc(rep, "rep_maleta_trocar_destino", { _rep: rep.partyId, _cycle: mExtra, _consultora: ana.partyId, _lead: null })).erro ?? "").toMatch(/já tem/);
    expect((await rpc(rep, "rep_maleta_segunda", { _rep: rep.partyId, _cycle: mExtra, _consultora: ana.partyId, _motivo: "ab" })).erro ?? "").toMatch(/motivo/);
    await ok(rep, "rep_maleta_segunda", { _rep: rep.partyId, _cycle: mExtra, _consultora: ana.partyId, _motivo: "Forçar melhor venda final de ano" });
    const n = await um<{ n: number; seg: number }>(`select count(*)::int n, count(segunda_maleta_motivo)::int seg from public.kit_cycles
       where remessa_id=$1 and consultora_party_id=$2 and status<>'cancelada'`, [rem, ana.partyId]);
    expect(n).toMatchObject({ n: 2, seg: 1 });
    const ev = await um<{ n: number }>(`select count(*)::int n from public.kit_events where cycle_id=$1 and kind='maleta.segunda'`, [mExtra]);
    expect(ev.n).toBe(1);
  });
  test("a marcação de segunda maleta não é chamada direto", async () => {
    expect((await rpc(rep, "maleta_segunda_marcar", { _cycle: mAna, _motivo: "burlar a trava" })).erro).toBeTruthy();
  });
});

describe("3. vincular histórico de vendas", () => {
  test("prévia, Master aplica, códigos antigos do marido entram no histórico dela, desfaz", async () => {
    const cod = 990000 + Math.floor(Math.random() * 9000);
    await adm.unsafe(`insert into public.legado_consultoras (codcli, nome, party_id) values ($1,$2,$3)`, [cod, "Marido", marido.partyId]);
    expect((await rpc(montagem, "consultora_historico_vincular", { _destino: ana.partyId, _origem: marido.partyId, _motivo: "nome do marido", _executar: false })).erro ?? "").toMatch(/Master/);
    const p = await ok<{ previa: boolean; codigos_antigos: number[] }>(master, "consultora_historico_vincular", { _destino: ana.partyId, _origem: marido.partyId, _motivo: "", _executar: false });
    expect(p.previa).toBe(true);
    expect(p.codigos_antigos).toContain(cod);
    const v = await ok<{ id: string }>(master, "consultora_historico_vincular", { _destino: ana.partyId, _origem: marido.partyId, _motivo: "Primeiro cadastro no nome do marido", _executar: true });
    const c1 = await um<{ c: number[] }>(`select public.legado_codigos_da_pessoa($1) c`, [ana.partyId]);
    expect(c1.c).toContain(cod);
    expect((await rpc(master, "consultora_historico_vincular", { _destino: bia.partyId, _origem: marido.partyId, _motivo: "outra vez", _executar: true })).erro).toBeTruthy();
    await ok(master, "consultora_historico_desvincular", { _id: v.id });
    const c2 = await um<{ c: number[] }>(`select public.legado_codigos_da_pessoa($1) c`, [ana.partyId]);
    expect(c2.c).not.toContain(cod);
  });
});

describe("4. venda de teste e remessa vazia", () => {
  test("Master exclui venda de teste (fica cancelada com motivo); outros não", async () => {
    const o = await um<{ id: string }>(`insert into public.sales_orders (code, consultora_party_id, customer_name, channel, status)
       values ($1,$2,'Cliente Teste','app','em_atendimento') returning id`, [`T83-${marca}`, ana.partyId]);
    expect((await rpc(montagem, "venda_teste_excluir", { _order: o.id, _motivo: "venda de teste" })).erro ?? "").toMatch(/Master/);
    await ok(master, "venda_teste_excluir", { _order: o.id, _motivo: "cliente de teste" });
    const s = await um<{ status: string; cancel_reason: string }>(`select status::text, cancel_reason from public.sales_orders where id=$1`, [o.id]);
    expect(s.status).toBe("cancelado");
    expect(s.cancel_reason).toMatch(/teste/);
  });
  test("remessa só é cancelada vazia", async () => {
    expect((await rpc(master, "remessa_cancelar_vazia", { _remessa: rem, _motivo: "remessa errada" })).erro ?? "").toMatch(/ainda tem maletas/);
    await ok(master, "remessa_cancelar_vazia", { _remessa: remVazia, _motivo: "remessa criada errada" });
    const r = await um<{ status: string }>(`select status from public.remessas where id=$1`, [remVazia]);
    expect(r.status).toBe("cancelada");
  });
});

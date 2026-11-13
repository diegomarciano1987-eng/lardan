/**
 * 0325 (Diego, 13/11/2026) — Master registra "a consultora já aceitou" na remessa; a maleta já aparece
 * em operação no app dela. Representante só vê remessas em nome dele. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 600000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, montagem: Conta, rep: Conta, rep2: Conta, ana: Conta, bia: Conta, cris: Conta;
let deposito = "", vA = "", praca = "", remessa = "", remOutro = "";
let mAna = "", mBia = "", mCris = "";

async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}
async function montar(c: Conta, rem: string) {
  const id = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: c.partyId })).cycle_id;
  await ok(master, "kit_item_upsert", { _cycle: id, _variant: vA, _qty: 3 });
  await ok(master, "kit_conferir", { _cycle: id, _note: null });
  return id;
}
const transitoPara = async (cycle: string, para: string) =>
  um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 and status='transito' and to_party_id=$2 order by seq desc limit 1`, [cycle, para]);
const ciclo = (id: string) => um<{ status: string; custodian_party_id: string }>(`select status::text, custodian_party_id from public.kit_cycles where id=$1`, [id]);

beforeAll(async () => {
  master = await criarConta({ nome: `a325-master-${base}`, papeis: ["master"], comParty: true });
  montagem = await criarConta({ nome: `a325-mont-${base}`, papeis: ["montagem"], comParty: true });
  rep = await criarConta({ nome: `a325-rep-${base}`, papeis: ["representante"], comParty: true });
  rep2 = await criarConta({ nome: `a325-rep2-${base}`, papeis: ["representante"], comParty: true });
  [ana, bia, cris] = await Promise.all(["ana", "bia", "cris"].map((n) => criarConta({ nome: `a325-${n}-${base}`, papeis: ["consultora"], comParty: true })));
  deposito = await criarDeposito(`a325-${marca}`);
  vA = await criarVariante(`a325-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 50);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`A325 ${marca}`])).linhas[0]!.id;
  for (const c of [ana, bia]) await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
    on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`, [c.partyId, rep.partyId, praca]);
  // cris é da mesma praça mas da carteira do rep2 (caso Daniel × remessa do Guilherme)
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
    on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`, [cris.partyId, rep2.partyId, praca]);
  const acerto = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  remessa = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito, _data_acerto: acerto })).id;
  mAna = await montar(ana, remessa);
  mBia = await montar(bia, remessa);
  mCris = await montar(cris, remessa);
  await ok(master, "remessa_expedir_representante", { _remessa: remessa });
  await ok(rep, "kit_transfer_confirm", { _transfer: (await transitoPara(mAna, rep.partyId!)).id, _payload: {} });
  remOutro = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep2.partyId, _deposito: deposito, _data_acerto: acerto })).id;
});

describe("0325: aceite administrativo pelo Master", () => {
  test("lista só para o Master, com as maletas sem aceite", async () => {
    expect((await rpc(montagem, "remessa_aceites_pendentes", { _remessa: remessa })).erro ?? "").toMatch(/Master/);
    const l = await ok<{ cycle_id: string }[]>(master, "remessa_aceites_pendentes", { _remessa: remessa });
    expect(l.map((x) => x.cycle_id).sort()).toEqual([mAna, mBia, mCris].sort());
  });

  test("colaboradora, representante e consultora não conseguem", async () => {
    for (const c of [montagem, rep, ana]) {
      expect((await rpc(c, "kit_aceite_administrativo", { _cycle: mAna, _motivo: "Entregue em mãos e conferida" })).erro ?? "").toMatch(/Master/);
    }
  });

  test("sem motivo não registra", async () => {
    expect((await rpc(master, "kit_aceite_administrativo", { _cycle: mAna, _motivo: "ok" })).erro ?? "").toMatch(/motivo/);
  });

  test("maleta com o representante: vai para a consultora, aceite integral, operação, evento e auditoria", async () => {
    const r = await ok<{ situacao: string; acceptance_id: string }>(master, "kit_aceite_administrativo", { _cycle: mAna, _motivo: "Entregue e conferida em mãos pelo representante" });
    expect(r.situacao).toBe("operacao");
    const c = await ciclo(mAna);
    expect(c.status).toBe("operacao");
    expect(c.custodian_party_id).toBe(ana.partyId!);
    const a = await um<{ kind: string; adm: boolean; motivo: string; qa: number; qd: number }>(`select a.kind::text, (a.context->>'administrativo')::boolean adm, a.context->>'motivo' motivo,
      (select sum(qty_accepted)::int from public.kit_acceptance_items where acceptance_id=a.id) qa, (select sum(qty_divergent)::int from public.kit_acceptance_items where acceptance_id=a.id) qd
      from public.kit_acceptances a where a.cycle_id=$1`, [mAna]);
    expect(a).toEqual({ kind: "integral", adm: true, motivo: "Entregue e conferida em mãos pelo representante", qa: 3, qd: 0 });
    expect((await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='maleta.aceite_administrativo' and entity_id=$1`, [mAna])).n).toBe(1);
    expect((await um<{ n: number }>(`select count(*)::int n from public.kit_events where cycle_id=$1 and kind='maleta.aceite_administrativo'`, [mAna])).n).toBe(1);
  });

  test("no app da consultora a maleta não pede mais aceite", async () => {
    const p = await ok<{ cycle_id: string }[]>(ana, "consultora_aceites_pendentes", {});
    expect(p.map((x) => x.cycle_id)).not.toContain(mAna);
  });

  test("maleta ainda em trânsito para o representante também é aceita; clique repetido não duplica", async () => {
    const r = await ok<{ situacao: string }>(master, "kit_aceite_administrativo", { _cycle: mBia, _motivo: "Consultora confirmou por telefone, conferida" });
    expect(r.situacao).toBe("operacao");
    const d = await ok<{ repetida: boolean }>(master, "kit_aceite_administrativo", { _cycle: mBia, _motivo: "Consultora confirmou por telefone, conferida" });
    expect(d.repetida).toBe(true);
    expect((await um<{ n: number }>(`select count(*)::int n from public.kit_acceptances where cycle_id=$1`, [mBia])).n).toBe(1);
    const l = await ok<{ cycle_id: string }[]>(master, "remessa_aceites_pendentes", { _remessa: remessa });
    expect(l.map((x) => x.cycle_id)).toEqual([mCris]);
  });
});

describe("0325: representante só vê remessa em nome dele", () => {
  test("rep2 (consultora na mesma praça) não vê a remessa do rep", async () => {
    const de = "2000-01-01", ate = "2100-01-01";
    const r1 = await ok<{ id: string }[]>(rep, "rep_remessas", { _rep: rep.partyId, _de: de, _ate: ate });
    const r2 = await ok<{ id: string }[]>(rep2, "rep_remessas", { _rep: rep2.partyId, _de: de, _ate: ate });
    expect(r1.map((x) => x.id)).toContain(remessa);
    expect(r1.map((x) => x.id)).not.toContain(remOutro);
    expect(r2.map((x) => x.id)).toContain(remOutro);
    expect(r2.map((x) => x.id)).not.toContain(remessa);
  });
});

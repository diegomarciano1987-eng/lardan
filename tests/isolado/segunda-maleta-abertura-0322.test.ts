/**
 * 0322 (Diego, 13/11/2026) — a colaboradora da montagem abre uma SEGUNDA maleta para a mesma consultora
 * na mesma remessa, com motivo escrito. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 800000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, montagem: Conta, rep: Conta, ana: Conta, bia: Conta, fora: Conta;
let deposito = "", vA = "", praca = "", outraPraca = "", rem = "";
let primeira = "";

async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}

beforeAll(async () => {
  master = await criarConta({ nome: `s22-master-${base}`, papeis: ["master"], comParty: true });
  montagem = await criarConta({ nome: `s22-mont-${base}`, papeis: ["montagem"], comParty: true });
  rep = await criarConta({ nome: `s22-rep-${base}`, papeis: ["representante"], comParty: true });
  ana = await criarConta({ nome: `s22-ana-${base}`, papeis: ["consultora"], comParty: true });
  bia = await criarConta({ nome: `s22-bia-${base}`, papeis: ["consultora"], comParty: true });
  fora = await criarConta({ nome: `s22-fora-${base}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`s22-${marca}`);
  vA = await criarVariante(`s22-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 50);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`S22 ${marca}`])).linhas[0]!.id;
  outraPraca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`S22b ${marca}`])).linhas[0]!.id;
  for (const [c, p] of [[ana, praca], [bia, praca], [fora, outraPraca]] as const) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
      [c.partyId, rep.partyId, p]);
  }
  const acerto = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  rem = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito, _data_acerto: acerto })).id;
  primeira = (await ok<{ cycle_id: string }>(montagem, "remessa_abrir_maleta", { _remessa: rem, _consultora: ana.partyId })).cycle_id;
  await ok(montagem, "kit_item_upsert", { _cycle: primeira, _variant: vA, _qty: 3 });
});

describe("0322: segunda maleta pela abertura da remessa", () => {
  test("'Abrir maleta' de novo continua levando para a maleta que ela já tem", async () => {
    const r = await ok<{ cycle_id: string; repetida?: boolean }>(montagem, "remessa_abrir_maleta", { _remessa: rem, _consultora: ana.partyId });
    expect(r.repetida).toBe(true);
    expect(r.cycle_id).toBe(primeira);
  });

  test("sem motivo não abre", async () => {
    const r = await rpc(montagem, "remessa_abrir_segunda_maleta", { _remessa: rem, _consultora: ana.partyId, _motivo: "ab" });
    expect(r.erro ?? "").toMatch(/motivo/);
  });

  test("a colaboradora abre a 2ª maleta: outra maleta, mesma remessa, motivo e auditoria", async () => {
    const r = await ok<{ cycle_id: string; repetida?: boolean; primeira_maleta: string }>(montagem, "remessa_abrir_segunda_maleta",
      { _remessa: rem, _consultora: ana.partyId, _motivo: "Vende muito, pediu mais peças para o fim de ano" });
    expect(r.repetida).toBeFalsy();
    expect(r.cycle_id).not.toBe(primeira);
    const c = await um<{ remessa_id: string; consultora_party_id: string; segunda_maleta_motivo: string; status: string }>(
      `select remessa_id, consultora_party_id, segunda_maleta_motivo, status::text from public.kit_cycles where id=$1`, [r.cycle_id]);
    expect(c.remessa_id).toBe(rem);
    expect(c.consultora_party_id).toBe(ana.partyId!);
    expect(c.segunda_maleta_motivo).toBe("Vende muito, pediu mais peças para o fim de ano");
    expect(c.status).toBe("montagem");
    const n = await um<{ n: number }>(`select count(*)::int n from public.kit_cycles where remessa_id=$1 and consultora_party_id=$2 and status<>'cancelada'`, [rem, ana.partyId]);
    expect(n.n).toBe(2);
    const ev = await um<{ n: number }>(`select count(*)::int n from public.kit_events where cycle_id=$1 and kind='maleta.segunda'`, [r.cycle_id]);
    expect(ev.n).toBe(1);
    const au = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='remessa_abrir_segunda_maleta' and payload->>'cycle'=$1`, [r.cycle_id]);
    expect(au.n).toBe(1);
    // a primeira maleta não mudou
    const p = await um<{ q: number; seg: string | null }>(`select (select coalesce(sum(i.quantity),0)::int from public.kit_compositions kc join public.kit_composition_items i on i.composition_id=kc.id where kc.cycle_id=c.id) q,
      c.segunda_maleta_motivo seg from public.kit_cycles c where c.id=$1`, [primeira]);
    expect(p.q).toBe(3);
    expect(p.seg).toBeNull();
    // a 2ª maleta recebe peças normalmente
    await ok(montagem, "kit_item_upsert", { _cycle: r.cycle_id, _variant: vA, _qty: 2 });
  });

  test("clique duplo com a 2ª ainda vazia não cria uma terceira", async () => {
    const outra = await ok<{ cycle_id: string }>(montagem, "remessa_abrir_segunda_maleta", { _remessa: rem, _consultora: ana.partyId, _motivo: "Mais uma para o fim de ano" });
    const dup = await ok<{ cycle_id: string; repetida?: boolean }>(montagem, "remessa_abrir_segunda_maleta", { _remessa: rem, _consultora: ana.partyId, _motivo: "Mais uma para o fim de ano" });
    expect(dup.repetida).toBe(true);
    expect(dup.cycle_id).toBe(outra.cycle_id);
  });

  test("quem ainda não tem maleta usa 'Abrir maleta'", async () => {
    const r = await rpc(montagem, "remessa_abrir_segunda_maleta", { _remessa: rem, _consultora: bia.partyId, _motivo: "Teste sem primeira" });
    expect(r.erro ?? "").toMatch(/ainda não tem maleta/);
  });

  test("consultora de outra praça e conta sem permissão são recusadas", async () => {
    expect((await rpc(montagem, "remessa_abrir_segunda_maleta", { _remessa: rem, _consultora: fora.partyId, _motivo: "Outra praça" })).erro ?? "").toMatch(/praça/);
    expect((await rpc(ana, "remessa_abrir_segunda_maleta", { _remessa: rem, _consultora: ana.partyId, _motivo: "Eu mesma quero" })).erro ?? "").toMatch(/permissão/i);
  });
});

/**
 * 0273/0274 (Diego, 08/11/2026) — o representante pode usar qualquer maleta que está com ele para uma abertura,
 * mesmo já designada a outra consultora (ainda não entregue em mãos). Com nota já emitida em nome da original,
 * a troca vale na hora e a montagem recebe uma pendência fiscal. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 800000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, rep: Conta, repOutro: Conta, joice: Conta, maria: Conta;
let deposito = "", vA = "", praca = "", remessa = "", maletaJoice = "", maletaMaria = "", leadNova = "";

function cpf(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (arr: number[]) => { const s = arr.reduce((a, d, i) => a + d * (arr.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n); const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}
async function lead(nome: string) {
  const doc = cpf();
  return (await um<{ id: string }>(
    `insert into public.leads (full_name, whatsapp, city, uf, privacy_version, stage_id, representante_party_id, cpf, cpf_digits)
     values ($1,'43999997777','Ibaiti','PR','v1',(select id from public.candidatura_stages order by sort_order limit 1),$2,$3,$3) returning id`,
    [nome, rep.partyId, doc])).id;
}
/** maleta da consultora, conferida, entregue ao representante e confirmada por ele (fica "para entregar em mãos"). */
async function maletaComRepresentante(c: Conta) {
  const m = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: c.partyId });
  if (m.erro) throw new Error(m.erro);
  const id = m.dados.cycle_id;
  const it = await rpc(master, "kit_item_upsert", { _cycle: id, _variant: vA, _qty: 2 });
  if (it.erro) throw new Error(it.erro);
  const cf = await rpc(master, "kit_conferir", { _cycle: id, _note: null });
  if (cf.erro) throw new Error(cf.erro);
  const ex = await rpc(master, "remessa_expedir_representante", { _remessa: remessa });
  if (ex.erro) throw new Error(ex.erro);
  const t = await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 and status='transito' order by seq desc limit 1`, [id]);
  const ok = await rpc(rep, "kit_transfer_confirm", { _transfer: t.id, _payload: {} });
  if (ok.erro) throw new Error(ok.erro);
  return id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `tr73-master-${base}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `tr73-rep-${base}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `tr73-rep2-${base}`, papeis: ["representante"], comParty: true });
  joice = await criarConta({ nome: `tr73-joice-${base}`, papeis: ["consultora"], comParty: true });
  maria = await criarConta({ nome: `tr73-maria-${base}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`tr73-${marca}`);
  vA = await criarVariante(`tr73-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 50);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`TR73 ${marca}`])).linhas[0]!.id;
  for (const c of [joice, maria]) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
      [c.partyId, rep.partyId, praca]);
  }
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).dados.id;
  maletaJoice = await maletaComRepresentante(joice);
  maletaMaria = await maletaComRepresentante(maria);
  // nota de remessa já autorizada em nome da Joice
  await adm.unsafe(`insert into public.fiscal_focus_envios (ref, ambiente, operacao, payload, status, numero, chave_nfe, cycle_id, party_id)
                    values ($1,'producao','remessa','{}'::jsonb,'autorizado',95,$2,$3,$4)`,
    [`tr73${marca}`.slice(0, 40), "4".repeat(44), maletaJoice, joice.partyId]);
  leadNova = await lead(`Keteny Teste ${marca}`);
});

describe("maleta designada usada para abertura", () => {
  test("aparece para o representante como 'para entregar em mãos'", async () => {
    const r = await rpc<{ para_entregar: { cycle_id: string }[] }>(rep, "rep_portal_maletas", { _rep: rep.partyId });
    expect(r.erro).toBeNull();
    expect(r.dados.para_entregar.map((m) => m.cycle_id)).toEqual(expect.arrayContaining([maletaJoice, maletaMaria]));
  });

  test("outro representante não pode trocar", async () => {
    const r = await rpc(repOutro, "rep_maleta_trocar_destino", { _rep: rep.partyId, _cycle: maletaJoice, _consultora: null, _lead: leadNova });
    expect(r.ok).toBe(false);
    expect(r.erro ?? "").toMatch(/Sem permissão/);
  });

  test("com nota em nome da Joice: troca vale na hora, vira ABERTURA e a montagem recebe a pendência", async () => {
    const r = await rpc<{ consultora_party_id: string; abertura_numero: number; pendencia_fiscal: boolean; consultora_anterior: string }>(
      rep, "rep_maleta_trocar_destino", { _rep: rep.partyId, _cycle: maletaJoice, _consultora: null, _lead: leadNova });
    expect(r.erro).toBeNull();
    expect(r.dados.pendencia_fiscal).toBe(true);
    expect(r.dados.abertura_numero).toBe(1);
    const c = await um<{ consultora_party_id: string; abertura_numero: number }>(`select consultora_party_id, abertura_numero from public.kit_cycles where id=$1`, [maletaJoice]);
    expect(c.consultora_party_id).toBe(r.dados.consultora_party_id);
    expect(c.consultora_party_id).not.toBe(joice.partyId);
    const p = await um<{ status: string; nota_numero: string; anterior: string }>(
      `select status, nota_numero, consultora_anterior_party_id::text anterior from public.maleta_troca_pendencias where cycle_id=$1`, [maletaJoice]);
    expect(p).toEqual({ status: "aberta", nota_numero: "95", anterior: joice.partyId });
    const a = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='maleta.trocada_para_abertura' and entity_id=$1`, [maletaJoice]);
    expect(a.n).toBe(1);
  });

  test("depois de entregue em mãos, não troca de novo", async () => {
    const l2 = await lead(`Segunda Teste ${marca}`);
    const r = await rpc(rep, "rep_maleta_trocar_destino", { _rep: rep.partyId, _cycle: maletaJoice, _consultora: null, _lead: l2 });
    expect(r.ok).toBe(false);
    expect(r.erro ?? "").toMatch(/já foi entregue em mãos/);
  });

  test("sem nota: troca sem pendência fiscal", async () => {
    const l3 = await lead(`Terceira Teste ${marca}`);
    const r = await rpc<{ pendencia_fiscal: boolean; abertura_numero: number }>(
      rep, "rep_maleta_trocar_destino", { _rep: rep.partyId, _cycle: maletaMaria, _consultora: null, _lead: l3 });
    expect(r.erro).toBeNull();
    expect(r.dados.pendencia_fiscal).toBe(false);
    expect(r.dados.abertura_numero).toBe(2);
    const n = await um<{ n: number }>(`select count(*)::int n from public.maleta_troca_pendencias where cycle_id=$1`, [maletaMaria]);
    expect(n.n).toBe(0);
  });

  test("representante não resolve a pendência; montagem/Master resolve", async () => {
    const p = await um<{ id: string }>(`select id from public.maleta_troca_pendencias where cycle_id=$1`, [maletaJoice]);
    const negado = await rpc(rep, "maleta_troca_pendencia_resolver", { _id: p.id, _obs: null });
    expect(negado.ok).toBe(false);
    const ok = await rpc(master, "maleta_troca_pendencia_resolver", { _id: p.id, _obs: "NF devolução 96, nova 97" });
    expect(ok.erro).toBeNull();
    expect((await um<{ status: string }>(`select status from public.maleta_troca_pendencias where id=$1`, [p.id])).status).toBe("resolvida");
  });
});

/**
 * 0263 — raio-x de integridade (só leitura) e a trava "maleta não vai para cadastro bloqueado/desligado/suspenso"
 * em todos os caminhos, inclusive a maleta de abertura repassada pelo representante.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, rpcServico, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => {
  const row = ((await adm.unsafe(sql, p)) as T[])[0];
  if (row === undefined) throw new Error("A consulta de teste não retornou uma linha");
  return row;
};
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, cons: Conta, rep: Conta, bloq: Conta, susp: Conta;
let deposito = "", vA = "", praca = "", remessa = "";

function cpf(base9: string) {
  const d = base9.split("").map(Number);
  for (const n of [9, 10]) { const s = d.slice(0, n).reduce((a, x, i) => a + x * (n + 1 - i), 0); const r = (s * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join("");
}
async function maletaComRep() {
  const r = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa });
  const c = r.dados.cycle_id;
  await rpc(master, "kit_item_upsert", { _cycle: c, _variant: vA, _qty: 1 });
  await rpc(master, "kit_conferir", { _cycle: c, _note: null });
  await rpc(master, "kit_expedir", { _cycle: c, _payload: { rota: "representante" } });
  const t = await um<{ id: string }>(`select id from kit_transfers where cycle_id=$1 order by seq desc limit 1`, [c]);
  expect((await rpc(rep, "kit_transfer_confirm", { _transfer: t.id, _payload: {} })).erro).toBeNull();
  return c;
}

beforeAll(async () => {
  master = await criarConta({ nome: `a63-master-${marca}`, papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `a63-cons-${marca}`, papeis: ["consultora"], comParty: true });
  bloq = await criarConta({ nome: `a63-bloq-${marca}`, papeis: ["consultora"], comParty: true });
  susp = await criarConta({ nome: `a63-susp-${marca}`, papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: `a63-rep-${marca}`, papeis: ["representante"], comParty: true });
  deposito = await criarDeposito(`a63-${marca}`);
  vA = await criarVariante(`a63-${marca}`, 5000);
  await porEstoque(vA, deposito, 30);
  const pracaRow = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`A63 ${marca}`])).linhas[0];
  if (!pracaRow) throw new Error("Praça de teste não criada");
  praca = pracaRow.id;
  for (const p of [cons, bloq, susp]) {
    await adm.unsafe(`insert into consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`, [p.partyId, rep.partyId, praca]);
  }
  await adm.unsafe(`update parties set status='bloqueado' where id=$1`, [bloq.partyId]);
  await adm.unsafe(`insert into cob_casos (party_id, suspensa, suspensa_motivo) values ($1, true, 'acerto em atraso') on conflict (party_id) do update set suspensa=true, suspensa_motivo='acerto em atraso'`, [susp.partyId]);
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10) })).dados.id;
});

describe("raio-x de integridade", () => {
  test("só Master ou servidor; roda todos os itens sem erro e sem dado pessoal", async () => {
    expect((await rpc(cons, "auditoria_integridade", {})).ok).toBe(false);
    expect((await rpc(rep, "auditoria_integridade", {})).ok).toBe(false);
    expect((await rpc(null, "auditoria_integridade", {})).ok).toBe(false);
    const r = await rpc<{ itens: { codigo: string; erro?: string; quantidade: number; exemplos: string[] }[] }>(master, "auditoria_integridade", {});
    expect(r.erro).toBeNull();
    expect(r.dados.itens.length).toBe(42); // 0282: + F9 · 0316: + F10 e F11 (nota incerta e número pulado)
    expect(r.dados.itens.filter((i) => i.erro)).toEqual([]);
    const texto = JSON.stringify(r.dados);
    const docs = (await adm.unsafe(`select doc_digits d from parties where doc_digits is not null`)) as { d: string }[];
    expect(docs.filter((x) => texto.includes(x.d))).toEqual([]); // nenhum CPF
    expect(texto).not.toMatch(/@/); // nenhum e-mail
    const sv = await rpcServico("auditoria_integridade", {}); expect(sv.erro).toBeNull();
  });
});

describe("maleta não vai para cadastro bloqueado, desligado ou suspenso", () => {
  test("representante não repassa maleta de abertura para consultora bloqueada", async () => {
    const c = await maletaComRep();
    expect((await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: c, _consultora: bloq.partyId })).erro).toMatch(/bloquead/i);
    expect((await um<{ p: string | null }>(`select consultora_party_id p from kit_cycles where id=$1`, [c])).p).toBeNull();
  });

  test("nem para consultora suspensa pela cobrança (antes passava: a trava só olhava a criação)", async () => {
    const c = await maletaComRep();
    expect((await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: c, _consultora: susp.partyId })).erro).toContain("suspensa pela cobrança");
    // consultora em dia continua recebendo normalmente
    expect((await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: c, _consultora: cons.partyId })).erro).toBeNull();
  });

  test("a montagem normal também recusa cadastro bloqueado", async () => {
    expect((await rpc(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: bloq.partyId })).erro).toMatch(/bloquead/i);
    // trocar a consultora de uma maleta montada para alguém bloqueado também é recusado
    const nova = await criarConta({ nome: `a63-nova-${marca}`, papeis: ["consultora"], comParty: true });
    await adm.unsafe(`insert into consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)`, [nova.partyId, rep.partyId, praca]);
    const ok = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: nova.partyId });
    expect(ok.erro).toBeNull();
    const t = await rpc(master, "remessa_maleta_trocar_consultora", { _cycle: ok.dados.cycle_id, _consultora: bloq.partyId, _motivo: "teste de troca" });
    expect(t.ok).toBe(false);
    expect(t.erro).toMatch(/bloqueado ou desligado|bloquead/i);
  });

  test("candidata com CPF de cadastro inativo reaproveita o mesmo cadastro (não duplica CPF)", async () => {
    const doc = cpf(`7${String(Date.now()).slice(-8)}`);
    const antigo = await um<{ id: string }>(`insert into parties (kind, display_name, doc, status, is_active) values ('pessoa','ANTIGA ${marca}',$1,'inativo',false) returning id`, [doc]);
    const lead = await um<{ id: string }>(`insert into leads (full_name, whatsapp, city, uf, privacy_version, stage_id, representante_party_id, cpf, cpf_digits)
      values ($1,'43999990000','Ibiporã','PR','v1',(select id from candidatura_stages order by sort_order limit 1),$2,$3,$3) returning id`, [`Volta ${marca}`, rep.partyId, doc]);
    const c = await maletaComRep();
    const r = await rpc<{ consultora_party_id: string }>(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: c, _lead: lead.id });
    expect(r.erro).toBeNull();
    expect(r.dados.consultora_party_id).toBe(antigo.id);
    expect((await um<{ n: number }>(`select count(*)::int n from parties where doc_digits=$1`, [doc])).n).toBe(1);
  });

  test("abertura na rua com CPF de cadastro desligado é recusada já no cadastro", async () => {
    const doc = cpf(`8${String(Date.now()).slice(-8)}`);
    await adm.unsafe(`insert into parties (kind, display_name, doc, status, is_active) values ('pessoa','DESLIGADA ${marca}',$1,'desligado',false)`, [doc]);
    const r = await rpc(rep, "rep_abertura_rua_cadastrar", { _rep: rep.partyId, _dados: {
      nome: `Maria Teste ${marca}`, cpf: doc, whatsapp: "43999991234", email: `m${marca}@exemplo.com`, nascimento: "1990-01-01", estado_civil: "Solteira",
      rg: "123456789", cep: "86200000", rua: "Rua A", numero: "10", bairro: "Centro", cidade: "Ibiporã", uf: "PR" },
      _perfil: { a: 3, b: 3, c: 3, d: 3 } });
    expect(r.erro).toContain("bloqueado ou desligado");
  });
});

describe("reserva de peça presa em maleta excluída", () => {
  const reservado = async () => (await um<{ r: number }>(`select coalesce(sum(reserved),0)::int r from stock_balances where variant_id=$1 and location_id=$2`, [vA, deposito])).r;
  test("excluir maleta conferida solta a reserva das peças", async () => {
    const antes = await reservado();
    const nova = await criarConta({ nome: `a63-exc-${marca}`, papeis: ["consultora"], comParty: true });
    await adm.unsafe(`insert into consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)`, [nova.partyId, rep.partyId, praca]);
    const c = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: nova.partyId })).dados.cycle_id;
    await rpc(master, "kit_item_upsert", { _cycle: c, _variant: vA, _qty: 2 });
    expect((await rpc(master, "kit_conferir", { _cycle: c, _note: null })).erro).toBeNull();
    expect(await reservado()).toBe(antes + 2);
    expect((await rpc(master, "remessa_maleta_excluir", { _cycle: c, _motivo: "maleta montada errada" })).erro).toBeNull();
    expect(await reservado()).toBe(antes);
  });

  test("reservas que já ficaram presas: prévia não mexe, aplicar solta e é só do Master", async () => {
    const nova = await criarConta({ nome: `a63-presa-${marca}`, papeis: ["consultora"], comParty: true });
    await adm.unsafe(`insert into consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)`, [nova.partyId, rep.partyId, praca]);
    const c = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: nova.partyId })).dados.cycle_id;
    await rpc(master, "kit_item_upsert", { _cycle: c, _variant: vA, _qty: 3 });
    await rpc(master, "kit_conferir", { _cycle: c, _note: null });
    const antes = await reservado();
    await adm.unsafe(`update kit_cycles set status='cancelada', cancelled_at=now() where id=$1`, [c]); // como a exclusão antiga deixava
    expect((await rpc(cons, "estoque_reservas_presas", { _aplicar: false })).ok).toBe(false);
    const p = await rpc<{ reservas: number; unidades: number }>(master, "estoque_reservas_presas", { _aplicar: false });
    expect(p.dados.unidades).toBeGreaterThanOrEqual(3);
    expect(await reservado()).toBe(antes);
    const a = await rpc<{ reservas: number }>(master, "estoque_reservas_presas", { _aplicar: true });
    expect(a.erro).toBeNull();
    expect(await reservado()).toBe(antes - 3);
    expect((await rpc<{ reservas: number }>(master, "estoque_reservas_presas", { _aplicar: false })).dados.reservas).toBe(0);
  });
});

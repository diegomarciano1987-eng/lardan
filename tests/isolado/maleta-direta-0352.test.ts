/**
 * 0352 (Diego, 19/11/2026) — "Nova maleta" direta. Banco ISOLADO, dados sintéticos.
 *  - abre sem representante: só consultora, data de acerto (obrigatória) e responsável (colaborador da Lardan);
 *  - a praça é a da consultora; sem praça, pede a praça e grava só nela (nunca troca quem já tem);
 *  - clique duplo devolve a mesma maleta; representante/consultora não abrem; responsável tem de ser da equipe;
 *  - na lista de remessas aparece "Maleta direta · Resp. ...".
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const dia = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

let master: Conta, resp: Conta, rep: Conta, comPraca: Conta, semPraca: Conta;
let deposito = "", praca = "", pracaB = "";

beforeAll(async () => {
  master = await criarConta({ nome: `md-master-${marca}`, papeis: ["master"], comParty: true });
  resp = await criarConta({ nome: `md-resp-${marca} Daniel`, papeis: ["estoque"], comParty: true });
  rep = await criarConta({ nome: `md-rep-${marca}`, papeis: ["representante"], comParty: true });
  comPraca = await criarConta({ nome: `md-cons-${marca} Ana`, papeis: ["consultora"], comParty: true });
  semPraca = await criarConta({ nome: `md-cons-${marca} Bia`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`md-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça MD ${marca}`])).linhas[0]!.id;
  pracaB = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça MD B ${marca}`])).linhas[0]!.id;
  for (const c of [comPraca, semPraca]) {
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
    await adm.unsafe(`update public.parties set status='ativo' where id=$1`, [c.partyId]);
  }
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id, representative_party_id) values ($1,$2,$3)
    on conflict (party_id) do update set praca_id=excluded.praca_id, representative_party_id=excluded.representative_party_id`, [comPraca.partyId, praca, rep.partyId]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,null)
    on conflict (party_id) do update set praca_id=null`, [semPraca.partyId]);
});

describe("0352 — Nova maleta direta", () => {
  test("abre sem representante, com acerto, responsável e a praça da consultora", async () => {
    const r = await rpc<{ cycle_id: string; remessa_id: string; remessa_numero: number }>(master, "maleta_direta_abrir", {
      _consultora: comPraca.partyId, _data_acerto: dia(30), _responsavel: resp.uid, _deposito: deposito });
    expect(r.erro).toBeNull();
    const rem = await um<Record<string, unknown>>(`select praca_id, representante_party_id, direta, responsavel_user_id, data_acerto::text acerto from public.remessas where id=$1`, [r.dados.remessa_id]);
    expect(rem).toEqual({ praca_id: praca, representante_party_id: null, direta: true, responsavel_user_id: resp.uid, acerto: dia(30) });
    const k = await um<Record<string, unknown>>(`select remessa_id, consultora_party_id, representante_party_id from public.kit_cycles where id=$1`, [r.dados.cycle_id]);
    expect(k).toEqual({ remessa_id: r.dados.remessa_id, consultora_party_id: comPraca.partyId, representante_party_id: null });
    // clique duplo: mesma maleta, nenhuma remessa nova
    const de_novo = await rpc<{ cycle_id: string; repetida: boolean }>(master, "maleta_direta_abrir", {
      _consultora: comPraca.partyId, _data_acerto: dia(30), _responsavel: resp.uid, _deposito: deposito });
    expect(de_novo.dados).toMatchObject({ cycle_id: r.dados.cycle_id, repetida: true });
    expect((await um<{ n: number }>(`select count(*)::int n from public.remessas where direta and praca_id=$1`, [praca])).n).toBe(1);
    // lista de remessas mostra o responsável no lugar do representante
    const l = await ler<{ representante: string }>(master, `select representante from public.remessas_lista(null) where id=$1`, [r.dados.remessa_id]);
    expect(l.linhas[0]!.representante).toMatch(new RegExp(`^Maleta direta · Resp\\. .*md-resp-${marca} Daniel$`));
  });

  test("sem data de acerto ou sem responsável da equipe, recusa", async () => {
    expect((await rpc(master, "maleta_direta_abrir", { _consultora: comPraca.partyId, _data_acerto: null, _responsavel: resp.uid })).erro).toContain("data de acerto");
    expect((await rpc(master, "maleta_direta_abrir", { _consultora: comPraca.partyId, _data_acerto: dia(20), _responsavel: rep.uid })).erro).toContain("responsável");
    expect((await rpc(master, "maleta_direta_abrir", { _consultora: comPraca.partyId, _data_acerto: dia(-1), _responsavel: resp.uid })).erro).toContain("passado");
  });

  test("consultora sem praça: pede a praça e grava só nela", async () => {
    expect((await rpc(master, "maleta_direta_abrir", { _consultora: semPraca.partyId, _data_acerto: dia(25), _responsavel: master.uid })).erro).toContain("escolha a praça");
    const r = await rpc<{ remessa_id: string }>(master, "maleta_direta_abrir", {
      _consultora: semPraca.partyId, _data_acerto: dia(25), _responsavel: master.uid, _praca: pracaB, _tipo_envio: "correio", _deposito: deposito });
    expect(r.erro).toBeNull();
    expect((await um<{ p: string }>(`select praca_id p from public.consultant_profiles where party_id=$1`, [semPraca.partyId])).p).toBe(pracaB);
    expect((await um<{ t: string; p: string }>(`select tipo_envio t, praca_id p from public.remessas where id=$1`, [r.dados.remessa_id]))).toEqual({ t: "correio", p: pracaB });
  });

  test("representante e consultora não abrem; buscas só para a equipe", async () => {
    expect((await rpc(rep, "maleta_direta_abrir", { _consultora: comPraca.partyId, _data_acerto: dia(30), _responsavel: resp.uid })).erro).toContain("Sem permissão");
    expect((await rpc(comPraca, "maleta_direta_abrir", { _consultora: comPraca.partyId, _data_acerto: dia(30), _responsavel: resp.uid })).erro).toContain("Sem permissão");
    const busca = `select party_id from public.maleta_direta_consultoras($1)`;
    expect((await ler<{ party_id: string }>(rep, busca, [`md-cons-${marca}`])).linhas).toEqual([]);
    const achou = await ler<{ party_id: string }>(master, busca, [`md-cons-${marca}`]);
    expect(achou.linhas.map((x) => x.party_id).sort()).toEqual([comPraca.partyId, semPraca.partyId].sort());
    expect((await ler<{ user_id: string }>(rep, `select user_id from public.maleta_direta_responsaveis()`)).linhas).toEqual([]);
    const ids = (await ler<{ user_id: string }>(master, `select user_id from public.maleta_direta_responsaveis()`)).linhas.map((x) => x.user_id);
    expect(ids).toContain(resp.uid);
    expect(ids).not.toContain(rep.uid);
    expect(ids).not.toContain(comPraca.uid);
  });
});

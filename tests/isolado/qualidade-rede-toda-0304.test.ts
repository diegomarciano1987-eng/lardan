/**
 * 0304 (Diego, 13/11/2026) — a gerente da Qualidade (colaboradora por código com Trocas e garantias em "alterar")
 * confere maletas de TODAS as consultoras. Antes: "Maleta fora da carteira." ao confirmar a chegada de uma maleta
 * do Marcelo, porque o cadastro dela (Tatiane 1006) está ligado ao Daniel.
 * Colaboradora sem o módulo continua presa à carteira; estoque continua fechado para toda colaboradora.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, rpcServico, type Conta } from "./base";
import { COLAB_MODULOS, capsDeEscolha } from "../../src/lib/colab-modulos";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 304000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, repDaniel: Conta, repMarcelo: Conta, tatiane: Conta, montagem: Conta, consultora: Conta;
let maleta = "", vA = "", deposito = "";

async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}
async function colab(c: Conta, cod: string, modulos: Record<string, "ver" | "alterar">) {
  await adm.unsafe(`insert into public.consultant_profiles(party_id,representative_party_id) values ($1,$2)
                    on conflict(party_id) do update set representative_party_id=excluded.representative_party_id`, [c.partyId, repDaniel.partyId]);
  expect((await rpcServico("colab_acesso_registrar", { _user_id: c.uid, _party_id: c.partyId, _codigo: cod, _actor: master.uid })).erro).toBeNull();
  const esc = Object.fromEntries(COLAB_MODULOS.map((m) => [m.id, modulos[m.id] ?? "nao"])) as Record<string, "ver" | "alterar" | "nao">;
  expect((await rpcServico("colab_modulos_definir", { _user_id: c.uid, _caps: capsDeEscolha(esc), _financeiro: false, _actor: master.uid })).erro).toBeNull();
}
const transitoPara = async (cycle: string, para: string) =>
  um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 and status='transito' and to_party_id=$2 order by seq desc limit 1`, [cycle, para]);
const codigo = async (cycle: string) => (await um<{ code: string }>(`select k.code from public.kit_cycles c join public.kits k on k.id=c.kit_id where c.id=$1`, [cycle])).code;

beforeAll(async () => {
  master = await criarConta({ nome: `q304-master-${base}`, papeis: ["master"], comParty: true });
  repDaniel = await criarConta({ nome: `q304-daniel-${base}`, papeis: ["representante"], comParty: true });
  repMarcelo = await criarConta({ nome: `q304-marcelo-${base}`, papeis: ["representante"], comParty: true });
  tatiane = await criarConta({ nome: `q304-tatiane-${base}`, papeis: [], comParty: true });
  montagem = await criarConta({ nome: `q304-montagem-${base}`, papeis: [], comParty: true });
  consultora = await criarConta({ nome: `q304-cons-${base}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante'),($2,'representante'),($3,'colaborador'),($4,'colaborador') on conflict do nothing`,
    [repDaniel.partyId, repMarcelo.partyId, tatiane.partyId, montagem.partyId]);
  deposito = await criarDeposito(`q304-${marca}`);
  vA = await criarVariante(`q304-${marca}`, 10000);
  await porEstoque(vA, deposito, 10);
  const praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Q304 ${marca}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                    on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
    [consultora.partyId, repMarcelo.partyId, praca]);
  const acerto = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  const rem = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: repMarcelo.partyId, _deposito: deposito, _data_acerto: acerto })).id;
  maleta = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: consultora.partyId })).cycle_id;
  await ok(master, "kit_item_upsert", { _cycle: maleta, _variant: vA, _qty: 3 });
  await ok(master, "kit_conferir", { _cycle: maleta, _note: null });
  await ok(master, "remessa_expedir_representante", { _remessa: rem });
  await ok(repMarcelo, "kit_transfer_confirm", { _transfer: (await transitoPara(maleta, repMarcelo.partyId!)).id, _payload: {} });
  await ok(repMarcelo, "kit_transfer_forward", { _cycle: maleta, _payload: { note: "Entregue em mãos" } });
  await ok(consultora, "kit_transfer_confirm", { _transfer: (await transitoPara(maleta, consultora.partyId!)).id, _payload: {} });
  await ok(consultora, "kit_aceitar", { _cycle: maleta, _itens: [{ variant_id: vA, qty_accepted: 3, qty_divergent: 0 }], _idempotency_key: `q304-${marca}` });
  await ok(repMarcelo, "rep_acerto_campo_devolucao", { _cycle: maleta, _leituras: [{ variant_id: vA, qtd: 3 }] });
  await ok(repMarcelo, "pre_baixa_fechar", { _cycle: maleta });
  // Tatiane: Qualidade "alterar" + os mesmos módulos de maleta/cadastro que ela tem hoje
  await colab(tatiane, String(30400000 + base).slice(-8), { qualidade: "alterar", maletas: "alterar", cadastros: "alterar" });
  await colab(montagem, String(40400000 + base).slice(-8), { maletas: "alterar" });
});

describe("1. Tatiane (gerente da Qualidade) confere maleta de qualquer representante", () => {
  test("antes da chegada: a colaboradora da montagem sem Qualidade não confirma (só a carteira do Daniel)", async () => {
    const r = await rpc(montagem, "retorno_receber", { _codigo: await codigo(maleta) });
    expect(r.erro ?? "").toMatch(/fora da carteira|alcance|montagem ou a Qualidade/);
  });

  test("confirma a chegada da maleta do Marcelo pelo código (sem 'Maleta fora da carteira')", async () => {
    const r = await ok<{ motivo: string; pecas: number; precisa_conferir: boolean }>(tatiane, "retorno_receber", { _codigo: await codigo(maleta) });
    expect(r).toMatchObject({ motivo: "acerto", pecas: 3, precisa_conferir: true });
    const ev = await um<{ n: number }>(`select count(*)::int n from public.kit_events where cycle_id=$1 and kind='retorno.recebido' and actor_user_id=$2`, [maleta, tatiane.uid]);
    expect(ev.n).toBe(1);
  });

  test("confere as peças do acerto e fecha a conferência", async () => {
    const c = await ok<{ status: string }>(tatiane, "pre_baixa_conferir", { _cycle: maleta, _leituras: [{ variant_id: vA, qtd: 3 }], _aplicar: true });
    expect(["conferida", "pendencia"]).toContain(c.status);
  });

  test("vê o cadastro da consultora do Marcelo e a remessa dele", async () => {
    const p = await ler<{ n: number }>(tatiane, `select count(*)::int n from public.parties where id=$1`, [consultora.partyId]);
    expect(p.linhas[0]!.n).toBe(1);
    const k = await ler<{ n: number }>(tatiane, `select count(*)::int n from public.kit_cycles where id=$1`, [maleta]);
    expect(k.linhas[0]!.n).toBe(1);
  });

  test("escopo da tela: continua colaboradora, mas sem trava de representante", async () => {
    const e = await ok<{ colaboradora: boolean; rede_toda: boolean }>(tatiane, "colab_meu_escopo", {});
    expect(e).toMatchObject({ colaboradora: true, rede_toda: true });
    const m = await ok<{ colaboradora: boolean; rede_toda: boolean }>(montagem, "colab_meu_escopo", {});
    expect(m).toMatchObject({ colaboradora: true, rede_toda: false });
  });
});

describe("2. o que NÃO muda", () => {
  test("colaboradora sem Qualidade continua sem ver a consultora do Marcelo", async () => {
    const p = await ler<{ n: number }>(montagem, `select count(*)::int n from public.parties where id=$1`, [consultora.partyId]);
    expect(p.linhas[0]!.n).toBe(0);
  });

  test("estoque continua fechado para a Tatiane (locais e visão geral do estoque)", async () => {
    const l = await ler<{ n: number }>(tatiane, `select count(*)::int n from public.locations`);
    expect(l.ok ? l.linhas[0]!.n : 0).toBe(0);
    expect((await rpc(tatiane, "catalog_overview", {})).erro ?? "").toMatch(/indisponível para colaboradora/);
    expect(await ok<boolean>(tatiane, "has_capability", { _user_id: tatiane.uid, _cap: "stock.view" })).toBe(false);
  });

  test("acesso desligado: a Tatiane volta a ficar presa à carteira na hora", async () => {
    await adm.unsafe(`update public.colab_acessos set ativo=false where user_id=$1`, [tatiane.uid]);
    const p = await ler<{ n: number }>(tatiane, `select count(*)::int n from public.parties where id=$1`, [consultora.partyId]);
    expect(p.ok ? p.linhas[0]!.n : 0).toBe(0);
    await adm.unsafe(`update public.colab_acessos set ativo=true where user_id=$1`, [tatiane.uid]);
  });
});

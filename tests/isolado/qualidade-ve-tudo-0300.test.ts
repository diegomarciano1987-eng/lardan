/**
 * 0300 item 1 (Diego, 12/11/2026) — colaboradora da Qualidade (por código, ligada à carteira de um representante)
 * vê as maletas que precisam voltar de QUALQUER representante; colaboradora sem o módulo segue presa à carteira.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, rpcServico, type Conta } from "./base";
import { COLAB_MODULOS, capsDeEscolha } from "../../src/lib/colab-modulos";

const base = 300000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, repDaniel: Conta, repMarcelo: Conta, tatiane: Conta, outraColab: Conta, consultora: Conta;
let maletaMarcelo = "";

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

beforeAll(async () => {
  master = await criarConta({ nome: `q300-master-${base}`, papeis: ["master"], comParty: true });
  repDaniel = await criarConta({ nome: `q300-daniel-${base}`, papeis: ["representante"], comParty: true });
  repMarcelo = await criarConta({ nome: `q300-marcelo-${base}`, papeis: ["representante"], comParty: true });
  tatiane = await criarConta({ nome: `q300-tatiane-${base}`, papeis: [], comParty: true });
  outraColab = await criarConta({ nome: `q300-montagem-${base}`, papeis: [], comParty: true });
  consultora = await criarConta({ nome: `q300-cons-${base}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante'),($2,'representante'),($3,'colaborador'),($4,'colaborador') on conflict do nothing`,
    [repDaniel.partyId, repMarcelo.partyId, tatiane.partyId, outraColab.partyId]);
  const deposito = await criarDeposito(`q300-${marca}`);
  const v = await criarVariante(`q300-${marca}`, 10000);
  await porEstoque(v, deposito, 10);
  const praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Q300 ${marca}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                    on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
    [consultora.partyId, repMarcelo.partyId, praca]);
  const acerto = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  const rem = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: repMarcelo.partyId, _deposito: deposito, _data_acerto: acerto })).id;
  maletaMarcelo = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: consultora.partyId })).cycle_id;
  await ok(master, "kit_item_upsert", { _cycle: maletaMarcelo, _variant: v, _qty: 2 });
  await ok(master, "kit_conferir", { _cycle: maletaMarcelo, _note: null });
  await ok(master, "remessa_expedir_representante", { _remessa: rem });
  await colab(tatiane, String(30000000 + base).slice(-8), { qualidade: "alterar" });
  await colab(outraColab, String(40000000 + base).slice(-8), { maletas: "ver" });
});

describe("Qualidade vê o retorno de todos os representantes", () => {
  test("Tatiane (Qualidade, carteira do Daniel) enxerga a maleta do Marcelo", async () => {
    expect((await ok<boolean>(tatiane, "retorno_ciclo_alcance", { _cycle: maletaMarcelo }))).toBe(true);
    const p = await ok<{ com_representantes: { representante_party_id: string; quantidade: number }[] }>(tatiane, "retorno_painel", {});
    expect(p.com_representantes.find((x) => x.representante_party_id === repMarcelo.partyId)?.quantidade).toBe(1);
  });

  test("colaboradora sem o módulo da Qualidade continua só na carteira do Daniel", async () => {
    expect((await ok<boolean>(outraColab, "retorno_ciclo_alcance", { _cycle: maletaMarcelo }))).toBe(false);
  });

  test("acesso de colaboradora desligado: perde a visão na hora", async () => {
    await adm.unsafe(`update public.colab_acessos set ativo=false where user_id=$1`, [tatiane.uid]);
    expect((await ok<boolean>(tatiane, "retorno_ciclo_alcance", { _cycle: maletaMarcelo }))).toBe(false);
    await adm.unsafe(`update public.colab_acessos set ativo=true where user_id=$1`, [tatiane.uid]);
  });
});

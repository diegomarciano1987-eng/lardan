/**
 * 0356 (Diego, 19/11/2026) — "Nova maleta" (direta) para TODAS as colaboradoras. Banco ISOLADO, dados sintéticos.
 *  - colaboradora de carteira (kit.manage) busca a consultora, escolhe o responsável e abre a maleta direta;
 *  - ela mesma bipa, confere e expede: montagem normal;
 *  - outra colaboradora (outra carteira) também enxerga e opera a maleta direta (é da operação geral);
 *  - a carteira continua valendo: maleta de outro representante segue fora;
 *  - só com "ver" (kit.view) não abre;
 *  - o relatório de acertos marca a maleta como direta (vai para "Geral") e traz as chaves de praça e representante.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, rpcServico, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const dia = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const cod = () => String(Math.floor(10000000 + Math.random() * 80000000));

let master: Conta, repA: Conta, repB: Conta, colabA: Conta, colabB: Conta, soVer: Conta, resp: Conta, bia: Conta, fora: Conta;
let deposito = "", praca = "", variante = "", ciclo = "", remessa = "", numero = 0, cicloFora = "";

async function colab(c: Conta, rep: Conta, caps: string[]) {
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'colaborador') on conflict do nothing`, [c.partyId]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id) values ($1,$2)
    on conflict (party_id) do update set representative_party_id=excluded.representative_party_id`, [c.partyId, rep.partyId]);
  expect((await rpcServico("colab_acesso_registrar", { _user_id: c.uid, _party_id: c.partyId, _codigo: cod(), _actor: master.uid })).erro).toBeNull();
  expect((await rpcServico("colab_modulos_definir", { _user_id: c.uid, _caps: caps, _financeiro: false, _actor: master.uid })).erro).toBeNull();
}

beforeAll(async () => {
  master = await criarConta({ nome: `mdc-master-${marca}`, papeis: ["master"], comParty: true });
  repA = await criarConta({ nome: `mdc-repA-${marca}`, papeis: ["representante"], comParty: true });
  repB = await criarConta({ nome: `mdc-repB-${marca}`, papeis: ["representante"], comParty: true });
  colabA = await criarConta({ nome: `mdc-colabA-${marca}`, papeis: [], comParty: true });
  colabB = await criarConta({ nome: `mdc-colabB-${marca}`, papeis: [], comParty: true });
  soVer = await criarConta({ nome: `mdc-ver-${marca}`, papeis: [], comParty: true });
  resp = await criarConta({ nome: `mdc-resp-${marca}`, papeis: ["estoque"], comParty: true });
  bia = await criarConta({ nome: `mdc-bia-${marca}`, papeis: ["consultora"], comParty: true });
  fora = await criarConta({ nome: `mdc-fora-${marca}`, papeis: ["consultora"], comParty: true });
  await colab(colabA, repA, ["kit.view", "kit.manage"]);
  await colab(colabB, repB, ["kit.view", "kit.manage"]);
  await colab(soVer, repA, ["kit.view"]);
  deposito = await criarDeposito(`mdc-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça MDC ${marca}`])).linhas[0]!.id;
  for (const c of [bia, fora]) {
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
    await adm.unsafe(`update public.parties set status='ativo' where id=$1`, [c.partyId]);
  }
  // Bia: sem representante (fora de qualquer carteira). Fora: carteira do repB.
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id, representative_party_id=null`, [bia.partyId, praca]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id, representative_party_id) values ($1,$2,$3) on conflict (party_id) do update set praca_id=excluded.praca_id, representative_party_id=excluded.representative_party_id`, [fora.partyId, praca, repB.partyId]);
  variante = await criarVariante(`mdc-${marca}`, 4990);
  await porEstoque(variante, deposito, 10);
  const r = await rpc<{ cycle_id: string }>(master, "kit_cycle_create", { _payload: { origin_location_id: deposito, representante_party_id: repB.partyId, consultora_party_id: fora.partyId } });
  if (r.erro) throw new Error(r.erro);
  cicloFora = r.dados.cycle_id;
});

describe("0356 — Nova maleta para toda colaboradora", () => {
  test("colaboradora de carteira acha a consultora e o responsável", async () => {
    const achadas = await ler<{ party_id: string }>(colabA, `select party_id from public.maleta_direta_consultoras($1)`, [`mdc-bia-${marca}`]);
    expect(achadas.erro).toBeNull();
    expect(achadas.linhas.map((x) => x.party_id)).toContain(bia.partyId);
    const resps = await ler<{ user_id: string }>(colabA, `select user_id from public.maleta_direta_responsaveis()`);
    expect(resps.erro).toBeNull();
    expect(resps.linhas.map((x) => x.user_id)).toContain(resp.uid);
  });

  test("abre a maleta direta, bipa, confere e expede (montagem normal)", async () => {
    const r = await rpc<{ cycle_id: string; remessa_id: string; remessa_numero: number }>(colabA, "maleta_direta_abrir", {
      _consultora: bia.partyId, _data_acerto: dia(20), _responsavel: resp.uid, _deposito: deposito });
    expect(r.erro).toBeNull();
    ({ cycle_id: ciclo, remessa_id: remessa, remessa_numero: numero } = r.dados);
    const rem = (await adm.unsafe(`select direta, representante_party_id from public.remessas where id=$1`, [remessa]))[0];
    expect(rem).toEqual({ direta: true, representante_party_id: null });
    for (let i = 0; i < 3; i++) {
      const b = await rpc<{ quantidade: number }>(colabA, "montagem_item_operar", { _cycle: ciclo, _variant: variante, _delta: 1, _origem: "bipagem", _operacao: crypto.randomUUID() });
      expect(b.erro).toBeNull();
      expect(b.dados.quantidade).toBe(i + 1);
    }
    expect((await rpc(colabA, "kit_conferir", { _cycle: ciclo, _note: null })).erro).toBeNull();
    expect((await rpc(colabA, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } })).erro).toBeNull();
    const k = (await adm.unsafe(`select status::text, quantity_total from public.kit_cycles where id=$1`, [ciclo]))[0];
    expect(k).toEqual({ status: "transito", quantity_total: 3 });
  });

  test("a remessa direta aparece na lista e no detalhe, com o nome da consultora", async () => {
    const l = await ler<{ id: string }>(colabA, `select id from public.remessas_buscar(_busca=>$1)`, [String(numero)]);
    expect(l.erro).toBeNull();
    expect(l.linhas.map((x) => x.id)).toContain(remessa);
    const m = await ler<{ consultora: string }>(colabA, `select consultora from public.remessa_maletas($1)`, [remessa]);
    expect(m.linhas.map((x) => x.consultora)).toEqual([`ISO mdc-bia-${marca}`]);
    expect((await ler<{ ok: boolean }>(colabA, `select public.kit_cycle_in_scope($1) ok`, [ciclo])).linhas[0]!.ok).toBe(true);
  });

  test("outra colaboradora (outra carteira) também vê a maleta direta", async () => {
    const m = await ler<{ cycle_id: string }>(colabB, `select cycle_id from public.remessa_maletas($1)`, [remessa]);
    expect(m.linhas.map((x) => x.cycle_id)).toEqual([ciclo]);
  });

  test("a carteira continua valendo: maleta de outro representante segue fora", async () => {
    expect((await ler<{ ok: boolean }>(colabA, `select public.kit_cycle_in_scope($1) ok`, [cicloFora])).linhas[0]!.ok).toBe(false);
    expect((await ler<{ ok: boolean }>(colabA, `select public.colab_party_ok($1) ok`, [fora.partyId])).linhas[0]!.ok).toBe(false);
    expect((await ler<{ ok: boolean }>(colabB, `select public.kit_cycle_in_scope($1) ok`, [cicloFora])).linhas[0]!.ok).toBe(true);
  });

  test("só com permissão de ver não abre maleta", async () => {
    const r = await rpc(soVer, "maleta_direta_abrir", { _consultora: bia.partyId, _data_acerto: dia(25), _responsavel: resp.uid, _deposito: deposito });
    expect(r.erro).toContain("Sem permissão");
  });

  test("relatório: maleta direta marcada (vai para Geral); colaboradora vê", async () => {
    const r = await rpc<{ linhas: { consultora: string; direta: boolean; praca_id: string; rep_id: string | null; representante: string }[] }>(colabA, "acertos_relatorio", { _de: dia(0), _ate: dia(30) });
    expect(r.erro).toBeNull();
    const l = r.dados.linhas.find((x) => x.consultora === `ISO mdc-bia-${marca}`);
    expect(l).toMatchObject({ direta: true, praca_id: praca, rep_id: null, representante: "Maleta direta" });
  });
});

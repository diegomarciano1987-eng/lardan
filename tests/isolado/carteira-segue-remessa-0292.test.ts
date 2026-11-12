/**
 * 0292 (Daniel/Diego, 12/11/2026) — passar a maleta para a remessa de outro representante leva a
 * consultora para a carteira e a praça dele; a colaboradora que monta a remessa vê todas as maletas.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, rpcServico, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 700000 + Math.floor(Math.random() * 90000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, repDaniel: Conta, repGui: Conta, colabGui: Conta, arlete: Conta, bloqueada: Conta;
let deposito = "", vA = "", pracaRol = "", pracaAra = "", remDaniel = "", remGui = "", mArlete = "", mBloq = "";

async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}
const perfil = (party: string) =>
  um<{ representative_party_id: string; praca_id: string }>(`select representative_party_id, praca_id from public.consultant_profiles where party_id=$1`, [party]);

beforeAll(async () => {
  master = await criarConta({ nome: `c92-master-${base}`, papeis: ["master"], comParty: true });
  repDaniel = await criarConta({ nome: `c92-repd-${base}`, papeis: ["representante"], comParty: true });
  repGui = await criarConta({ nome: `c92-repg-${base}`, papeis: ["representante"], comParty: true });
  colabGui = await criarConta({ nome: `c92-viviane-${base}`, papeis: [], comParty: true });
  arlete = await criarConta({ nome: `c92-arlete-${base}`, papeis: ["consultora"], comParty: true });
  bloqueada = await criarConta({ nome: `c92-bloq-${base}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`c92-${marca}`);
  vA = await criarVariante(`c92-a-${marca}`, 10000);
  await porEstoque(vA, deposito, 30);
  pracaRol = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`C92 Rol ${marca}`])).linhas[0]!.id;
  pracaAra = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`C92 Ara ${marca}`])).linhas[0]!.id;
  const vinc = (p: string | null, rep: string | null, praca: string | null) =>
    adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`, [p, rep, praca]);
  await vinc(arlete.partyId, repDaniel.partyId, pracaRol);
  await vinc(bloqueada.partyId, repDaniel.partyId, pracaRol);
  await vinc(colabGui.partyId, repGui.partyId, pracaAra);
  await adm.unsafe("insert into party_roles(party_id,role) values ($1,'colaborador')", [colabGui.partyId]);
  expect((await rpcServico("colab_acesso_registrar", { _user_id: colabGui.uid, _party_id: colabGui.partyId, _codigo: String(80000000 + (base % 1000000)), _actor: master.uid })).erro).toBeNull();
  expect((await rpcServico("colab_modulos_definir", { _user_id: colabGui.uid, _caps: ["registry.view", "kit.view", "kit.manage"], _financeiro: false, _actor: master.uid })).erro).toBeNull();
  const acerto = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  remDaniel = (await ok<{ id: string }>(master, "remessa_criar", { _praca: pracaRol, _representante: repDaniel.partyId, _deposito: deposito, _data_acerto: acerto(60) })).id;
  remGui = (await ok<{ id: string }>(master, "remessa_criar", { _praca: pracaAra, _representante: repGui.partyId, _deposito: deposito, _data_acerto: acerto(75) })).id;
  const montar = async (c: Conta) => {
    const id = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remDaniel, _consultora: c.partyId })).cycle_id;
    await ok(master, "kit_item_upsert", { _cycle: id, _variant: vA, _qty: 2 });
    await ok(master, "kit_conferir", { _cycle: id, _note: null });
    return id;
  };
  mArlete = await montar(arlete);
  mBloq = await montar(bloqueada);
});

describe("trocar a remessa leva a consultora para a carteira do novo representante", () => {
  test("representante e praça da consultora passam a ser os da remessa de destino, com auditoria", async () => {
    const r = await ok<{ carteira_mudou: boolean }>(master, "remessa_maleta_mudar_remessa", { _cycle: mArlete, _remessa: remGui, _motivo: "Guilherme vai atender a Arlete" });
    expect(r.carteira_mudou).toBe(true);
    expect(await perfil(arlete.partyId!)).toEqual({ representative_party_id: repGui.partyId!, praca_id: pracaAra });
    const a = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='consultora.carteira_seguiu_maleta' and entity_id=$1`, [arlete.partyId]);
    expect(a.n).toBe(1);
  });

  test("a colaboradora do novo representante vê a maleta com o nome da consultora", async () => {
    const r = await ler<{ cycle_id: string; consultora: string }>(colabGui, `select cycle_id, consultora from public.remessa_maletas($1)`, [remGui]);
    expect(r.erro).toBeNull();
    expect(r.linhas.find((x) => x.cycle_id === mArlete)?.consultora).toBe(`ISO c92-arlete-${base}`);
  });

  test("a colaboradora vê a maleta da remessa mesmo se o cadastro ainda é de outra carteira", async () => {
    await adm.unsafe(`update public.consultant_profiles set representative_party_id=$2, praca_id=$3 where party_id=$1`, [arlete.partyId, repDaniel.partyId, pracaRol]);
    const r = await ler<{ cycle_id: string }>(colabGui, `select cycle_id from public.remessa_maletas($1)`, [remGui]);
    expect(r.linhas.map((x) => x.cycle_id)).toContain(mArlete);
    const fora = await ler<{ cycle_id: string }>(colabGui, `select cycle_id from public.remessa_maletas($1)`, [remDaniel]);
    expect(fora.linhas.map((x) => x.cycle_id)).not.toContain(mBloq);
  });

  test("consultora bloqueada não muda de carteira", async () => {
    await adm.unsafe(`update public.parties set status='bloqueado' where id=$1`, [bloqueada.partyId]);
    const r = await ok<{ carteira_mudou: boolean }>(master, "remessa_maleta_mudar_remessa", { _cycle: mBloq, _remessa: remGui, _motivo: "teste bloqueada" });
    expect(r.carteira_mudou).toBe(false);
    expect((await perfil(bloqueada.partyId!)).representative_party_id).toBe(repDaniel.partyId!);
  });

  test("a rotina interna não pode ser chamada pela tela", async () => {
    const r = await rpc(master, "consultora_carteira_seguir", { _party: arlete.partyId, _rep: repGui.partyId, _praca: pracaAra, _cycle: mArlete, _origem: "x" });
    expect(r.erro).not.toBeNull();
  });
});

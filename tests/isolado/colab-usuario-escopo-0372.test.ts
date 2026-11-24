import { beforeAll, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, rpcServico, type Conta } from "./base";

// 0372: login por nome de acesso + praças/representantes liberados pelo Master
let master: Conta, colab: Conta, repA: Conta, repB: Conta, consA: Conta, consB: Conta, consPraca: Conta;
const seed = Math.floor(Math.random() * 1000000);
const codigo = String(80000000 + seed);
let praca: string;
beforeAll(async () => {
  master = await criarConta({ nome: `esc-master-${seed}`, papeis: ["master"], comParty: true });
  repA = await criarConta({ nome: `esc-repa-${seed}`, papeis: ["representante"], comParty: true });
  repB = await criarConta({ nome: `esc-repb-${seed}`, papeis: ["representante"], comParty: true });
  colab = await criarConta({ nome: `Ketllin de Souza ${seed}`, papeis: [], comParty: true });
  consA = await criarConta({ nome: `esc-consa-${seed}`, papeis: ["consultora"], comParty: true });
  consB = await criarConta({ nome: `esc-consb-${seed}`, papeis: ["consultora"], comParty: true });
  consPraca = await criarConta({ nome: `esc-consp-${seed}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe("insert into party_roles(party_id,role) values ($1,'colaborador')", [colab.partyId]);
  for (const r of [repA, repB]) await adm.unsafe("insert into party_roles(party_id,role) values ($1,'representante') on conflict do nothing", [r.partyId]);
  praca = (await adm.unsafe("insert into cob_pracas(codigo,nome) values ($1,$2) returning id", [900000 + (seed % 90000), `Praça ${seed}`]))[0].id;
  for (const [p, r, pr] of [[colab.partyId, repA.partyId, null], [consA.partyId, repA.partyId, null], [consB.partyId, repB.partyId, null], [consPraca.partyId, null, praca]]) {
    await adm.unsafe("insert into consultant_profiles(party_id,representative_party_id,praca_id) values ($1,$2,$3) on conflict(party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id", [p, r, pr]);
  }
  expect((await rpcServico("colab_acesso_registrar", { _user_id: colab.uid, _party_id: colab.partyId, _codigo: codigo, _actor: master.uid })).erro).toBeNull();
  expect((await rpcServico("colab_modulos_definir", { _user_id: colab.uid, _caps: ["registry.view", "kit.view"], _financeiro: false, _actor: master.uid })).erro).toBeNull();
});

test("Nome de acesso sugerido junta nome + 'de' + sobrenome, sem acento", async () => {
  const r = await rpcServico("colab_usuario_sugerir", { _nome: "Ketllin de Souza Silva", _user: null });
  expect(r.dados).toBe("ketllindesouza");
  const t = await rpcServico("colab_usuario_sugerir", { _nome: "Nauhane Vitória Marques", _user: null });
  expect(t.dados).toBe("nauhanevitoria");
});

test("Login reserva pelo código e pelo nome de acesso (mesma conta)", async () => {
  const u = `ketllin${seed}`;
  expect((await rpcServico("colab_acesso_usuario_definir", { _user_id: colab.uid, _usuario: u, _actor: master.uid })).erro).toBeNull();
  expect((await rpcServico("colab_login_reservar", { _codigo: codigo })).dados).toBe(colab.uid);
  expect((await rpcServico("colab_login_reservar", { _codigo: u.toUpperCase() })).dados).toBe(colab.uid);
  expect((await rpcServico("colab_login_par", { _t: u })).dados).toEqual({ codigo, usuario: u });
  expect((await rpcServico("colab_login_par", { _t: codigo })).dados).toEqual({ codigo, usuario: u });
  await rpcServico("colab_login_ok", { _user: colab.uid });
});

test("Nome de acesso repetido ou com espaço é recusado; só Master define", async () => {
  const outra = await criarConta({ nome: `outra-${seed}`, papeis: [], comParty: true });
  await adm.unsafe("insert into party_roles(party_id,role) values ($1,'colaborador')", [outra.partyId]);
  await rpcServico("colab_acesso_registrar", { _user_id: outra.uid, _party_id: outra.partyId, _codigo: String(70000000 + seed), _actor: master.uid });
  expect((await rpcServico("colab_acesso_usuario_definir", { _user_id: outra.uid, _usuario: `ketllin${seed}`, _actor: master.uid })).erro).not.toBeNull();
  expect((await rpcServico("colab_acesso_usuario_definir", { _user_id: outra.uid, _usuario: "com espaco", _actor: master.uid })).erro).not.toBeNull();
  expect((await rpcServico("colab_acesso_usuario_definir", { _user_id: outra.uid, _usuario: `livre${seed}`, _actor: repA.uid })).erro).not.toBeNull();
  expect((await rpc(colab, "colab_login_par", { _t: codigo })).erro).not.toBeNull();
});

const ve = async (id: string) => (await ler<{ r: boolean }>(colab, "select public.colab_party_ok($1) r", [id])).linhas[0]!.r;

test("Sem liberação: só a carteira do próprio representante", async () => {
  expect(await ve(consA.partyId)).toBe(true);
  expect(await ve(consB.partyId)).toBe(false);
  expect(await ve(consPraca.partyId)).toBe(false);
});

test("Representante liberado passa a ver a carteira dele", async () => {
  expect((await rpcServico("colab_escopo_definir", { _user_id: colab.uid, _rede_toda: false, _reps: [repB.partyId], _pracas: [], _actor: master.uid })).erro).toBeNull();
  expect(await ve(consB.partyId)).toBe(true);
  expect(await ve(consPraca.partyId)).toBe(false);
});

test("Praça liberada passa a ver as consultoras da praça", async () => {
  expect((await rpcServico("colab_escopo_definir", { _user_id: colab.uid, _rede_toda: false, _reps: [], _pracas: [praca], _actor: master.uid })).erro).toBeNull();
  expect(await ve(consPraca.partyId)).toBe(true);
  expect(await ve(consB.partyId)).toBe(false);
});

test("Toda a rede: qualquer consultora; desligar volta ao normal", async () => {
  expect((await rpcServico("colab_escopo_definir", { _user_id: colab.uid, _rede_toda: true, _reps: [], _pracas: [], _actor: master.uid })).erro).toBeNull();
  for (const c of [consA, consB, consPraca]) expect(await ve(c.partyId)).toBe(true);
  expect((await rpcServico("colab_escopo_definir", { _user_id: colab.uid, _rede_toda: false, _reps: [], _pracas: [], _actor: master.uid })).erro).toBeNull();
  expect(await ve(consB.partyId)).toBe(false);
});

test("Só o Master libera, a colaboradora não chama direto e tudo fica auditado", async () => {
  expect((await rpcServico("colab_escopo_definir", { _user_id: colab.uid, _rede_toda: true, _reps: [], _pracas: [], _actor: repA.uid })).erro).not.toBeNull();
  expect((await rpc(colab, "colab_escopo_definir", { _user_id: colab.uid, _rede_toda: true, _reps: [], _pracas: [], _actor: master.uid })).erro).not.toBeNull();
  expect((await ler(colab, "select * from public.colab_escopos")).erro).not.toBeNull();
  const a = await adm.unsafe("select count(*)::int n from audit_logs where action='colab.escopo.definir' and entity_id=$1", [colab.uid]);
  expect(a[0].n).toBeGreaterThanOrEqual(4);
});

test("Acesso suspenso perde a liberação extra", async () => {
  await rpcServico("colab_escopo_definir", { _user_id: colab.uid, _rede_toda: true, _reps: [], _pracas: [], _actor: master.uid });
  await adm.unsafe("update colab_acessos set ativo=false where user_id=$1", [colab.uid]);
  try {
    expect((await ler<{ r: boolean }>(colab, "select public.colab_rede_toda() r")).linhas[0]!.r).toBe(false);
  } finally {
    await adm.unsafe("update colab_acessos set ativo=true where user_id=$1", [colab.uid]);
  }
});

import { beforeAll, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";

let master: Conta, colab: Conta, rep: Conta, other: Conta, inside: Conta, outside: Conta;
const seed = Math.floor(Math.random() * 1000000);
beforeAll(async () => {
  master = await criarConta({ nome: `carteira-master-${seed}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `carteira-rep-${seed}`, papeis: ["representante"], comParty: true });
  other = await criarConta({ nome: `carteira-other-${seed}`, papeis: ["representante"], comParty: true });
  colab = await criarConta({ nome: `carteira-colab-${seed}`, papeis: [], comParty: true });
  inside = await criarConta({ nome: `carteira-inside-${seed}`, papeis: ["consultora"], comParty: true });
  outside = await criarConta({ nome: `carteira-outside-${seed}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe("insert into party_roles(party_id,role) values ($1,'colaborador')", [colab.partyId]);
  for (const [party, representative] of [[colab.partyId, rep.partyId], [inside.partyId, rep.partyId], [outside.partyId, other.partyId]]) {
    await adm.unsafe("insert into consultant_profiles(party_id,representative_party_id) values ($1,$2) on conflict(party_id) do update set representative_party_id=excluded.representative_party_id", [party, representative]);
  }
  const register = await rpcServico("colab_acesso_registrar", { _user_id: colab.uid, _party_id: colab.partyId, _codigo: String(90000000 + seed), _actor: master.uid });
  expect(register.erro).toBeNull();
  expect((await rpcServico("colab_modulos_definir", { _user_id: colab.uid, _caps: ["registry.view", "network.aggregate.view", "catalog.view", "kit.view"], _financeiro: false, _actor: master.uid })).erro).toBeNull();
});
test("Consultoras retorna somente o representante vinculado, antes da paginação", async () => {
  const r = await rpc<{ id: string }[]>(colab, "list_parties", { _limit: 100 });
  expect(r.erro).toBeNull();
  expect(r.dados.map(x => x.id)).toContain(inside.partyId);
  expect(r.dados.map(x => x.id)).not.toContain(outside.partyId);
});
test("Ficha de outra carteira é recusada", async () => {
  expect((await rpc(colab, "get_party_full", { _id: outside.partyId })).erro).not.toBeNull();
});
test("Rede usa o representante vinculado, nunca nacional", async () => {
  expect((await rpc(colab, "network_scope")).dados).toEqual({ modo: "representante", party_id: rep.partyId });
});
test("Estoque bloqueado mesmo com concessão antiga", async () => {
  await adm.unsafe("insert into user_capabilities(user_id,capability) values ($1,'stock.view') on conflict do nothing", [colab.uid]);
  expect((await rpc(colab, "has_capability", { _user_id: colab.uid, _cap: "stock.view" })).dados).toBe(false);
});
test("Ver não permite cadastrar ou alterar produtos e pessoas", async () => {
  for (const cap of ["registry.manage", "product.manage", "catalog.manage"]) expect((await rpc(colab, "has_capability", { _user_id: colab.uid, _cap: cap })).dados).toBe(false);
});
test("Visão geral com estoque não é entregue à colaboradora", async () => {
  expect((await rpc(colab, "catalog_overview")).erro).not.toBeNull();
});
test("Sem vínculo não retorna Consultoras nem libera rede", async () => {
  await adm.unsafe("update consultant_profiles set representative_party_id=null where party_id=$1", [colab.partyId]);
  expect((await rpc(colab, "list_parties", { _limit: 100 })).dados).toEqual([]);
  expect((await rpc(colab, "network_scope")).erro).not.toBeNull();
  await adm.unsafe("update consultant_profiles set representative_party_id=$2 where party_id=$1", [colab.partyId, rep.partyId]);
});
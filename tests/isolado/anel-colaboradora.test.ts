/**
 * 0152 — colaboradora que monta maleta registra o aro do anel lido (base + 2 dígitos);
 * só "ver" não registra; carteira continua restrita mesmo com as regras otimizadas.
 */
import { beforeAll, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, rpcServico, type Conta } from "./base";

let master: Conta, colab: Conta, rep: Conta, outroRep: Conta;
let produto = "", base = "", foraCarteira = "", naCarteira = "";
type R = { encontrado: boolean; precisa_criar?: boolean; variant_id?: string; tamanho?: string; forma?: string; variante_criada?: boolean };

beforeAll(async () => {
  master = await criarConta({ nome: "anel-master", papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: "anel-rep", papeis: ["representante"], comParty: true });
  outroRep = await criarConta({ nome: "anel-rep2", papeis: ["representante"], comParty: true });
  colab = await criarConta({ nome: "anel-colab", papeis: [], comParty: true });
  await adm.unsafe("insert into consultant_profiles(party_id,representative_party_id) values($1,$2)", [colab.partyId, rep.partyId]);
  await adm.unsafe("insert into party_roles(party_id,role) values($1,'colaborador')", [colab.partyId]);
  expect((await rpcServico("colab_acesso_registrar", { _user_id: colab.uid, _party_id: colab.partyId, _codigo: String(Math.floor(10000000 + Math.random() * 80000000)), _actor: master.uid })).erro).toBeNull();
  expect((await rpcServico("colab_modulos_definir", { _user_id: colab.uid, _caps: ["kit.view", "kit.manage", "catalog.view", "registry.view"], _financeiro: false, _actor: master.uid })).erro).toBeNull();
  base = String(70000 + Math.floor(Math.random() * 29000));
  const p = await adm.unsafe("insert into products(name,slug,status) values($1,$2,'rascunho') returning id", [`AN TESTE ARO ${base}`, `an-teste-aro-${base}`]);
  produto = String(p[0].id);
  await adm.unsafe("insert into product_variants(product_id,label,barcode,price_cents,is_default,is_active) values($1,'Único',$2,4500,true,true)", [produto, base]);
  const a = await adm.unsafe("insert into parties(kind,display_name,status) values('pessoa',$1,'ativo') returning id", [`Consultora carteira ${base}`]);
  naCarteira = String(a[0].id);
  await adm.unsafe("insert into consultant_profiles(party_id,representative_party_id) values($1,$2)", [naCarteira, rep.partyId]);
  const b = await adm.unsafe("insert into parties(kind,display_name,status) values('pessoa',$1,'ativo') returning id", [`Consultora fora ${base}`]);
  foraCarteira = String(b[0].id);
  await adm.unsafe("insert into consultant_profiles(party_id,representative_party_id) values($1,$2)", [foraCarteira, outroRep.partyId]);
});

test("Anel lido com aro 16: colaboradora que monta registra o tamanho uma única vez", async () => {
  const cod = `${base}16`;
  const prev = await rpc<R>(colab, "barcode_resolver", { _code: cod, _criar: false });
  expect(prev.erro).toBeNull();
  expect(prev.dados.precisa_criar).toBe(true);
  expect(prev.dados.tamanho).toBe("16");
  const r = await rpc<R>(colab, "barcode_resolver", { _code: cod, _criar: true });
  expect(r.erro).toBeNull();
  expect(r.dados.forma).toBe("anel_tamanho");
  expect(r.dados.variante_criada).toBe(true);
  const de_novo = await rpc<R>(colab, "barcode_resolver", { _code: cod, _criar: true });
  expect(de_novo.dados.variant_id).toBe(r.dados.variant_id);
  const n = await adm.unsafe("select count(*)::int n from product_variants where product_id=$1 and barcode=$2", [produto, cod]);
  expect(n[0].n).toBe(1);
  const log = await adm.unsafe("select count(*)::int n from audit_logs where action='variante.anel_tamanho.criada' and actor_id=$1", [colab.uid]);
  expect(log[0].n).toBe(1);
});

test("Somente ver não registra tamanho novo", async () => {
  expect((await rpcServico("colab_modulos_definir", { _user_id: colab.uid, _caps: ["kit.view", "catalog.view", "registry.view"], _financeiro: false, _actor: master.uid })).erro).toBeNull();
  const r = await rpc<R>(colab, "barcode_resolver", { _code: `${base}18`, _criar: true });
  expect(r.ok).toBe(false);
  expect(r.erro).toContain("tamanho do anel");
});

test("Busca de cadastros da colaboradora continua só na carteira do representante", async () => {
  const r = await ler<{ id: string }>(colab, "select id from parties where display_name ilike $1", [`%${base}%`]);
  expect(r.erro).toBeNull();
  const ids = (r.linhas ?? []).map((x) => x.id);
  expect(ids).toContain(naCarteira);
  expect(ids).not.toContain(foraCarteira);
});

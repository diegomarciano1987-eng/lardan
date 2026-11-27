import { afterAll, beforeAll, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, ler, rpc, rpcServico, type Conta } from "./base";

const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let master: Conta;
let ketllin: Conta;
let thalia: Conta;
let restrita: Conta;
let isabella: Conta;
let outra: Conta;
let remessa = "";
let praca = "";
let codigoOriginal = "";
type Linha = { party_id: string };

beforeAll(async () => {
  master = await criarConta({ nome: `chefe-master-${marca}`, papeis: ["master"], comParty: true });
  ketllin = await criarConta({ nome: `Ketllin teste ${marca}`, papeis: [], comParty: true });
  thalia = await criarConta({ nome: `Thalia teste ${marca}`, papeis: [], comParty: true });
  restrita = await criarConta({ nome: `Restrita teste ${marca}`, papeis: [], comParty: true });
  isabella = await criarConta({ nome: "ISABELLA VITORIA DE ALMEIDA SANTOS", papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: `Consultora outra praça ${marca}`, papeis: ["consultora"], comParty: true });
  const deposito = await criarDeposito(`chefe-${marca}`);
  const p = (await adm.unsafe("insert into cob_pracas(codigo,nome) values ($1,$2) returning id", [10000000 + Math.floor(Math.random() * 9000000), `Chefe ${marca}`]))[0];
  const p2 = (await adm.unsafe("insert into cob_pracas(codigo,nome) values ($1,$2) returning id", [30000000 + Math.floor(Math.random() * 9000000), `Outra ${marca}`]))[0];
  if (!p || !p2) throw new Error("Praças não criadas");
  praca = String(p['id']);
  const codigo = (await adm.unsafe("select code from parties where id=$1",[isabella.partyId]))[0];
  if (!codigo) throw new Error("Consultora de teste não criada");
  codigoOriginal = String(codigo['code']);
  await adm.unsafe("update parties set code='9234',status='inativo' where id=$1", [isabella.partyId]);
  await adm.unsafe("insert into consultant_profiles(party_id,praca_id) values ($1,null),($2,$3) on conflict(party_id) do update set praca_id=excluded.praca_id,representative_party_id=null", [isabella.partyId,outra.partyId,p2['id']]);
  for (const [i,c] of [ketllin,thalia,restrita].entries()) {
    await adm.unsafe("insert into party_roles(party_id,role) values ($1,'colaborador') on conflict do nothing",[c.partyId]);
    const registrado=await rpcServico("colab_acesso_registrar",{_user_id:c.uid,_party_id:c.partyId,_codigo:String(50000000+Number(marca.slice(-6))+i),_actor:master.uid});
    if (registrado.erro) throw new Error(registrado.erro);
    const modulos=await rpcServico("colab_modulos_definir",{_user_id:c.uid,_caps:["kit.view","kit.manage","registry.view"],_financeiro:false,_actor:master.uid});
    if(modulos.erro) throw new Error(modulos.erro);
    const escopo=await rpcServico("colab_escopo_definir",{_user_id:c.uid,_rede_toda:c!==restrita,_reps:[],_pracas:c===restrita?[praca]:[],_actor:master.uid});
    if(escopo.erro) throw new Error(escopo.erro);
  }
  const r=await rpc<{id:string}>(master,"remessa_criar",{_praca:praca,_deposito:deposito,_data_acerto:"2027-01-25"});
  if(r.erro) throw new Error(r.erro);
  remessa=r.dados.id;
});
afterAll(async()=>{
  if(codigoOriginal && isabella?.partyId) await adm.unsafe("update parties set code=$2 where id=$1",[isabella.partyId,codigoOriginal]);
});

test("Ketllin encontra Isabella 9234 sem praça ou representante nos dois campos",async()=>{
  for(const [sql,args] of [["select * from remessa_consultoras_buscar($1,$2)",[remessa,"9234"]],["select * from praca_consultoras_busca($1,$2)",[praca,"9234"]],["select * from maleta_direta_consultoras($1)",["9234"]]] as const){
    const r=await ler<Linha>(ketllin,sql,[...args]);expect(r.erro).toBeNull();expect(r.linhas.map(x=>x.party_id)).toContain(isabella.partyId);
  }
});
test("Thalia encontra Isabella pelo nome completo e consultora de outra praça",async()=>{
  const r=await ler<Linha>(thalia,"select * from remessa_consultoras_buscar($1,$2)",[remessa,"ISABELLA VITORIA DE ALMEIDA SANTOS"]);
  expect(r.erro).toBeNull();expect(r.linhas.map(x=>x.party_id)).toContain(isabella.partyId);
  const o=await ler<Linha>(thalia,"select * from remessa_consultoras_buscar($1,$2)",[remessa,marca]);
  expect(o.erro).toBeNull();expect(o.linhas.map(x=>x.party_id)).toContain(outra.partyId);
});
test("carteira restrita não recebe o acesso das chefes",async()=>{
  const r=await ler<Linha>(restrita,"select * from remessa_consultoras_buscar($1,$2)",[remessa,"9234"]);
  expect(r.erro).toBeNull();expect(r.linhas).toEqual([]);
  expect((await rpc(restrita,"remessa_abrir_maleta_busca",{_remessa:remessa,_consultora:isabella.partyId})).erro).not.toBeNull();
});
test("Ketllin abre para Isabella pela busca principal publicada sem vínculo prévio",async()=>{
  const r=await rpc<{cycle_id:string}>(ketllin,"remessa_abrir_maleta",{_remessa:remessa,_consultora:isabella.partyId});
  expect(r.erro).toBeNull();expect(r.dados.cycle_id).toBeTruthy();
  const rows=await adm.unsafe("select praca_id from consultant_profiles where party_id=$1",[isabella.partyId]);
  expect(rows[0]?.['praca_id']).toBe(praca);
});
test("Thalia abre para outra praça pelo caminho atômico",async()=>{
  const r=await rpc<{cycle_id:string}>(thalia,"remessa_abrir_maleta_busca",{_remessa:remessa,_consultora:outra.partyId});
  expect(r.erro).toBeNull();expect(r.dados.cycle_id).toBeTruthy();
});
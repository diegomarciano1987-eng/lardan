import { beforeAll, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, rpc, rpcServico, ler, type Conta } from "./base";
let master: Conta, colab: Conta, outra: Conta, rep: Conta;
let ciclo = "", variante = "", id = "", codigo = "";
const args = (operacao = crypto.randomUUID(), delta = 1, origem = "bipagem") => ({ _cycle: ciclo, _variant: variante, _delta: delta, _origem: origem, _operacao: operacao });
beforeAll(async () => {
 master = await criarConta({ nome: "montagem-master", papeis: ["master"], comParty: true });
 rep = await criarConta({ nome: "montagem-rep", papeis: ["representante"], comParty: true });
 colab = await criarConta({ nome: "montagem-pessoal", papeis: [], comParty: true });
 outra = await criarConta({ nome: "montagem-outra", papeis: [], comParty: true });
 await adm.unsafe("insert into consultant_profiles(party_id,representative_party_id) values($1,$2),($3,$2)",[colab.partyId,rep.partyId,outra.partyId]);
 for(const c of [colab,outra]) {
  await adm.unsafe("insert into party_roles(party_id,role) values($1,'colaborador')",[c.partyId]);
  const reg = await rpcServico("colab_acesso_registrar",{ _user_id:c.uid,_party_id:c.partyId,_codigo:String(Math.floor(10000000+Math.random()*80000000)),_actor:master.uid });
  expect(reg.erro).toBeNull();
  expect((await rpcServico("colab_modulos_definir",{_user_id:c.uid,_caps:["kit.view","kit.manage"],_financeiro:false,_actor:master.uid})).erro).toBeNull();
 }
 const dep = await criarDeposito("produtividade"); variante = await criarVariante("produtividade");
 const r = await rpc<{cycle_id:string}>(master,"kit_cycle_create",{_payload:{origin_location_id:dep,representante_party_id:rep.partyId,consultora_party_id:colab.partyId}});
 expect(r.erro).toBeNull(); ciclo=r.dados.cycle_id;
 const rows=await adm.unsafe("select k.code from kits k join kit_cycles c on c.kit_id=k.id where c.id=$1",[ciclo]); codigo=String(rows[0]?.code ?? "");
});
test("Bipagem aplica uma peça e repetição não duplica",async()=> {
 id=crypto.randomUUID(); const a=args(id);
 expect((await rpc<{quantidade:number}>(colab,"montagem_item_operar",a)).dados.quantidade).toBe(1);
 expect((await rpc<{quantidade:number;repetida:boolean}>(colab,"montagem_item_operar",a)).dados).toEqual({quantidade:1,repetida:true});
 const rows=await adm.unsafe("select count(*)::int n from montagem_operacoes where id=$1",[id]);expect(rows[0]?.n).toBe(1);
});
test("Mesmo identificador não aceita outra autoria ou intenção",async()=> {
 expect((await rpc(colab,"montagem_item_operar",args(id,-1,"retirada"))).ok).toBe(false);
 expect((await rpc(outra,"montagem_item_operar",args(id))).ok).toBe(false);
});
test("Bipagens concorrentes não perdem incrementos",async()=> {
 const results=await Promise.all([rpc(colab,"montagem_item_operar",args()),rpc(colab,"montagem_item_operar",args())]);expect(results.every(x=>x.ok)).toBe(true);
 const rows=await adm.unsafe("select i.quantity from kit_composition_items i join kit_compositions c on c.id=i.composition_id where c.cycle_id=$1 and i.variant_id=$2",[ciclo,variante]);expect(rows[0]?.quantity).toBe(3);
});
test("Resumo conta autoria e distingue manual de bipagem",async()=> {
 expect((await rpc(colab,"montagem_item_operar",args(crypto.randomUUID(),1,"manual"))).ok).toBe(true);
 expect((await rpc(colab,"montagem_item_operar",args(crypto.randomUUID(),-1,"retirada"))).ok).toBe(true);
 const dia=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const r=await rpc<{pecas:number;maletas:number;retiradas:number;ajustes:number;saldo:number}>(colab,"montagem_meu_resumo",{_de:dia,_ate:dia});expect(r.erro).toBeNull();expect(r.dados.pecas).toBe(3);expect(r.dados.maletas).toBe(1);expect(r.dados.retiradas).toBe(1);expect(r.dados.ajustes).toBe(1);expect(r.dados.saldo).toBe(3);
 const o=await rpc<{pecas:number;inicio:null}>(outra,"montagem_meu_resumo",{_de:dia,_ate:dia});expect(o.dados.pecas).toBe(0);expect(o.dados.inicio).toBeNull();
});
test("Código existente abre maleta apenas dentro da carteira",async()=> {
 expect(codigo.length).toBeGreaterThan(0);expect((await rpc(colab,"kit_identificacao_buscar",{_codigo:codigo})).dados).toBe(ciclo);
 await adm.unsafe("update consultant_profiles set representative_party_id=null where party_id=$1",[outra.partyId]);
 expect((await rpc(outra,"kit_identificacao_buscar",{_codigo:codigo})).dados).toBeNull();
 expect((await rpc(outra,"montagem_item_operar",args())).ok).toBe(false);
});
test("Somente ver não modifica composição nem forja eventos",async()=> {
 expect((await rpcServico("colab_modulos_definir",{_user_id:colab.uid,_caps:["kit.view"],_financeiro:false,_actor:master.uid})).ok).toBe(true);
 expect((await rpc(colab,"montagem_item_operar",args())).ok).toBe(false);
 expect((await ler(colab,"insert into montagem_operacoes(id,actor_user_id,cycle_id,variant_id,origem,delta,quantidade) values(gen_random_uuid(),$1,$2,$3,'bipagem',1,4)",[colab.uid,ciclo,variante])).erro).toBeTruthy();
});
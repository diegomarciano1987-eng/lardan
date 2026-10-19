import { beforeAll, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";

let master: Conta, larissa: Conta, outro: Conta, consultora: Conta;
let conta: string, parcela: string, acordo: string, titulo: string;
const um = async <T>(sql: string, params: unknown[] = []) => {
  const rows = await adm.unsafe(sql, params) as T[];
  if (!rows[0]) throw new Error("Cenário não criado");
  return rows[0];
};
beforeAll(async () => {
  master = await criarConta({ nome: "master-alvara", papeis: ["master"], comParty: true });
  larissa = await criarConta({ nome: "larissa-alvara", papeis: ["financeiro", "cobranca"], comParty: true });
  outro = await criarConta({ nome: "outro-fin", papeis: ["financeiro"] });
  consultora = await criarConta({ nome: "cons-alvara", papeis: ["consultora"] });
  const liberado = await rpcServico("access_financial_full_set", { _user: larissa.uid, _enabled: true, _actor: master.uid, _reason: "Autorização de acesso completo" });
  expect(liberado.ok).toBe(true);
  conta = (await um<{id:string}>("insert into financial_accounts(nome,kind) values('ISO Alvará','conta_corrente') returning id")).id;
  const r = await rpc<string>(larissa, "fin_title_create", { _payload: { direction: "receivable", party_id: larissa.partyId, descricao: "ISO dívida alvará", valor_cents: 100000, parcelas: [{ vencimento: "2026-01-10", valor_cents: 100000 }] } });
  expect(r.ok).toBe(true); titulo=r.dados;
  parcela=(await um<{id:string}>("select id from financial_installments where title_id=$1",[titulo])).id;
  expect((await rpc(larissa,"cob_judicial_encaminhar",{_party:larissa.partyId,_d:{}})).ok).toBe(true);
  const ac=await rpc<string>(larissa,"cob_judicial_acordo_salvar",{_party:larissa.partyId,_d:{data_acordo:"2026-10-19",installment_ids:[parcela],total_cents:90000,desconto_cents:10000,plano:[{numero:1,data:"2026-10-19",valor_cents:50000,asaas:false,alvara:true},{numero:2,data:"2026-11-19",valor_cents:20000,asaas:true},{numero:3,data:"2026-12-19",valor_cents:20000,asaas:true}]}});
  expect(ac.ok).toBe(true); acordo=ac.dados;
});
test("Larissa possui todas as 28 permissões financeiras, sem Master; outro financeiro permanece restrito",async()=>{
  const caps=await rpc<{capability:string}[]>(larissa,"my_capabilities");
  expect(caps.dados.filter(x=>x.capability.startsWith("finance.")).length).toBe(28);
  expect((await rpc(larissa,"has_role",{_user_id:larissa.uid,_role:"master"})).dados).toBe(false);
  expect((await rpc(outro,"has_capability",{_user_id:outro.uid,_cap:"finance.settings.manage"})).dados).toBe(false);
  expect((await rpc(larissa,"access_financial_full_set",{_user:outro.uid,_enabled:true,_actor:master.uid,_reason:"Tentativa indevida"})).ok).toBe(false);
});
test("Asaas recebe somente as 2 parcelas de R$200, sem alvará R$500",async()=>{
  const s=await um<{plano:{valor_cents:number}[];total_cents:string}>("select s.plano,s.total_cents from cob_simulacoes s join cob_judicial_acordos a on a.simulacao_id=s.id where a.id=$1",[acordo]);
  expect(s.plano.length).toBe(2); expect(Number(s.total_cents)).toBe(40000);
});
test("alvará R$500 abate dívida original para R$500, conta recebe na data escolhida e repetição não duplica",async()=>{
  const args={_acordo:acordo,_numero:1,_conta:conta,_data:"2026-10-19",_referencia:"ALV-ISO-001"};
  const r=await rpc<{settlement_id:string}>(larissa,"cob_judicial_alvara_liberar",args); expect(r.ok).toBe(true);
  expect(Number((await um<{v:string}>("select fin_installment_saldo($1) v",[parcela])).v)).toBe(50000);
  const mov=await um<{v:string;d:string}>("select sum(valor_cents) v,min(data)::text d from financial_account_movements where financial_account_id=$1",[conta]);
  expect(Number(mov.v)).toBe(50000);expect(mov.d).toBe("2026-10-19");
  expect((await rpc<{repetido:boolean}>(larissa,"cob_judicial_alvara_liberar",args)).dados.repetido).toBe(true);
  expect(Number((await um<{n:string}>("select count(*) n from cob_judicial_alvara_recebimentos where acordo_id=$1",[acordo])).n)).toBe(1);
  expect(Number((await um<{n:string}>("select count(*) n from financial_titles where party_id=$1",[larissa.partyId])).n)).toBe(1);
  expect(Number((await um<{v:string}>("select coalesce(sum(valor_cents),0) v from financial_adjustments where installment_id=$1 and kind='desconto'",[parcela])).v)).toBe(0);
});
test("nega Asaas como alvará, datas futuras e usuária sem permissão",async()=>{
  const a={_acordo:acordo,_numero:2,_conta:conta,_data:"2026-10-19",_referencia:"ALV-ISO-002"};
  expect((await rpc(larissa,"cob_judicial_alvara_liberar",a)).ok).toBe(false);
  expect((await rpc(larissa,"cob_judicial_alvara_liberar",{...a,_numero:1,_data:"2099-01-01"})).ok).toBe(false);
  expect((await rpc(consultora,"cob_judicial_alvara_liberar",{...a,_numero:1})).ok).toBe(false);
});
test("estorno oficial reabre dívida e alvará, nova baixa não duplica o saldo",async()=>{
  const registro=await um<{settlement_id:string}>("select settlement_id from cob_judicial_alvara_recebimentos where acordo_id=$1",[acordo]);
  expect((await rpc(larissa,"fin_settlement_reverse",{_settlement:registro.settlement_id,_motivo:"Estorno isolado"})).ok).toBe(true);
  expect(Number((await um<{v:string}>("select fin_installment_saldo($1) v",[parcela])).v)).toBe(100000);
  const hist=await rpc<{estornado:boolean}[]>(larissa,"cob_judicial_alvaras",{_acordo:acordo});expect(hist.dados[0]?.estornado).toBe(true);
  expect((await rpc(larissa,"cob_judicial_alvara_liberar",{_acordo:acordo,_numero:1,_conta:conta,_data:"2026-10-19",_referencia:"ALV-ISO-003"})).ok).toBe(true);
  expect(Number((await um<{v:string}>("select sum(valor_cents) v from financial_account_movements where financial_account_id=$1",[conta])).v)).toBe(50000);
});
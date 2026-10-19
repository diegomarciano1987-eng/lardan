import { beforeAll, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, ler, type Conta } from "./base";

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
  const caps=await ler<{capability:string}>(larissa,"select * from my_capabilities()");
  expect(caps.linhas.filter(x=>x.capability.startsWith("finance.")).length).toBe(28);
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
test("desconto judicial R$100 só no último recebimento Asaas e alvará",async()=>{
  const sim=(await um<{simulacao_id:string}>("select simulacao_id from cob_judicial_acordos where id=$1",[acordo])).simulacao_id;
  const emp=(await um<{id:string}>("insert into business_entities(legal_name) values('ISO Empresa Alvará') returning id")).id;
  await adm.unsafe("update financial_titles set business_entity_id=$2 where id=$1",[titulo,emp]);
  const acc=(await um<{id:string}>("insert into asaas_accounts(label,environment,financial_account_id,owner_entity_id) values('ISO Asaas Alvará','sandbox',$1,$2) returning id",[conta,emp])).id;
  for(const numero of [2,3]) {
    const ext=`pay_iso_alvara_${acordo.slice(0,8)}_${numero}`;
    const ch=await adm.begin(async tx=>{
      await tx.unsafe("select set_config('lardann.asaas_link','on',true)");
      const rows=await tx.unsafe("insert into asaas_charges(account_id,external_id,value_cents,due_date,billing_type,external_status,installment_id,title_id,party_id,payment_date) values($1,$2,20000,'2026-10-19','PIX','RECEIVED',$3,$4,$5,'2026-10-19') returning id",[acc,ext,parcela,titulo,larissa.partyId]) as {id:string}[];
      if(!rows[0]) throw new Error('Cobrança isolada não criada');return rows[0].id;
    });
    await adm.begin(async tx=>{
      await tx.unsafe("select set_config('lardann.asaas_intent','on',true)");
      await tx.unsafe("insert into asaas_charge_intents(account_id,title_id,installment_id,party_id,value_cents,due_date,billing_type,internal_reference,idempotency_key,content_hash,acordo_simulacao_id,acordo_parcela,charge_id,external_id) values($1,$2,$3,$4,20000,'2026-10-19','PIX',$5,$5,$5,$6,$7,$8,$9)",[acc,titulo,parcela,larissa.partyId,`iso:${acordo}:${numero}`,sim,numero,ch,ext]);
    });
    const r=await rpcServico<{baixa:boolean}>("asaas_baixa_automatica",{_charge:ch}); expect(r.dados.baixa).toBe(true);
    const sd=Number((await um<{v:string}>("select fin_installment_saldo($1) v",[parcela])).v);
    expect(sd).toBe(numero===2?30000:0);
  }
  expect(Number((await um<{v:string}>("select sum(valor_cents) v from financial_adjustments where installment_id=$1 and kind='desconto'",[parcela])).v)).toBe(10000);
  expect(Number((await um<{v:string}>("select sum(valor_cents) v from financial_account_movements where financial_account_id=$1",[conta])).v)).toBe(90000);
});
test("estornar alvará após quitar acordo retira desconto R$100; novo alvará reaplica só uma vez",async()=>{
  const s=await um<{settlement_id:string}>("select ar.settlement_id from cob_judicial_alvara_recebimentos ar where acordo_id=$1 and not exists(select 1 from financial_settlements rev where rev.reversed_of=ar.settlement_id)",[acordo]);
  expect((await rpc(larissa,"fin_settlement_reverse",{_settlement:s.settlement_id,_motivo:"Revisão do alvará após quitação"})).ok).toBe(true);
  expect(Number((await um<{v:string}>("select fin_installment_saldo($1) v",[parcela])).v)).toBe(60000);
  expect(Number((await um<{v:string}>("select sum(valor_cents) v from financial_adjustments where installment_id=$1 and kind='desconto'",[parcela])).v)).toBe(0);
  expect((await rpc(larissa,"cob_judicial_alvara_liberar",{_acordo:acordo,_numero:1,_conta:conta,_data:"2026-10-19",_referencia:"ALV-ISO-004"})).ok).toBe(true);
  expect(Number((await um<{v:string}>("select fin_installment_saldo($1) v",[parcela])).v)).toBe(0);
  expect(Number((await um<{v:string}>("select sum(valor_cents) v from financial_adjustments where installment_id=$1 and kind='desconto'",[parcela])).v)).toBe(10000);
});
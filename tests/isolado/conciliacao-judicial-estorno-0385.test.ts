import { beforeAll, describe, expect, test } from 'bun:test';
import { adm, criarConta, rpc, VISITANTE, type Conta } from './base';

const um = async <T>(sql: string, p: unknown[] = []): Promise<T> => {
  const rows = await adm.unsafe(sql, p) as T[];
  const row = rows[0]; if (!row) throw new Error('Cenário isolado não criado'); return row;
};
const sucesso = <T>(r: {ok: boolean; dados: T; erro: string | null}): T => { if (!r.ok) throw new Error(r.erro ?? 'Falha'); return r.dados; };
let master: Conta, consultora: Conta;
let seq=0;
const marca = () => `ISO-E1-${Date.now()}-${++seq}`;
const DIA='2026-10-28';
beforeAll(async()=>{
  master=await criarConta({nome:marca(),papeis:['master'],comParty:true});
  consultora=await criarConta({nome:marca(),papeis:['consultora']});
});
async function cenario(valorLinha=31301,principal=30263) {
  const acc=await um<{id:string}>("insert into financial_accounts(nome,kind) values($1,'conta_corrente') returning id",[marca()]);
  const f=await um<{id:string}>("insert into financial_statement_files(financial_account_id,storage_path,original_name,format,sha256) values($1,'iso/e1.csv','e1.csv','csv',$2) returning id",[acc.id,marca()]);
  const imp=await um<{id:string}>("insert into financial_statement_imports(file_id,financial_account_id) values($1,$2) returning id",[f.id,acc.id]);
  const l=await um<{id:string}>("insert into financial_statement_lines(import_id,file_id,financial_account_id,line_no,data,valor_cents,kind,historico,bank_id,hash,status) values($1,$2,$3,73,$4,$5,'entrada','TED LIBERACAO RECURSO JUDICAIL',$6,$6,'pendente') returning id",[imp.id,f.id,acc.id,DIA,valorLinha,marca()]);
  const pessoa=await um<{id:string}>("insert into parties(kind,display_name,legal_name,status) values('pessoa',$1,$1,'ativo') returning id",[marca()]);
  const titulo=sucesso(await rpc<string>(master,'fin_title_create',{_payload:{direction:'receivable',party_id:pessoa.id,descricao:marca(),valor_cents:100000,parcelas:[{vencimento:'2026-01-10',valor_cents:100000}]}}));
  const inst=await um<{id:string}>('select id from financial_installments where title_id=$1',[titulo]);
  sucesso(await rpc(master,'cob_judicial_encaminhar',{_party:pessoa.id,_d:{}}));
  const acordo=sucesso(await rpc<string>(master,'cob_judicial_acordo_salvar',{_party:pessoa.id,_d:{data_acordo:DIA,installment_ids:[inst.id],total_cents:90000,desconto_cents:10000,plano:[{numero:1,data:DIA,valor_cents:principal,alvara:true,asaas:false},{numero:2,data:'2026-12-01',valor_cents:90000-principal,asaas:true,alvara:false}]}}));
  return {acc:acc.id,line:l.id,party:pessoa.id,titulo,inst:inst.id,acordo};
}
const soma=async(sql:string,p:unknown[])=>Number((await um<{v:string}>(sql,p)).v);
describe('TED judicial da Mesa sem duplicar caixa',()=>{
  test('313,01 = alvará 302,63 + juros 10,38: baixa só principal e mantém dívida original',async()=>{
    const c=await cenario();
    const args={_line:c.line,_acordo:c.acordo,_numero:1,_juros_confirmados:1038};
    const r=sucesso(await rpc<{id:string;settlement_id:string;repetido:boolean}>(master,'fin_mesa_alvara_conciliar',args));
    expect(r.repetido).toBe(false);
    expect(await soma('select fin_installment_saldo($1) v',[c.inst])).toBe(69737);
    expect(await soma('select sum(valor_cents) v from financial_account_movements where financial_account_id=$1',[c.acc])).toBe(31301);
    expect(await soma("select sum(valor_cents) v from financial_adjustments where settlement_id=$1 and kind='juros'",[r.settlement_id])).toBe(1038);
    expect(await soma('select count(*) v from financial_titles where party_id=$1',[c.party])).toBe(1);
    expect((await um<{status:string}>('select status from financial_statement_lines where id=$1',[c.line])).status).toBe('conciliada');
    expect(sucesso(await rpc<{repetido:boolean}>(master,'fin_mesa_alvara_conciliar',args)).repetido).toBe(true);
    expect((await rpc(master,'fin_mesa_alvara_conciliar',{...args,_juros_confirmados:1037})).ok).toBe(false);
    expect(await soma('select count(*) v from cob_judicial_alvara_recebimentos where acordo_id=$1',[c.acordo])).toBe(1);
    sucesso(await rpc(master,'fin_reconcile_undo',{_reconciliation:r.id,_motivo:'Conferência isolada'}));
    expect(await soma('select fin_installment_saldo($1) v',[c.inst])).toBe(100000);
    expect(await soma('select sum(valor_cents) v from financial_account_movements where financial_account_id=$1',[c.acc])).toBe(0);
    const novo=sucesso(await rpc<{id:string;repetido:boolean}>(master,'fin_mesa_alvara_conciliar',args));
    expect(novo.id).not.toBe(r.id); expect(novo.repetido).toBe(false);
    expect(await soma('select sum(valor_cents) v from financial_account_movements where financial_account_id=$1',[c.acc])).toBe(31301);
  });
  test('juros não confirmados ou errados não lançam nada',async()=>{
    const c=await cenario();
    for (const juros of [0,1037,-1]) expect((await rpc(master,'fin_mesa_alvara_conciliar',{_line:c.line,_acordo:c.acordo,_numero:1,_juros_confirmados:juros})).ok).toBe(false);
    expect(await soma('select count(*) v from financial_settlements where financial_account_id=$1',[c.acc])).toBe(0);
  });
  test('juros não antecipam desconto enquanto falta parcela do acordo',async()=>{
    const c=await cenario(90263,30263);
    sucesso(await rpc(master,'fin_mesa_alvara_conciliar',{_line:c.line,_acordo:c.acordo,_numero:1,_juros_confirmados:60000}));
    expect(await soma("select coalesce(sum(valor_cents),0) v from financial_adjustments where installment_id=$1 and kind='desconto'",[c.inst])).toBe(0);
  });
  test('Asaas não é alvará e visitante/consultora não recebe',async()=>{
    const c=await cenario(); const args={_line:c.line,_acordo:c.acordo,_numero:1,_juros_confirmados:1038};
    expect((await rpc(consultora,'fin_mesa_alvara_conciliar',args)).ok).toBe(false);
    expect((await rpc(VISITANTE,'fin_mesa_alvara_conciliar',args)).ok).toBe(false);
    expect((await rpc(master,'fin_mesa_alvara_conciliar',{...args,_numero:2})).ok).toBe(false);
    expect((await rpc(consultora,'fin_mesa_alvaras',{_line:c.line})).ok).toBe(false);
  });
});
describe('linha Santander presa a baixa já estornada',()=>{
  test('libera R$200 sem segundo estorno e mantém o histórico',async()=>{
    const c=await cenario(20000,20000);
    const r=sucesso(await rpc<{id:string;settlement_id:string}>(master,'fin_reconcile',{_payload:{line_ids:[c.line],alocacoes:[{installment_id:c.inst,valor_cents:20000}],idempotency_key:marca()}}));
    sucesso(await rpc(master,'fin_settlement_reverse',{_settlement:r.settlement_id,_motivo:'Baixa errada já estornada'}));
    const antes=await soma('select count(*) v from financial_account_movements where financial_account_id=$1',[c.acc]);
    sucesso(await rpc(master,'fin_reconcile_undo',{_reconciliation:r.id,_motivo:'Soltar linha 73'}));
    const linha=await um<{status:string;conciliado_cents:string}>('select status,conciliado_cents from financial_statement_lines where id=$1',[c.line]);
    expect(linha.status).toBe('pendente'); expect(Number(linha.conciliado_cents)).toBe(0);
    expect(await soma('select count(*) v from financial_account_movements where financial_account_id=$1',[c.acc])).toBe(antes);
    expect(await soma('select sum(valor_cents) v from financial_account_movements where financial_account_id=$1',[c.acc])).toBe(0);
    expect(await soma('select count(*) v from financial_settlements where reversed_of=$1',[r.settlement_id])).toBe(1);
    expect((await um<{status:string}>('select status from financial_reconciliations where id=$1',[r.id])).status).toBe('estornada');
    expect((await rpc(master,'fin_reconcile_undo',{_reconciliation:r.id,_motivo:'Repetição'})).ok).toBe(false);
  });
});

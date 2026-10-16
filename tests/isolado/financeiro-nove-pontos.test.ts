import { beforeAll, expect, test } from 'bun:test';
import { adm, criarConta, rpc, type Conta } from './base';

let master: Conta;
let consultora: Conta;
let party = '';
let conta = '';
let titulo = '';
let parcela = '';
let baixa = '';
let estorno = '';
const one = async (sql: string, args: unknown[] = []) => {
  const rows = await adm.unsafe(sql, args);
  const row = rows[0];
  if (!row) throw new Error('Registro de teste ausente');
  return row;
};
beforeAll(async () => {
  master = await criarConta({ nome: 'nove-fin-master', papeis: ['master'] });
  consultora = await criarConta({ nome: 'nove-fin-cons', papeis: ['consultora'] });
  party = (await one("insert into parties(kind,display_name,status) values('pessoa','ISO Daniel de Freitas Maciel','ativo') returning id")).id;
  conta = (await one("insert into financial_accounts(nome,kind) values('ISO Santander nove pontos','conta_corrente') returning id")).id;
  const created = await rpc<string>(master, 'fin_title_create', { _payload: { direction: 'payable', party_id: party, descricao: 'ISO impressora argox 214', valor_cents: 13815, emissao: '2026-10-09', competencia: '2026-10-09', parcelas: [{ vencimento: '2026-10-09', valor_cents: 13815 }] } });
  if (!created.ok) throw new Error(created.erro ?? 'Falha');
  titulo = created.dados;
  parcela = (await one('select id from financial_installments where title_id=$1', [titulo])).id;
});

test('1 parcela 138,15 passa a 138,13 e muda vencimento com evento e total correto', async () => {
  const r = await rpc(master, 'fin_installment_editar', { _installment: parcela, _vencimento: '2026-10-10', _valor_cents: 13813, _motivo: 'Correção de dois centavos' });
  expect(r.erro).toBeNull();
  const row = await one('select i.valor_cents::int valor,i.vencimento::text dia,t.valor_cents::int total from financial_installments i join financial_titles t on t.id=i.title_id where i.id=$1', [parcela]);
  expect(row).toMatchObject({ valor: 13813, total: 13813, dia: '2026-10-10' });
  expect((await one("select count(*)::int n from financial_title_events where title_id=$1 and evento='parcela_editada'", [titulo])).n).toBe(1);
});

test('3 estorno 3.100 de 16/10 corrigido para 09/10 sem mudar valores nem duplicar movimentos', async () => {
  const t = await rpc<string>(master, 'fin_title_create', { _payload: { direction: 'payable', party_id: party, descricao: 'ISO aluguel 2026-007482', valor_cents: 310000, emissao: '2026-10-09', competencia: '2026-10-09', parcelas: [{ vencimento: '2026-10-09', valor_cents: 310000 }] } });
  if (!t.ok) throw new Error(t.erro ?? 'Falha');
  const inst = (await one('select id from financial_installments where title_id=$1', [t.dados])).id;
  const b = await rpc<{ id: string }>(master, 'fin_settlement_create_ajustes', { _payload: { direction: 'payable', financial_account_id: conta, data: '2026-10-09', valor_cents: 310000, idempotency_key: `iso-nove-${t.dados}`, alocacoes: [{ installment_id: inst, valor_cents: 310000 }] } });
  if (!b.ok) throw new Error(b.erro ?? 'Falha');
  baixa = b.dados.id;
  const e = await rpc<string>(master, 'fin_settlement_reverse_data', { _settlement: baixa, _motivo: 'ISO estorno aluguel', _data: '2026-10-16' });
  if (!e.ok) throw new Error(e.erro ?? 'Falha');
  estorno = e.dados;
  const before = await one('select count(*)::int n,sum(valor_cents)::bigint soma from financial_account_movements where financial_account_id=$1',[conta]);
  const r = await rpc(master, 'fin_estorno_data_set', { _settlement: estorno, _data: '2026-10-09', _motivo: 'Diego: data correta do estorno', _esperada: '2026-10-16' });
  expect(r.erro).toBeNull();
  expect((await one('select data::text dia,valor_cents::int valor,reversed_of from financial_settlements where id=$1',[estorno]))).toMatchObject({ dia: '2026-10-09', valor: -310000, reversed_of: baixa });
  expect((await one('select count(*)::int n,sum(valor_cents)::bigint soma from financial_account_movements where financial_account_id=$1',[conta]))).toEqual(before);
  expect((await one('select sum(valor_cents)::int saldo from financial_account_movements where financial_account_id=$1 and data<=\'2026-10-09\'',[conta])).saldo).toBe(0);
  expect((await one('select data_anterior::text antes,data_nova::text depois from fin_estorno_data_correcoes where settlement_id=$1',[estorno]))).toMatchObject({ antes: '2026-10-16', depois: '2026-10-09' });
});

test('3 correção de data rejeita perfil sem permissão e retrocesso antes da baixa', async () => {
  expect((await rpc(consultora, 'fin_estorno_data_set', { _settlement: estorno, _data: '2026-10-10', _motivo: 'ISO', _esperada: '2026-10-09' })).ok).toBe(false);
  expect((await rpc(master, 'fin_estorno_data_set', { _settlement: estorno, _data: '2026-10-08', _motivo: 'ISO', _esperada: '2026-10-09' })).ok).toBe(false);
});

test('4 baixa já estornada aparece identificada no detalhe e segunda chamada não duplica', async () => {
  const original = await one('select i.title_id from financial_allocations a join financial_installments i on i.id=a.installment_id where a.settlement_id=$1',[baixa]);
  const d = await rpc<{ baixas: { settlement_id: string; ja_estornada: boolean }[] }>(master, 'fin_title_detail', { _title: original.title_id });
  expect(d.dados.baixas.find((b) => b.settlement_id === baixa)?.ja_estornada).toBe(true);
  expect((await rpc(master, 'fin_settlement_reverse_data', { _settlement: baixa, _motivo: 'Duplicação', _data: '2026-10-09' })).ok).toBe(false);
  expect((await one('select count(*)::int n from financial_settlements where reversed_of=$1',[baixa])).n).toBe(1);
});

test('5 alerta encontra nome igual mesmo inativo sem expor documento integral', async () => {
  const r = await rpc<{ id: string; motivo: string; doc_digits?: string }[]>(master, 'registry_duplicate_candidates', { _nome: 'ISO Daniel de Freitas Maciel', _doc: null });
  expect(r.erro).toBeNull();
  expect(r.dados.some((p) => p.id === party && p.motivo === 'nome')).toBe(true);
  expect(r.dados[0]).not.toHaveProperty('doc_digits');
});

test('2 vínculo existente mantém categoria 5.2.4 Aluguel e centro do título', async () => {
  const chart = (await one("insert into chart_of_accounts(codigo,nome,natureza) values('ISO-5.2.4','ISO Aluguel','despesa') returning id")).id;
  const center = (await one("insert into cost_centers(codigo,nome) values('ISO-ALUGUEL-NOVE','ISO Aluguel centro') returning id")).id;
  const t = await rpc<string>(master, 'fin_title_create', { _payload: { direction: 'payable', party_id: party, descricao: 'ISO Boleto aluguel', valor_cents: 300000, emissao: '2026-10-09', competencia: '2026-10-09', chart_account_id: chart, cost_center_id: center, parcelas: [{ vencimento: '2026-10-09', valor_cents: 300000 }] } });
  if (!t.ok) throw new Error(t.erro ?? 'Falha');
  const inst = (await one('select id from financial_installments where title_id=$1',[t.dados])).id;
  const file = (await one("insert into financial_statement_files(financial_account_id,storage_path,original_name,format,sha256) values($1,'iso/nove.ofx','nove.ofx','ofx',$2) returning id",[conta,`nove-${t.dados}`])).id;
  const imp = (await one('insert into financial_statement_imports(file_id,financial_account_id) values($1,$2) returning id',[file,conta])).id;
  const line = (await one("insert into financial_statement_lines(import_id,file_id,financial_account_id,line_no,data,valor_cents,kind,historico,hash,status) values($1,$2,$3,1,'2026-10-09',300000,'saida','ISO boleto aluguel',$4,'pendente') returning id",[imp,file,conta,`linha-${t.dados}`])).id;
  const r = await rpc(master, 'fin_reconcile', { _payload: { line_ids: [line], alocacoes: [{ installment_id: inst, valor_cents: 300000 }], idempotency_key: `nove-conciliar-${t.dados}` } });
  expect(r.erro).toBeNull();
  expect(await one('select chart_account_id,cost_center_id from financial_titles where id=$1',[t.dados])).toMatchObject({ chart_account_id: chart, cost_center_id: center });
});

test('3 escrita direta não muda estorno nem seus movimentos apesar de existir correção registrada', async () => {
  const c = await adm.reserve();
  try {
    await c.unsafe('set role authenticated');
    await c.unsafe("select set_config('lardan.test_uid',$1,false)",[master.uid ?? '']);
    await expect(c.unsafe("update financial_settlements set data='2026-10-10' where id=$1",[estorno])).rejects.toThrow();
    await expect(c.unsafe("update financial_account_movements set data='2026-10-10' where settlement_id=$1",[estorno])).rejects.toThrow();
  } finally {
    await c.unsafe('reset role');
    await c.unsafe("select set_config('lardan.test_uid','',false)");
    c.release();
  }
});

test('5 unificação oficial move título para Daniel canônico preservando número, valor e histórico', async () => {
  const dup = (await one("insert into parties(kind,display_name,status) values('pessoa','ISO Daniel de Freitas Maciel','inativo') returning id")).id;
  const t = await rpc<string>(master,'fin_title_create',{ _payload: { direction:'payable', party_id: dup, descricao: 'ISO pro-labore Daniel',valor_cents:300000,emissao:'2026-10-09',parcelas:[{vencimento:'2026-10-09',valor_cents:300000}] } });
  if (!t.ok) throw new Error(t.erro ?? 'Falha');
  const before = await one('select numero,valor_cents::int valor from financial_titles where id=$1',[t.dados]);
  const args = { _canonica:party,_duplicada:dup,_motivo:'Unificar Daniel para pró-labore' };
  const preview = await rpc<{ previa:boolean }>(master,'party_unificar',{...args,_executar:false});
  expect(preview.dados.previa).toBe(true);
  const r = await rpc(master,'party_unificar',{...args,_executar:true});
  expect(r.erro).toBeNull();
  expect(await one('select numero,valor_cents::int valor,party_id from financial_titles where id=$1',[t.dados])).toMatchObject({...before,party_id:party});
  expect((await one('select count(*)::int n from party_unificacoes where canonica_id=$1 and duplicada_id=$2',[party,dup])).n).toBe(1);
});
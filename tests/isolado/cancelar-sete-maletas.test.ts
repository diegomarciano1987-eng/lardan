import { beforeAll, expect, test } from 'bun:test';
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, rpcServico, rpc, saldo } from './base';

let ator = ''; let origem = ''; let variante = ''; let plano: Record<string, unknown>[] = [];
const chave = `iso-cancelamento-sete-${Date.now()}`;
const motivo = 'Cancelamento de sete maletas de teste autorizado pelo responsável';
beforeAll(async () => {
  const conta = await criarConta({nome:'cancelamento',papeis:['master']});
  ator = conta.uid ?? ''; origem = await criarDeposito('cancelamento');
  variante = await criarVariante('cancelamento'); await porEstoque(variante,origem,10);
  for(let i=0;i<7;i++) {
    const code = `ISO-CANCEL-${Date.now()}-${i}`;
    const kits = await adm.unsafe('insert into public.kits(code) values($1) returning id',[code]);
    const kit = kits[0]?.id; if(!kit) throw new Error('Kit ausente');
    const local = await adm.unsafe('select public.kit_location_ensure($1) id',[kit]);
    const loc = local[0]?.id; if(!loc) throw new Error('Local ausente');
    const cycles = await adm.unsafe("insert into public.kit_cycles(kit_id,cycle_no,status,origin_location_id,current_location_id) values($1,1,'transito',$2,$3) returning id",[kit,origem,loc]);
    const id = cycles[0]?.id; if(!id) throw new Error('Ciclo ausente');
    await porEstoque(variante,loc, i<5?4:0);
    plano.push({cycle_id:id,code,status:'transito',pieces:i<5?4:0});
  }
});
const executar = (p=plano, run=true, key=chave) => rpcServico<{cycles:number;pieces:number;repetida?:boolean}>('kit_testes_cancelar',{
  _plano:p,_ator:ator,_motivo:motivo,_chave:key,_executar:run,
});
test('quantidade esperada divergente não cancela nem devolve parcialmente',async()=>{
  const errado=plano.map((p,i)=>i===6?{...p,pieces:9}:p);
  expect((await executar(errado)).ok).toBe(false);
  expect(await saldo(variante,origem)).toBe(10);
  const rows=await adm.unsafe("select count(*)::int n from public.kit_cycles where status='cancelada'");
  expect(rows[0]?.n).toBe(0);
});
test('prévia das sete não altera o estoque',async()=>{
  const r=await executar(plano,false); expect(r.ok).toBe(true); expect(r.dados.cycles).toBe(7);
  expect(r.dados.pieces).toBe(20); expect(await saldo(variante,origem)).toBe(10);
});
test('somente serviço interno pode executar',async()=>{
  const r=await rpc(null,'kit_testes_cancelar',{_plano:plano,_ator:ator,_motivo:motivo,_chave:chave,_executar:true});
  expect(r.ok).toBe(false);
});
test('cancela exatamente sete, devolve com contrapartida e registra auditoria',async()=>{
  const r=await executar(); if(!r.ok) throw new Error(r.erro ?? 'Falha'); expect(r.dados.cycles).toBe(7); expect(r.dados.pieces).toBe(20);
  expect(await saldo(variante,origem)).toBe(30);
  const rows=await adm.unsafe("select count(*)::int n from public.audit_logs where action='kit.testes.cancelar' and payload->>'chave'=$1",[chave]);
  expect(rows[0]?.n).toBe(7);
  const qty=await adm.unsafe('select sum(quantity)::int n from public.stock_balances where location_id in (select current_location_id from public.kit_cycles where cancel_reason=$1)',[motivo]);
  expect(qty[0]?.n).toBe(0);
});
test('repetição não duplica devolução',async()=>{
  const r=await executar(); expect(r.ok).toBe(true); expect(r.dados.repetida).toBe(true);
  expect(await saldo(variante,origem)).toBe(30);
});
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, rpc, ler, escritaDireta, type Conta } from "./base";
let eu: Conta, outra: Conta, qualidade: Conta, item: string, order: string;
const abrir = (over: Record<string, unknown> = {}) => ({ _item: item, _tipo: "troca", _motivo: "Tamanho ou aro", _observacao: "", _solucao: "troca", _fotos: [], _excecao: false, _chave: crypto.randomUUID(), ...over });
beforeAll(async () => {
 eu=await criarConta({nome:"posvenda",papeis:["consultora"],comParty:true}); outra=await criarConta({nome:"posvenda-outra",papeis:["consultora"],comParty:true}); qualidade=await criarConta({nome:"posvenda-qualidade",papeis:["qualidade"]});
 const v=await criarVariante("posvenda",7990);
 const rows=await adm.unsafe("insert into public.sales_orders(consultora_party_id,customer_name,subtotal_cents,status,payment_status,created_at,pay_paid_at) values($1,'ISO Cliente',7990,'concluido','pago',now()-interval '100 days',now()-interval '45 days') returning id",[eu.partyId]); order=rows[0].id;
 const itens=await adm.unsafe("insert into public.sales_order_items(order_id,variant_id,product_name,quantity,unit_price_cents) values($1,$2,'ISO Peça pós-venda',1,7990) returning id",[order,v]); item=itens[0].id;
});
describe("Pós-venda protegido e auditado",()=>{
 test("prazo de 45 dias usa pagamento e não criação de 100 dias",async()=>{const r=await rpc<{compra_em:string;troca_ate:string;hoje:string}>(eu,"consultora_pos_venda_prazo",{_order:order});expect(r.ok).toBe(true);expect(r.dados.troca_ate).toBe(r.dados.hoje);});
 test("outra consultora não lê compra ou abre solicitação",async()=>{expect((await rpc(outra,"consultora_pos_venda_prazo",{_order:order})).dados).toBeNull();expect((await rpc(outra,"consultora_pos_venda_abrir",abrir())).ok).toBe(false);});
 test("garantia exige foto e aceita no máximo três",async()=>{expect((await rpc(eu,"consultora_pos_venda_abrir",abrir({_tipo:"garantia"}))).erro).toContain("foto");expect((await rpc(eu,"consultora_pos_venda_abrir",abrir({_fotos:["a","b","c","d"]}))).erro).toContain("três");});
 test("foto de outra conta é recusada",async()=>{expect((await rpc(eu,"consultora_pos_venda_abrir",abrir({_fotos:[`${outra.uid}/foto.jpg`]}))).erro).toContain("não pertence");});
 test("troca no dia 46 exige exceção sem aprovação automática",async()=>{await adm.unsafe("update public.sales_orders set pay_paid_at=now()-interval '46 days' where id=$1",[order]);expect((await rpc(eu,"consultora_pos_venda_abrir",abrir())).erro).toContain("Fora do prazo");await adm.unsafe("update public.sales_orders set pay_paid_at=now()-interval '45 days' where id=$1",[order]);});
 test("protocolo idempotente, RLS e análise sem estoque/dinheiro",async()=>{
 const args=abrir();const antes=await adm.unsafe("select (select count(*) from public.stock_movements)::int estoque,(select count(*) from public.financial_account_movements)::int caixa");
 const r=await rpc<{id:string;protocolo:string}>(eu,"consultora_pos_venda_abrir",args);expect(r.ok).toBe(true);expect(r.dados.protocolo).toMatch(/^TG-\d+$/);
 const repetida=await rpc<{id:string}>(eu,"consultora_pos_venda_abrir",args);expect(repetida.dados.id).toBe(r.dados.id);
 expect((await rpc(eu,"consultora_pos_venda_abrir",abrir())).erro).toContain("já tem");
 expect((await ler(outra,"select id from public.consultora_pos_venda where id=$1",[r.dados.id])).linhas).toHaveLength(0);
 expect((await escritaDireta(eu,"update public.consultora_pos_venda set status='aprovada' where id=$1",[r.dados.id])).ok).toBe(false);
 expect((await rpc(eu,"consultora_pos_venda_analisar",{_id:r.dados.id,_status:"aprovada",_resposta:"Teste indevido"})).ok).toBe(false);
 expect((await rpc(qualidade,"consultora_pos_venda_analisar",{_id:r.dados.id,_status:"aprovada",_resposta:"Sem analisar"})).ok).toBe(false);
 for(const status of ["em_analise","aprovada","resolvida"]) expect((await rpc(qualidade,"consultora_pos_venda_analisar",{_id:r.dados.id,_status:status,_resposta:"Encaminhamento isolado"})).ok).toBe(true);
 const eventos=await adm.unsafe("select status from public.consultora_pos_venda_eventos where request_id=$1 order by created_at",[r.dados.id]);expect(eventos.map(e=>e.status)).toEqual(["aberta","em_analise","aprovada","resolvida"]);
 const depois=await adm.unsafe("select (select count(*) from public.stock_movements)::int estoque,(select count(*) from public.financial_account_movements)::int caixa");expect(depois[0]).toEqual(antes[0]);
 });
});
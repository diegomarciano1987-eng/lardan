/** Reprodução dos defeitos ANTES da correção (arquivo temporário). */
import { expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico } from "./base";
import { SimuladorAsaas } from "../../src/lib/asaas/simulador";
import { TransporteHttpAsaas } from "../../src/lib/asaas/transporte-http.server";
import { executarIntencao, prepararIntencao } from "../../src/lib/asaas/cobranca";
import { CredencialRecusada } from "../../src/lib/asaas/contrato";

const servico = { async rpc<T>(fn: string, a: Record<string, unknown>) { const r = await rpcServico<T>(fn, a); if (!r.ok) throw new Error(r.erro!); return r.dados; } };
test("reproduz", async () => {
  const fin = await criarConta({ nome: "rep", papeis: ["financeiro", "master"], comParty: true });
  const [e] = await adm.unsafe(`insert into business_entities(legal_name,trade_name) values('REP','REP') returning id`) as {id:string}[];
  const [a] = await adm.unsafe(`insert into asaas_accounts(label,environment,state,owner_entity_id,opening_balance_strategy,external_account_id) values('REP','sandbox','simulada',$1,'ignorar_anteriores','acc_rep_'||md5(random()::text)) returning id`, [e!.id]) as {id:string}[];
  const [p] = await adm.unsafe(`insert into parties(kind,display_name,legal_name,status) values('pessoa','REP','REP','ativo') returning id`) as {id:string}[];
  await adm.unsafe(`insert into asaas_customers(account_id,external_id,name,party_id,match_status) values($1,'cus_rep_'||md5(random()::text),'x',$2,'vinculado')`, [a!.id, p!.id]);
  const u = { async rpc<T>(fn: string, x: Record<string, unknown>) { const r = await rpc<T>(fin, fn, x); if (!r.ok) throw new Error(r.erro!); return r.dados; } };
  const t = await rpc<string>(fin, "fin_title_create", { _payload: { direction: "receivable", business_entity_id: e!.id, party_id: p!.id, descricao: "rep", valor_cents: 1000, emissao: "2026-10-10", origem: "manual", status: "ativo", parcelas: [{ vencimento: "2026-10-10", valor_cents: 1000 }] } });
  await rpc(fin, "fin_title_approve", { _title: t.dados, _motivo: "rep" });
  const [i] = await adm.unsafe(`select id from financial_installments where title_id=$1`, [t.dados]) as {id:string}[];
  const sim = new SimuladorAsaas({ conta: a!.id, semente: "rep" });
  sim.criarCobranca = async () => { throw new CredencialRecusada(401, ["invalid_access_token"]); };
  const it = await prepararIntencao(u, { installmentId: i!.id, billingType: "PIX" });
  const r1 = await executarIntencao(servico, sim, it.id!, { actor: fin.uid });
  const [row] = await adm.unsafe(`select state, lease_until, next_attempt_at from asaas_charge_intents where id=$1`, [it.id]) as any[];
  console.log("REPRO-1 após 401:", JSON.stringify(row), "resposta:", JSON.stringify(r1));
  await adm.unsafe(`update asaas_charge_intents set next_attempt_at=now()-interval '1 hour' where id=$1`, [it.id]).catch((x)=>console.log("update direto recusado:", (x as Error).message));
  const pend = await rpcServico("asaas_exec_pendentes", { _account: a!.id, _preparada_seg: 0 });
  console.log("REPRO-1 pendentes contém a intenção?", JSON.stringify(pend.dados).includes(it.id!));
  const res = await rpcServico("asaas_exec_reservar", { _intent: it.id, _worker: "w2", _actor: fin.uid });
  console.log("REPRO-1 reservar depois:", JSON.stringify(res.dados));
  const h = new TransporteHttpAsaas({ ambiente: "sandbox", chave: "$aact_hmlg_x", fetch: async () => new Response(JSON.stringify({ hasMore: true, data: [{ id: "pay_1", dueDate: "2026-01-01", status: "PENDING" }] }), { status: 200, headers: { "content-type": "application/json" } }) });
  const pg = await h.listarCobrancas({ limit: 100, offset: 0 });
  console.log("REPRO-5 próximo offset com hasMore e 1 item (limit 100):", pg.proximoOffset);
  expect(true).toBe(true);
}, 60000);

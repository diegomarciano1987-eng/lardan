/**
 * 0361 — pedidos do Diego em 22/11/2026 (banco ISOLADO, dados sintéticos):
 *  1) recebimento de consultora já nasce classificado: 3.1.1 + centro de custo Comercial, sem a Larissa confirmar nada;
 *  2) "Liquidar dívida": apagar a dívida (inteira ou uma parcela) com motivo, registrando quem fez;
 *     cobrança aberta no Asaas volta na resposta para o servidor cancelar na hora.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let financeiro: Conta, estoque: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
let emp: string, banco: string, acc: string, plano311: string, planoFiado: string, plano717: string, comercial: string;

const saldo = async (inst: string) => Number((await um<{ s: string }>(`select public.fin_installment_saldo($1) s`, [inst])).s);
async function pessoa() {
  return (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO 0361 ${marca()}`])).id;
}
async function plano(codigo: string, natureza: string) {
  const r = await um<{ id: string } | undefined>(`select id from public.chart_of_accounts where codigo=$1 limit 1`, [codigo]);
  if (r?.id) return r.id;
  return (await um<{ id: string }>(`insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,$2::fin_account_nature) returning id`, [codigo, natureza])).id;
}
async function titulo(party: string, parcelas: number[], extra: Record<string, unknown> = {}) {
  const t = await rpc<string>(financeiro, "fin_title_create", { _payload: {
    direction: "receivable", party_id: party, descricao: "ISO 0361 fatura consultora", valor_cents: parcelas.reduce((a, b) => a + b, 0),
    emissao: "2026-11-01", competencia: "2026-11-01", business_entity_id: emp, chart_account_id: plano311,
    parcelas: parcelas.map((v, i) => ({ vencimento: `2026-12-${String(10 + i).padStart(2, "0")}`, valor_cents: v })), ...extra } });
  if (!t.ok) throw new Error(t.erro!);
  const insts = (await adm.unsafe(`select id from public.financial_installments where title_id=$1 order by numero`, [t.dados])) as { id: string }[];
  return { id: t.dados, insts: insts.map((x) => x.id) };
}
async function cobrancaAberta(party: string, title: string, inst: string, valor: number) {
  return (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(
      `insert into public.asaas_charges (account_id, external_id, customer_external_id, value_cents, due_date, billing_type, external_status, party_id, title_id, installment_id, raw, reconcile_status)
       values ($1,$2,'cus_iso',$3,'2026-12-10','BOLETO','OVERDUE',$4,$5,$6,'{}'::jsonb,'vinculado') returning id`,
      [acc, `pay_${marca()}`, valor, party, title, inst])) as { id: string }[];
  }))[0]!.id;
}
const liquidar = (conta: Conta, title: string, inst: string | null, motivo: string) =>
  rpc<{ modo: string; valor_cents: number; cobrancas: { id: string }[] }>(conta, "fin_divida_liquidar", { _title: title, _installment: inst, _motivo: motivo });

beforeAll(async () => {
  financeiro = await criarConta({ nome: "fin-0361", papeis: ["financeiro"], comParty: true });
  estoque = await criarConta({ nome: "estoque-0361", papeis: ["estoque"], comParty: true });
  await adm.unsafe(`insert into public.user_financial_access (user_id, nivel) values ($1,'completo') on conflict do nothing`, [financeiro.uid]).catch(() => undefined);
  emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp 0361 ${marca()}`])).id;
  banco = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco 0361 ${marca()}`])).id;
  const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas 0361 ${marca()}`])).id;
  acc = (await um<{ id: string }>(`insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active) values ($1,'sandbox',$2,$3,true) returning id`, [`ISO 0361 ${marca()}`, fin, emp])).id;
  plano311 = await plano("3.1.1", "receita");
  planoFiado = await plano("FIADO-HIST", "ativo");
  plano717 = await plano("7.1.7", "receita");
  const cc = await um<{ id: string } | undefined>(`select id from public.cost_centers where codigo='comercial' limit 1`);
  comercial = cc?.id ?? (await um<{ id: string }>(`insert into public.cost_centers (codigo, nome) values ('comercial','Comercial') returning id`)).id;
});

describe("0361 · classificação automática do recebimento de consultora", () => {
  test("3.1.1 sem centro de custo → nasce com Comercial (não fica 'Pendente de classificação')", async () => {
    const t = await titulo(await pessoa(), [20621]);
    const r = await um<{ cost_center_id: string }>(`select cost_center_id from public.financial_titles where id=$1`, [t.id]);
    expect(r.cost_center_id).toBe(comercial);
    const d = await rpc<{ titulo: { pendente_classificacao: boolean } }>(financeiro, "fin_title_detail", { _title: t.id });
    expect(d.dados.titulo.pendente_classificacao).toBe(false);
  });
  test("fiado histórico (FIADO-HIST) também recebe Comercial", async () => {
    const t = await titulo(await pessoa(), [10000], { chart_account_id: planoFiado });
    expect((await um<{ c: string }>(`select cost_center_id c from public.financial_titles where id=$1`, [t.id])).c).toBe(comercial);
  });
  test("escolha explícita de outro centro de custo é respeitada; outras contas (7.1.7) não são tocadas", async () => {
    const outro = (await um<{ id: string }>(`insert into public.cost_centers (codigo, nome) values ($1,'Adm ISO') returning id`, [`iso-adm-${marca()}`])).id;
    const a = await titulo(await pessoa(), [5000], { cost_center_id: outro });
    expect((await um<{ c: string }>(`select cost_center_id c from public.financial_titles where id=$1`, [a.id])).c).toBe(outro);
    const b = await titulo(await pessoa(), [5000], { chart_account_id: plano717 });
    expect((await um<{ c: string | null }>(`select cost_center_id c from public.financial_titles where id=$1`, [b.id])).c).toBeNull();
  });
});

describe("0361 · liquidar dívida", () => {
  test("dívida sem pagamento (caso Jessica R$ 206,21): título cancelado, motivo e quem fez registrados, cobrança Asaas devolvida para cancelar", async () => {
    const p = await pessoa();
    const t = await titulo(p, [20621]);
    const ch = await cobrancaAberta(p, t.id, t.insts[0]!, 20621);
    const r = await liquidar(financeiro, t.id, null, "Erro de lançamento, dívida não existe");
    expect(r.erro ?? null).toBeNull();
    expect(r.dados.modo).toBe("cancelado");
    expect(Number(r.dados.valor_cents)).toBe(20621);
    expect(r.dados.cobrancas.map((c) => c.id)).toEqual([ch]);
    const st = await um<{ status: string; cancel_reason: string }>(`select status::text, cancel_reason from public.financial_titles where id=$1`, [t.id]);
    expect(st.status).toBe("cancelado");
    expect(st.cancel_reason).toContain("Erro de lançamento");
    const ev = await um<{ actor_id: string; motivo: string }>(`select actor_id, motivo from public.financial_title_events where title_id=$1 and evento='divida_liquidada'`, [t.id]);
    expect(ev.actor_id).toBe(financeiro.uid);
    const au = await um<{ actor_id: string; v: string }>(`select actor_id, payload->>'valor_cents' v from public.audit_logs where action='fin.divida.liquidar' and entity_id=$1`, [t.id]);
    expect(au.actor_id).toBe(financeiro.uid);
    expect(Number(au.v)).toBe(20621);
    // servidor cancelou no Asaas → registro oficial marca DELETED, sem alerta falso de "excluída"
    await adm.unsafe(`select public.asaas_cobranca_cancelar_registrar($1,$2,'Dívida liquidada: teste','cancelada','OVERDUE',null)`, [ch, financeiro.uid]);
    expect((await um<{ s: string }>(`select external_status s from public.asaas_charges where id=$1`, [ch])).s).toBe("DELETED");
    expect(Number((await um<{ n: string }>(`select count(*) n from public.asaas_divergencia_alertas where charge_id=$1`, [ch])).n)).toBe(0);
  });

  test("dívida já paga em parte: só o saldo é abatido, o pagamento continua, parcela fica Paga", async () => {
    const p = await pessoa();
    const t = await titulo(p, [50000]);
    const b = await rpc(financeiro, "fin_settlement_create_ajustes", { _payload: {
      direction: "receivable", financial_account_id: banco, data: "2026-11-15", valor_cents: 20000, idempotency_key: `iso0361:${marca()}`,
      alocacoes: [{ installment_id: t.insts[0], valor_cents: 20000 }] } });
    expect(b.erro ?? null).toBeNull();
    const r = await liquidar(financeiro, t.id, null, "Acordo verbal com a consultora");
    expect(r.dados.modo).toBe("abatido");
    expect(Number(r.dados.valor_cents)).toBe(30000);
    expect(await saldo(t.insts[0]!)).toBe(0);
    const i = await um<{ s: string }>(`select settlement_status::text s from public.financial_installments where id=$1`, [t.insts[0]]);
    expect(i.s).toBe("liquidado");
    const pago = await um<{ s: string }>(`select coalesce(sum(valor_cents),0) s from public.financial_allocations where installment_id=$1`, [t.insts[0]]);
    expect(Number(pago.s)).toBe(20000);
    expect((await um<{ status: string }>(`select status::text from public.financial_titles where id=$1`, [t.id])).status).toBe("ativo");
    // clicar de novo não abate duas vezes
    const de_novo = await liquidar(financeiro, t.id, null, "Acordo verbal com a consultora");
    expect(de_novo.dados.modo).toBe("ja_liquidada");
    const aj = await um<{ n: string }>(`select count(*) n from public.financial_adjustments where installment_id=$1 and kind='abatimento'`, [t.insts[0]]);
    expect(Number(aj.n)).toBe(1);
  });

  test("liquidar só uma parcela (caso Luciana): a outra parcela continua devendo", async () => {
    const p = await pessoa();
    const t = await titulo(p, [77681, 88690]);
    const r = await liquidar(financeiro, t.id, t.insts[0]!, "Baixa feita no Asaas pela equipe");
    expect(r.dados.modo).toBe("abatido");
    expect(await saldo(t.insts[0]!)).toBe(0);
    expect(await saldo(t.insts[1]!)).toBe(88690);
    const i = await um<{ s: string }>(`select settlement_status::text s from public.financial_installments where id=$1`, [t.insts[0]]);
    expect(i.s).toBe("liquidado");
    expect((await um<{ status: string }>(`select status::text from public.financial_titles where id=$1`, [t.id])).status).toBe("ativo");
  });

  test("sem motivo, sem acesso ao financeiro ou parcela de acordo: recusado e nada muda", async () => {
    const p = await pessoa();
    const t = await titulo(p, [10000]);
    expect((await liquidar(financeiro, t.id, null, "abc")).erro).toContain("motivo");
    expect((await liquidar(estoque, t.id, null, "Motivo suficiente")).erro).toContain("Sem permissão");
    const sim = await um<{ id: string }>(`insert into public.cob_simulacoes(party_id, installment_ids, data_base, multa_pct, juros_mes_pct, principal_cents, encargos_cents, total_cents, parcelas, status)
       values ($1, array[$2]::uuid[], '2026-11-01', 0, 0, 10000, 0, 10000, 1, 'aguardando_pagamento') returning id`, [p, t.insts[0]]).catch(async () =>
      um<{ id: string }>(`insert into public.cob_simulacoes(party_id, installment_ids, data_base, multa_pct, juros_mes_pct, principal_cents, encargos_cents, total_cents, parcelas)
       values ($1, array[$2]::uuid[], '2026-11-01', 0, 0, 10000, 0, 10000, 1) returning id`, [p, t.insts[0]]));
    await adm.begin(async (tx) => {
      await tx.unsafe("select set_config('lardann.asaas_intent','on',true)");
      const ref = `iso0361:${marca()}`;
      await tx.unsafe(`insert into public.asaas_charge_intents(account_id,title_id,installment_id,party_id,value_cents,due_date,billing_type,internal_reference,idempotency_key,content_hash,acordo_simulacao_id,acordo_parcela,state)
        values ($1,$2,$3,$4,10000,'2026-12-10','PIX',$5,$5,$5,$6,1,'criada')`, [acc, t.id, t.insts[0], p, ref, sim.id]);
    });
    expect((await liquidar(financeiro, t.id, null, "Motivo suficiente")).erro).toContain("acordo");
    expect(await saldo(t.insts[0]!)).toBe(10000);
    expect((await um<{ status: string }>(`select status::text from public.financial_titles where id=$1`, [t.id])).status).toBe("ativo");
  });
});

/**
 * 0360 — "Pago por outra forma" na gaveta da cobrança Asaas (banco ISOLADO, dados sintéticos).
 * Casos de origem (20/11/2026): Natalia pagou tudo direto na conta (baixa total) e Cristina pagou R$ 260,00 de R$ 502,10
 * (baixa parcial, fica devendo R$ 242,10). Cobranças do SmallData sem título no Lardan.
 * Regra do Diego: parcial com cobrança no Asaas → a do Asaas é cancelada e a Larissa lança outra do saldo.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let financeiro: Conta, estoque: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
let fin: string, emp: string, acc: string, banco: string;

async function pessoa() {
  return (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO 0360 ${marca()}`])).id;
}
async function cobranca(party: string, valor: number) {
  return (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(
      `insert into public.asaas_charges (account_id, external_id, customer_external_id, value_cents, due_date, billing_type, external_status, party_id, raw, reconcile_status)
       values ($1,$2,'cus_iso',$3,'2026-11-25','BOLETO','PENDING',$4,'{"dateCreated":"2026-11-10"}'::jsonb,'pendente') returning id`,
      [acc, `pay_${marca()}`, valor, party])) as { id: string }[];
  }))[0]!.id;
}
const pagar = (conta: Conta, charge: string, valor: number) =>
  rpc<{ id: string; saldo_restante_cents: number; parcial: boolean; title_id: string; criou_titulo: boolean }>(conta, "asaas_pago_outra_forma", {
    _charge: charge, _conta: banco, _data: "2026-11-19", _valor: valor, _forma: "pix", _comprovante: null, _obs: "teste 0360" });
const saldo = async (inst: string) => Number((await um<{ s: string }>(`select public.fin_installment_saldo($1) s`, [inst])).s);

beforeAll(async () => {
  financeiro = await criarConta({ nome: "fin-0360", papeis: ["financeiro"], comParty: true });
  estoque = await criarConta({ nome: "estoque-0360", papeis: ["estoque"], comParty: true });
  await adm.unsafe(`insert into public.user_financial_access (user_id, nivel) values ($1,'completo') on conflict do nothing`, [financeiro.uid]).catch(() => undefined);
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas 0360 ${marca()}`])).id;
  banco = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco 0360 ${marca()}`])).id;
  emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp 0360 ${marca()}`])).id;
  acc = (await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active) values ($1,'sandbox',$2,$3,true) returning id`, [`ISO 0360 ${marca()}`, fin, emp])).id;
});

describe("0360 · baixa manual de cobrança Asaas sem título no Lardan", () => {
  test("caso Cristina: R$ 260,00 de R$ 502,10 → título criado, baixa de R$ 260,00, saldo R$ 242,10, Asaas cancelado sem alerta falso", async () => {
    const p = await pessoa();
    const ch = await cobranca(p, 50210);
    const r = await pagar(financeiro, ch, 26000);
    expect(r.erro ?? null).toBeNull();
    expect(r.dados.parcial).toBe(true);
    expect(r.dados.criou_titulo).toBe(true);
    expect(Number(r.dados.saldo_restante_cents)).toBe(24210);
    const lig = await um<{ title_id: string; installment_id: string }>(`select title_id, installment_id from public.asaas_charges where id=$1`, [ch]);
    expect(lig.title_id).toBe(r.dados.title_id);
    const t = await um<{ valor_cents: string; status: string; party_id: string }>(`select valor_cents, status::text, party_id from public.financial_titles where id=$1`, [lig.title_id]);
    expect(Number(t.valor_cents)).toBe(50210);
    expect(t.status).toBe("ativo");
    expect(t.party_id).toBe(p);
    expect(await saldo(lig.installment_id)).toBe(24210);
    const mov = await um<{ s: string }>(`select coalesce(sum(m.valor_cents),0) s from public.financial_account_movements m join public.asaas_baixas_outra_forma b on b.settlement_id = m.settlement_id where b.charge_id=$1 and m.financial_account_id=$2`, [ch, banco]);
    expect(Number(mov.s)).toBe(26000);
    // servidor cancelou no Asaas → registra
    const b = await um<{ id: string }>(`select id from public.asaas_baixas_outra_forma where charge_id=$1`, [ch]);
    await adm.unsafe(`select public.asaas_outra_forma_cancelamento($1, true, null)`, [b.id]);
    const st = await um<{ external_status: string }>(`select external_status from public.asaas_charges where id=$1`, [ch]);
    expect(st.external_status).toBe("DELETED");
    const al = await um<{ n: string }>(`select count(*) n from public.asaas_divergencia_alertas where charge_id=$1`, [ch]);
    expect(Number(al.n)).toBe(0);
    expect(await saldo(lig.installment_id)).toBe(24210); // saldo continua para a nova cobrança
  });

  test("caso Natalia: pagou tudo (R$ 277,57) → baixa total, saldo zero", async () => {
    const p = await pessoa();
    const ch = await cobranca(p, 27757);
    const r = await pagar(financeiro, ch, 27757);
    expect(r.erro ?? null).toBeNull();
    expect(r.dados.parcial).toBe(false);
    expect(Number(r.dados.saldo_restante_cents)).toBe(0);
  });

  test("clique repetido não baixa duas vezes", async () => {
    const p = await pessoa();
    const ch = await cobranca(p, 10000);
    expect((await pagar(financeiro, ch, 4000)).ok).toBe(true);
    const de_novo = await pagar(financeiro, ch, 4000);
    expect(de_novo.ok).toBe(false);
    expect(de_novo.erro).toContain("já foi marcada");
  });

  test("valor maior que o devido é recusado e nada é lançado", async () => {
    const p = await pessoa();
    const ch = await cobranca(p, 10000);
    const r = await pagar(financeiro, ch, 10001);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Valor maior");
    const x = await um<{ n: string }>(`select count(*) n from public.financial_titles where id_externo = (select 'asaas:'||external_id from public.asaas_charges where id=$1)`, [ch]);
    expect(Number(x.n)).toBe(0);
  });

  test("cliente com dívida antiga do SmallData em aberto: recusa (evita dívida em dobro)", async () => {
    const p = await pessoa();
    const t = await rpc<string>(financeiro, "fin_title_create", { _payload: {
      direction: "receivable", party_id: p, descricao: "ISO 0360 fiado", valor_cents: 30000, emissao: "2026-06-01", competencia: "2026-06-01",
      business_entity_id: emp, origem: "importacao", sistema_origem: "fiado_historico", id_externo: `iso0360:${marca()}`,
      parcelas: [{ vencimento: "2026-08-01", valor_cents: 30000 }] } });
    expect(t.ok).toBe(true);
    const ch = await cobranca(p, 50210);
    const r = await pagar(financeiro, ch, 26000);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("dívida antiga do SmallData");
    const lig = await um<{ title_id: string | null }>(`select title_id from public.asaas_charges where id=$1`, [ch]);
    expect(lig.title_id).toBeNull();
  });

  test("quem não tem acesso ao financeiro não consegue dar baixa", async () => {
    const p = await pessoa();
    const ch = await cobranca(p, 10000);
    const r = await pagar(estoque, ch, 10000);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Sem acesso");
  });
});

describe("0360 · conferência de permissão das ações Asaas na tela", () => {
  test("asaas_eu_posso responde pela sessão: financeiro sim, estoque não (asaas_ator_pode não é chamável pela tela)", async () => {
    expect((await rpc<boolean>(financeiro, "asaas_eu_posso", { _cap: "finance.receivable.manage" })).dados).toBe(true);
    expect((await rpc<boolean>(estoque, "asaas_eu_posso", { _cap: "finance.receivable.manage" })).dados).toBe(false);
    const direto = await rpc<boolean>(financeiro, "asaas_ator_pode", { _actor: financeiro.uid, _cap: "finance.receivable.manage" });
    expect(direto.ok).toBe(false);
  });
});

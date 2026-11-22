/**
 * 0368 (Diego, 22/11/2026) — conciliação de Pix (OFX Santander) pelo CPF. Banco ISOLADO, dados sintéticos.
 *  - CPF/CNPJ no fim do histórico acha a pessoa só quando há UM cadastro (unificados contam como um);
 *  - distribui o valor da mais antiga para a mais nova; faltando dinheiro, baixa parcial na última e o saldo fica aberto;
 *  - parcela em acordo fica fora; nada é baixado sem a pessoa confirmar (fin_reconcile).
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
  return (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO 0368 ${marca()}`])).id;
}
async function plano(codigo: string, natureza: string) {
  const r = await um<{ id: string } | undefined>(`select id from public.chart_of_accounts where codigo=$1 limit 1`, [codigo]);
  if (r?.id) return r.id;
  return (await um<{ id: string }>(`insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,$2::fin_account_nature) returning id`, [codigo, natureza])).id;
}
async function titulo(party: string, parcelas: number[], extra: Record<string, unknown> = {}) {
  const t = await rpc<string>(financeiro, "fin_title_create", { _payload: {
    direction: "receivable", party_id: party, descricao: "ISO 0368 fatura consultora", valor_cents: parcelas.reduce((a, b) => a + b, 0),
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
  financeiro = await criarConta({ nome: "fin-0368", papeis: ["financeiro"], comParty: true });
  estoque = await criarConta({ nome: "estoque-0368", papeis: ["estoque"], comParty: true });
  await adm.unsafe(`insert into public.user_financial_access (user_id, nivel) values ($1,'completo') on conflict do nothing`, [financeiro.uid]).catch(() => undefined);
  emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp 0368 ${marca()}`])).id;
  banco = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco 0368 ${marca()}`])).id;
  const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas 0368 ${marca()}`])).id;
  acc = (await um<{ id: string }>(`insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active) values ($1,'sandbox',$2,$3,true) returning id`, [`ISO 0368 ${marca()}`, fin, emp])).id;
  plano311 = await plano("3.1.1", "receita");
  planoFiado = await plano("FIADO-HIST", "ativo");
  plano717 = await plano("7.1.7", "receita");
  const cc = await um<{ id: string } | undefined>(`select id from public.cost_centers where codigo='comercial' limit 1`);
  comercial = cc?.id ?? (await um<{ id: string }>(`insert into public.cost_centers (codigo, nome) values ('comercial','Comercial') returning id`)).id;
});

function cpf(): string {
  const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (x: number[]) => { const s = x.reduce((a, d, i) => a + d * (x.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b); return [...b, d1, dv([...b, d1])].join("");
}
let file = "", imp = "", linhaNo = 0;
async function comCpf(doc: string) {
  const p = await pessoa();
  await adm.unsafe(`update public.parties set doc=$2, doc_digits=$2 where id=$1`, [p, doc]);
  return p;
}
async function linha(valor: number, historico: string) {
  if (!file) {
    file = (await um<{ id: string }>(`insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256) values ($1,$2,'ISO OFX','ofx',$2) returning id`, [banco, `iso-0368-${marca()}`])).id;
    imp = (await um<{ id: string }>(`insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [file, banco])).id;
  }
  return (await um<{ id: string }>(`insert into public.financial_statement_lines (financial_account_id, file_id, import_id, line_no, data, valor_cents, kind, historico, documento, bank_id, raw, status)
     values ($1,$2,$3,$4,'2026-11-20',$5,'entrada',$6,'00000000',$7,'{}'::jsonb,'pendente') returning id`, [banco, file, imp, ++linhaNo, valor, historico, `bk_${marca()}`])).id;
}
type Plano = { situacao: string; party_id?: string; documento?: string; total_aberto_cents?: number; distribuido_cents?: number; sobra_cents?: number;
  parcelas?: { installment_id: string; aberto_cents: number; aloc_cents: number; parcial: boolean; em_acordo: boolean }[]; cadastros?: unknown[] };
const planoCpf = async (l: string, quem: Conta = financeiro) => rpc<Plano>(quem, "fin_mesa_por_documento", { _line: l });

describe("0368 — conciliação de Pix pelo CPF", () => {
  test("CPF único: dívidas mais antigas primeiro; falta dinheiro → baixa parcial na última e o saldo fica em aberto", async () => {
    const doc = cpf();
    const p = await comCpf(doc);
    const t = await titulo(p, [10000, 10000]);
    const l = await linha(15000, `PIX RECEBIDO     ${doc}`);
    const r = await planoCpf(l);
    expect(r.erro).toBeNull();
    expect(r.dados).toMatchObject({ situacao: "ok", party_id: p, total_aberto_cents: 20000, distribuido_cents: 15000, sobra_cents: 0 });
    expect(r.dados.documento).toBe(`${doc.slice(0, 3)}.***.***-${doc.slice(9)}`);
    expect(r.dados.parcelas!.map((x) => [x.installment_id, x.aloc_cents, x.parcial])).toEqual([[t.insts[0], 10000, false], [t.insts[1], 5000, true]]);
    // confirmar na mesa (fin_reconcile) com a distribuição sugerida
    const c = await rpc(financeiro, "fin_reconcile", { _payload: { line_ids: [l], idempotency_key: `iso0368:${marca()}`,
      alocacoes: r.dados.parcelas!.filter((x) => x.aloc_cents > 0).map((x) => ({ installment_id: x.installment_id, valor_cents: x.aloc_cents })) } });
    expect(c.erro).toBeNull();
    expect(await saldo(t.insts[0]!)).toBe(0);
    expect(await saldo(t.insts[1]!)).toBe(5000);
  });

  test("valor maior que a dívida: distribui tudo o que está aberto e mostra a sobra", async () => {
    const doc = cpf();
    const p = await comCpf(doc);
    await titulo(p, [3000]);
    const r = await planoCpf(await linha(5000, `PIX RECEBIDO     ${doc}`));
    expect(r.dados).toMatchObject({ situacao: "ok", total_aberto_cents: 3000, distribuido_cents: 3000, sobra_cents: 2000 });
  });

  test("parcela dentro de acordo de cobrança fica fora da distribuição", async () => {
    const doc = cpf();
    const p = await comCpf(doc);
    const t = await titulo(p, [10000, 4000]);
    const sim = await um<{ id: string }>(`insert into public.cob_simulacoes(party_id, installment_ids, data_base, multa_pct, juros_mes_pct, principal_cents, encargos_cents, total_cents, parcelas)
       values ($1, array[$2]::uuid[], '2026-11-01', 0, 0, 10000, 0, 10000, 1) returning id`, [p, t.insts[0]]);
    await adm.begin(async (tx) => {
      await tx.unsafe("select set_config('lardann.asaas_intent','on',true)");
      const ref = `iso0368:${marca()}`;
      await tx.unsafe(`insert into public.asaas_charge_intents(account_id,title_id,installment_id,party_id,value_cents,due_date,billing_type,internal_reference,idempotency_key,content_hash,acordo_simulacao_id,acordo_parcela,state)
        values ($1,$2,$3,$4,10000,'2026-12-10','PIX',$5,$5,$5,$6,1,'criada')`, [acc, t.id, t.insts[0], p, ref, sim.id]);
    });
    const r = await planoCpf(await linha(4000, `PIX RECEBIDO     ${doc}`));
    expect(r.dados.parcelas!.map((x) => [x.em_acordo, x.aloc_cents])).toEqual([[true, 0], [false, 4000]]);
    expect(r.dados.total_aberto_cents).toBe(4000);
  });

  test("dois cadastros com o mesmo CPF: não sugere ninguém; unificado conta como um", async () => {
    const doc = cpf();
    const a = await comCpf(doc);
    const b = await pessoa();
    await adm.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(`update public.parties set doc=$2, doc_digits=$2 where id=$1`, [b, doc]);
    });
    await titulo(a, [1000]);
    const l = await linha(1000, `PIX RECEBIDO     ${doc}`);
    const r = await planoCpf(l);
    expect(r.dados.situacao).toBe("varios_cadastros");
    expect(r.dados.party_id).toBeUndefined();
    expect(r.dados.cadastros).toHaveLength(2);
    await adm.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(`insert into public.party_unificacoes (canonica_id, duplicada_id, motivo) values ($1,$2,'ISO 0368')`, [a, b]);
    });
    expect((await planoCpf(l)).dados).toMatchObject({ situacao: "ok", party_id: a });
  });

  test("sem CPF no histórico, CPF desconhecido ou nada em aberto: só informa; sem acesso ao extrato, recusa", async () => {
    expect((await planoCpf(await linha(1000, "PIX RECEBIDO SEM DOC"))).dados.situacao).toBe("sem_documento");
    expect((await planoCpf(await linha(1000, `PIX RECEBIDO     ${cpf()}`))).dados.situacao).toBe("sem_cadastro");
    const doc = cpf();
    await comCpf(doc);
    const l = await linha(1000, `PIX RECEBIDO     ${doc}`);
    expect((await planoCpf(l)).dados.situacao).toBe("sem_aberto");
    expect((await planoCpf(l, estoque)).erro).toContain("Sem permissão");
  });
});

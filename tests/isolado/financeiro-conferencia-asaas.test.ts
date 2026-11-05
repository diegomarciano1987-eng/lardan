/**
 * 0235 — financeiro batendo entre telas e com o Asaas. Banco ISOLADO, dados sintéticos.
 *  1. Conferência da conta Asaas: saldo real (extrato) × Lardan e o que explica a diferença
 *     (recebido sem lançamento, baixa de cobrança "recebida em dinheiro", lançado duas vezes).
 *  2. Fluxo de caixa: previsto inclui cobrança do Asaas sem título (igual à Visão geral).
 *  3. Visão geral: conta inativa com saldo entra no saldo em contas.
 *  4. Mesa Asaas: busca por código é exata (não casa CPF por dígitos do código).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta, consultora: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const oficial = async <T>(sql: string, p: unknown[] = []) =>
  (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(sql, p)) as T[];
  }))[0]!;
const DIA = "2026-10-10";
let plano: string, emp: string;

async function contaAsaas(ambiente: "sandbox" | "producao" = "sandbox") {
  const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas ${marca()}`])).id;
  const acc = (await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active) values ($1,$4,$2,$3,true) returning id`,
    [`ISO ${marca()}`, fin, emp, ambiente])).id;
  const file = (await um<{ id: string }>(
    `insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256) values ($1,'x','Extrato Asaas ISO','csv',$2) returning id`,
    [fin, marca()])).id;
  const imp = (await um<{ id: string }>(`insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [file, fin])).id;
  let linha = 0;
  const extrato = (data: string, valor: number, kind: "entrada" | "saida", saldo: number, pay: string | null, status = "pendente", tipo = "PAYMENT_RECEIVED") =>
    adm.unsafe(`insert into public.financial_statement_lines (import_id, file_id, financial_account_id, line_no, raw, data, valor_cents, kind, historico, documento, bank_id, status)
                values ($1,$2,$3,$4,$5::text::jsonb,$6,$7,$8,$9,$10,$11,$12::fin_statement_line_status)`,
      [imp, file, fin, ++linha, JSON.stringify({ balance: saldo / 100, type: tipo }), data, valor, kind, `Cobrança recebida ISO ${pay}`, pay, `ftn_${String(linha).padStart(6, "0")}`, status]);
  return { fin, acc, extrato };
}

async function titulo(party: string, valor: number) {
  const r = await rpc<string>(master, "fin_title_create", {
    _payload: { direction: "receivable", party_id: party, descricao: `ISO ${marca()}`, valor_cents: valor, emissao: DIA, competencia: DIA,
      business_entity_id: emp, chart_account_id: plano, parcelas: [{ vencimento: DIA, valor_cents: valor }] } });
  if (!r.ok) throw new Error(r.erro!);
  return (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [r.dados])).id;
}
async function baixa(fin: string, inst: string, valor: number, pay: string) {
  const r = await rpc(master, "fin_settlement_create_ajustes", { _payload: {
    direction: "receivable", financial_account_id: fin, data: DIA, valor_cents: valor, tarifa_cents: 0, juros_cents: 0,
    referencia: `Asaas ${pay}`, observacao: "ISO", idempotency_key: `iso:${marca()}`,
    alocacoes: [{ installment_id: inst, valor_cents: valor }] } });
  if (!r.ok) throw new Error(r.erro!);
}

beforeAll(async () => {
  master = await criarConta({ nome: `fin-conf-master-${marca()}`, papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: `fin-conf-cons-${marca()}`, papeis: ["consultora"], comParty: true });
  plano = (await um<{ id: string }>(`insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,'receita') returning id`, [`ISO-R-${marca()}`])).id;
  emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp ${marca()}`])).id;
});

describe("1. conferência do saldo da conta Asaas", () => {
  test("mostra saldo real × Lardan e explica a diferença item por item", async () => {
    const c = await contaAsaas();
    const p = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO P ${marca()}`]);
    const [semLanc, ok, dup, dinheiro] = [`pay_s${marca()}`, `pay_o${marca()}`, `pay_d${marca()}`, `pay_c${marca()}`];
    // extrato do Asaas: 100 sem lançamento, 50 lançado certo, 30 lançado duas vezes
    await c.extrato(DIA, 10000, "entrada", 10000, semLanc);
    await c.extrato(DIA, 5000, "entrada", 15000, ok);
    await c.extrato(DIA, 3000, "entrada", 18000, dup);
    await baixa(c.fin, await titulo(p.id, 5000), 5000, ok);
    await baixa(c.fin, await titulo(p.id, 3000), 3000, dup);
    await baixa(c.fin, await titulo(p.id, 3000), 3000, dup);
    // cobrança que o Asaas marca como "recebida em dinheiro" e foi baixada na conta Asaas
    await oficial(`insert into public.asaas_charges (account_id, external_id, value_cents, due_date, billing_type, external_status, party_id)
                   values ($1,$2,2000,$3,'UNDEFINED','RECEIVED_IN_CASH',$4) returning id`, [c.acc, dinheiro, DIA, p.id]);
    await baixa(c.fin, await titulo(p.id, 2000), 2000, dinheiro);

    const r = await rpc<Record<string, unknown> & { sem_lancamento: { pay: string }[]; em_dinheiro: { pay: string }[]; duplicados: { pay: string }[] }>(
      master, "fin_asaas_conferencia", { _conta: c.fin });
    expect(r.erro).toBeNull();
    const d = r.dados;
    expect(d["saldo_asaas_cents"]).toBe(18000);
    expect(d["saldo_lardan_cents"]).toBe(5000 + 3000 + 3000 + 2000);
    expect(d["diferenca_cents"]).toBe(18000 - 13000);
    // a diferença de R$ 50 se explica: +100 sem lançamento, −30 duplicado, −20 em dinheiro
    expect(d.sem_lancamento.map((x) => x.pay)).toEqual([semLanc]);
    expect(d["sem_lancamento_cents"]).toBe(10000);
    expect(d.duplicados.map((x) => x.pay)).toEqual([dup]);
    expect(d.em_dinheiro.map((x) => x.pay)).toEqual([dinheiro]);
    expect(d["em_dinheiro_cents"]).toBe(2000);
    expect((await rpc(consultora, "fin_asaas_conferencia", { _conta: c.fin })).ok).toBe(false);
  });
});

describe("2 e 3. telas batendo entre si", () => {
  test("fluxo de caixa soma a cobrança do Asaas sem título no previsto", async () => {
    const hoje = (await um<{ d: string }>(`select ((now() at time zone 'America/Sao_Paulo')::date + 3)::text d`)).d;
    const antes = await rpc<{ totais: Record<string, number> }>(master, "fin_cashflow", { _filtros: { de: hoje, ate: hoje } });
    const c = await contaAsaas("producao");
    await oficial(`insert into public.asaas_charges (account_id, external_id, value_cents, due_date, billing_type, external_status)
                   values ($1,$2,12345,$3,'BOLETO','PENDING') returning id`, [c.acc, `pay_f${marca()}`, hoje]);
    const depois = await rpc<{ totais: Record<string, number> }>(master, "fin_cashflow", { _filtros: { de: hoje, ate: hoje } });
    expect(depois.erro).toBeNull();
    expect(depois.dados.totais["entradas_previstas_cents"]! - antes.dados.totais["entradas_previstas_cents"]!).toBe(12345);
    expect(depois.dados.totais["entradas_previstas_asaas_cents"]).toBeGreaterThanOrEqual(12345);
    // com filtro de centro de custo a cobrança (que não tem centro) não entra
    const cc = await rpc<{ totais: Record<string, number> }>(master, "fin_cashflow",
      { _filtros: { de: hoje, ate: hoje, centro_custo_id: "00000000-0000-0000-0000-000000000000" } });
    expect(cc.dados.totais["entradas_previstas_asaas_cents"]).toBe(0);
  });

  test("visão geral conta o saldo de conta inativa, como o fluxo de caixa", async () => {
    const antes = await rpc<{ saldo_contas_cents: number }>(master, "fin_overview", {});
    const conta = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind, saldo_inicial_cents) values ($1,'caixa',0) returning id`, [`ISO inativa ${marca()}`])).id;
    await adm.unsafe(`insert into public.financial_account_movements (financial_account_id, data, valor_cents, kind, descricao)
                      values ($1, (now() at time zone 'America/Sao_Paulo')::date - 1, 50, 'saldo_inicial', 'ISO')`, [conta]);
    await adm.unsafe(`update public.financial_accounts set is_active=false where id=$1`, [conta]);
    const depois = await rpc<{ saldo_contas_cents: number }>(master, "fin_overview", {});
    expect(depois.erro).toBeNull();
    expect(Number(depois.dados.saldo_contas_cents) - Number(antes.dados.saldo_contas_cents)).toBe(50);
  });
});

describe("4. mesa Asaas", () => {
  test("busca por código pay_ é exata e não casa CPF por dígitos do código", async () => {
    const c = await contaAsaas();
    const pessoa = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO Mesa ${marca()}`]);
    const cus = `cus_${marca()}`;
    await adm.unsafe(`insert into public.asaas_customers (account_id, external_id, name, doc, party_id) values ($1,$2,'Fulana ISO','34612345678',$3)`, [c.acc, cus, pessoa.id]);
    const outro = `pay_${marca()}`;
    await oficial(`insert into public.asaas_charges (account_id, external_id, value_cents, due_date, payment_date, billing_type, external_status, customer_external_id, party_id)
                   values ($1,$2,28393,$3,$3,'PIX','RECEIVED',$4,$5) returning id`, [c.acc, outro, DIA, cus, pessoa.id]);
    // código com os dígitos 3,4,6 no meio — antes casava o CPF 346... da Fulana
    const r = await rpc<{ total: number; itens: { external_id: string }[] }>(master, "asaas_mesa_pendentes", { _busca: "pay_zzzz3wlmn4n6wkz", _offset: 0 });
    expect(r.erro).toBeNull();
    expect(r.dados.itens.some((x) => x.external_id === outro)).toBe(false);
    const exato = await rpc<{ itens: { external_id: string }[] }>(master, "asaas_mesa_pendentes", { _busca: outro, _offset: 0 });
    expect(exato.dados.itens.map((x) => x.external_id)).toEqual([outro]);
    const cpf = await rpc<{ itens: { external_id: string }[] }>(master, "asaas_mesa_pendentes", { _busca: "346.123", _offset: 0 });
    expect(cpf.dados.itens.some((x) => x.external_id === outro)).toBe(true);
    // extrato já conciliado por outro caminho: sai da mesa
    await c.extrato(DIA, 28393, "entrada", 28393, outro, "conciliada");
    const depois = await rpc<{ itens: { external_id: string }[] }>(master, "asaas_mesa_pendentes", { _busca: outro, _offset: 0 });
    expect(depois.dados.itens).toEqual([]);
  });
});

describe("5. mesa Asaas — título novo (0244)", () => {
  test("título criado pela mesa (conciliação Asaas) nasce na 3.1.1 Revenda de Mercadorias", async () => {
    const pessoa = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO 311 ${marca()}`]);
    const r = await rpc<string>(master, "fin_title_create", { _payload: {
      direction: "receivable", party_id: pessoa.id, descricao: "Recebimento Asaas ISO", valor_cents: 4774, emissao: DIA, competencia: DIA,
      business_entity_id: emp, status: "ativo", origem: "conciliacao", sistema_origem: "asaas", id_externo: `asaas:pay_r${marca()}`,
      parcelas: [{ vencimento: DIA, valor_cents: 4774 }] } });
    expect(r.erro).toBeNull();
    const t = await um<{ codigo: string }>(`select ca.codigo from public.financial_titles t join public.chart_of_accounts ca on ca.id = t.chart_account_id where t.id = $1`, [r.dados]);
    expect(t.codigo).toBe("3.1.1");
  });
});

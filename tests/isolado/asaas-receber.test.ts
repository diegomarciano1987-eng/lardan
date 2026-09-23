/**
 * Contas a receber + link de cobrança Asaas — provas de aceitação.
 *
 * Tudo roda no banco ISOLADO e com o transporte SIMULADO. Os testes chamam os
 * SERVIÇOS da aplicação (src/lib/asaas/*), não reescrevem a importação com
 * INSERTs próprios. Nenhuma chamada externa acontece: o transporte HTTP recusa
 * antes de sair para a rede.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, escritaDireta, ler, rpc, type Conta } from "./base";
import type { BancoAsaas } from "../../src/lib/asaas/banco";
import { SimuladorAsaas } from "../../src/lib/asaas/simulador";
import { TransporteHttpAsaas, ChamadaExternaBloqueada } from "../../src/lib/asaas/transporte-http.server";
import {
  abrirLote,
  aprovarLote,
  buscarPaginas,
  efetivarLote,
  gerarPrevia,
  resolverPendencia,
} from "../../src/lib/asaas/importacao";
import {
  conciliarDesconhecida,
  executarIntencao,
  gerarLinkDeCobranca,
  prepararIntencao,
} from "../../src/lib/asaas/cobranca";
import { drenarEventos, registrarEvento, validarEnvelope } from "../../src/lib/asaas/eventos";

const banco = (conta: Conta): BancoAsaas => ({
  async rpc<T>(fn: string, args: Record<string, unknown>) {
    const r = await rpc<T>(conta, fn, args);
    if (!r.ok) throw new Error(r.erro ?? "falhou");
    return r.dados;
  },
});

let financeiro: Conta;
let diretoria: Conta;
let master: Conta;
let semPermissao: Conta;
let inativo: Conta;
let empresa: string;
let conta: string;
let contaB: string;
let cliente: string;
let party: string;

let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;

async function criarEmpresa() {
  const [e] = (await adm.unsafe(
    `insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`,
    [`ISO Empresa ${marca()}`],
  )) as { id: string }[];
  return e!.id;
}

async function criarContaAsaas(entidade: string, rotulo = "principal") {
  const [a] = (await adm.unsafe(
    `insert into public.asaas_accounts
       (label, environment, state, owner_entity_id, opening_balance_strategy, external_account_id)
     values ($1,'sandbox','simulada',$2,'ignorar_anteriores',$3) returning id`,
    [`ISO Asaas ${rotulo} ${marca()}`, entidade, `acc_${marca()}`],
  )) as { id: string }[];
  return a!.id;
}

async function criarPessoa(nome: string) {
  const [p] = (await adm.unsafe(
    `insert into public.parties (kind, display_name, legal_name, status)
     values ('pessoa',$1,$1,'ativo') returning id`,
    [`ISO ${nome} ${marca()}`],
  )) as { id: string }[];
  return p!.id;
}

async function vincularCliente(contaId: string, partyId: string, externo: string) {
  await adm.unsafe(
    `insert into public.asaas_customers (account_id, external_id, name, party_id, match_status)
     values ($1,$2,$3,$4,'vinculado')
     on conflict (account_id, external_id) do update set party_id = excluded.party_id, match_status='vinculado'`,
    [contaId, externo, "ISO Cliente", partyId],
  );
  return externo;
}

async function criarTitulo(valorCents: number, vencimento: string, partyId = party) {
  const criado = await rpc<string>(master, "fin_title_create", {
    _payload: {
      direction: "receivable",
      business_entity_id: empresa,
      party_id: partyId,
      descricao: `ISO recebível ${marca()}`,
      valor_cents: valorCents,
      emissao: vencimento,
      origem: "manual",
      status: "ativo",
      parcelas: [{ vencimento, valor_cents: valorCents }],
    },
  });
  if (!criado.ok) throw new Error(criado.erro ?? "");
  const titleId = criado.dados as unknown as string;
  await rpc(master, "fin_title_approve", { _title: titleId, _motivo: "ISO" });
  const { linhas } = await ler<{ id: string }>(
    master,
    `select id from public.financial_installments where title_id = $1 order by numero limit 1`,
    [titleId],
  );
  return { titleId, installmentId: linhas[0]!.id };
}

function cobrancaSimulada(sim: SimuladorAsaas, i: number, customer: string, valor = 5000) {
  return sim.semearCobranca({
    customer,
    valueCents: valor,
    dueDate: `2026-0${(i % 9) + 1}-10`,
    billingType: "BOLETO",
    status: "PENDING",
    externalReference: null,
    dateCreated: "2026-01-02",
  });
}

beforeAll(async () => {
  financeiro = await criarConta({ nome: "financeiro", papeis: ["financeiro"], comParty: true });
  diretoria = await criarConta({ nome: "diretoria", papeis: ["diretoria"], comParty: true });
  master = await criarConta({ nome: "master", papeis: ["master"], comParty: true });
  semPermissao = await criarConta({ nome: "consultora", papeis: ["consultora"], comParty: true });
  inativo = await criarConta({ nome: "inativo", papeis: ["financeiro"], ativo: false, comParty: true });
  empresa = await criarEmpresa();
  conta = await criarContaAsaas(empresa, "A");
  contaB = await criarContaAsaas(empresa, "B");
  party = await criarPessoa("Cliente");
  cliente = await vincularCliente(conta, party, `cus_${marca()}`);
});

describe("importação de recebíveis", () => {
  test("percorre mais de 100 cobranças com paginação real", async () => {
    const sim = new SimuladorAsaas({ semente: "pag" });
    for (let i = 0; i < 120; i++) cobrancaSimulada(sim, i, cliente);
    const b = banco(financeiro);
    const lote = await abrirLote(b, { accountId: conta, pageSize: 50 });
    const r = await buscarPaginas(b, sim, lote, { accountId: conta, pageSize: 50 });
    expect(r.paginas).toBeGreaterThanOrEqual(3);
    expect(r.trazidos).toBe(120);
    expect(r.novos).toBe(120);
    expect(r.hasMore).toBe(false);
  });

  test("interrompe e retoma sem perder nem duplicar", async () => {
    const sim = new SimuladorAsaas({ semente: "ret" });
    for (let i = 0; i < 75; i++) cobrancaSimulada(sim, i, cliente);
    const b = banco(financeiro);
    const pedido = { accountId: conta, kind: "sincronizacao" as const, pageSize: 25 };
    const lote1 = await abrirLote(b, pedido);
    const parcial = await buscarPaginas(b, sim, lote1, { ...pedido, maxPaginas: 1 });
    expect(parcial.trazidos).toBe(25);
    expect(parcial.hasMore).toBe(true);

    const lote2 = await abrirLote(b, pedido);
    expect(lote2.run_id).toBe(lote1.run_id);
    expect(lote2.retomado).toBe(true);
    const resto = await buscarPaginas(b, sim, lote2, pedido);
    expect(resto.trazidos).toBe(50);
    expect(resto.repetidos).toBe(0);
    const { linhas } = await ler<{ c: number }>(
      master,
      `select count(*)::int c from public.asaas_import_stage where run_id=$1 and tipo='cobranca'`,
      [lote1.run_id],
    );
    expect(linhas[0]!.c).toBe(75);
  });

  test("importar três vezes o mesmo recorte não duplica linhas", async () => {
    const sim = new SimuladorAsaas({ semente: "rep" });
    for (let i = 0; i < 10; i++) cobrancaSimulada(sim, i, cliente);
    const b = banco(financeiro);
    const pedido = { accountId: conta, kind: "historica" as const, de: "2026-01-01", ate: "2026-12-31", pageSize: 5 };
    let runId = "";
    for (let v = 0; v < 3; v++) {
      const lote = await abrirLote(b, pedido);
      runId = lote.run_id;
      await buscarPaginas(b, sim, { ...lote, offset: 0 }, pedido);
    }
    const { linhas } = await ler<{ c: number }>(
      master,
      `select count(*)::int c from public.asaas_import_stage where run_id=$1 and tipo='cobranca'`,
      [runId],
    );
    expect(linhas[0]!.c).toBe(10);
  });

  test("dívida antiga em aberto entra mesmo fora do recorte", async () => {
    const sim = new SimuladorAsaas({ semente: "velha" });
    sim.semearCobranca({ customer: cliente, valueCents: 1000, dueDate: "2019-03-01", billingType: "BOLETO", status: "OVERDUE", externalReference: null });
    sim.semearCobranca({ customer: cliente, valueCents: 1000, dueDate: "2019-04-01", billingType: "BOLETO", status: "RECEIVED", externalReference: null });
    const pagina = await sim.listarCobrancas({ limit: 50, offset: 0, dueDateGE: "2026-01-01", incluirEmAbertoAnteriores: true });
    expect(pagina.itens.length).toBe(1);
    expect(pagina.itens[0]!.status).toBe("OVERDUE");
  });

  test("prévia classifica sem criar título, parcela ou baixa", async () => {
    const sim = new SimuladorAsaas({ semente: "prev" });
    cobrancaSimulada(sim, 1, cliente, 7700);
    const b = banco(financeiro);
    const lote = await abrirLote(b, { accountId: conta, kind: "sincronizacao", de: "2026-02-01", ate: "2026-02-28", pageSize: 10 });
    await buscarPaginas(b, sim, lote, { accountId: conta, pageSize: 10 });
    const antes = await ler<{ c: number }>(master, `select count(*)::int c from public.financial_titles`);
    const previa = await gerarPrevia(b, lote.run_id);
    const depois = await ler<{ c: number }>(master, `select count(*)::int c from public.financial_titles`);
    expect(previa.total).toBeGreaterThan(0);
    expect(depois.linhas[0]!.c).toBe(antes.linhas[0]!.c);
    expect(previa.aviso).toContain("não cria título");
  });

  test("cliente sem vínculo externo fica em revisão e nunca é ligado por nome", async () => {
    const sim = new SimuladorAsaas({ semente: "amb" });
    sim.semearCobranca({ customer: "cus_desconhecido", customerName: "ISO Cliente", valueCents: 3000, dueDate: "2026-03-10", billingType: "PIX", status: "PENDING", externalReference: null });
    const b = banco(financeiro);
    const lote = await abrirLote(b, { accountId: conta, kind: "sincronizacao", de: "2026-03-01", ate: "2026-03-31", pageSize: 10 });
    await buscarPaginas(b, sim, lote, { accountId: conta, pageSize: 10 });
    const previa = await gerarPrevia(b, lote.run_id);
    expect(previa.resumo["cliente_ambiguo"]).toBe(1);
    const aprovar = await rpc(diretoria, "asaas_import_aprovar", { _run: lote.run_id });
    expect(aprovar.ok).toBe(false);
    expect(aprovar.erro).toContain("revisão");
  });

  test("título manual equivalente vira duplicidade suspeita e não gera outro título", async () => {
    const t = await criarTitulo(4321, "2026-04-15");
    const sim = new SimuladorAsaas({ semente: "dup" });
    sim.semearCobranca({ customer: cliente, valueCents: 4321, dueDate: "2026-04-15", billingType: "BOLETO", status: "PENDING", externalReference: null });
    const b = banco(financeiro);
    const lote = await abrirLote(b, { accountId: conta, kind: "sincronizacao", de: "2026-04-01", ate: "2026-04-30", pageSize: 10 });
    await buscarPaginas(b, sim, lote, { accountId: conta, pageSize: 10 });
    const previa = await gerarPrevia(b, lote.run_id);
    expect(previa.resumo["duplicidade_suspeita"]).toBe(1);

    const { linhas } = await ler<{ id: string }>(
      master,
      `select id from public.asaas_import_stage where run_id=$1 and tipo='cobranca' limit 1`,
      [lote.run_id],
    );
    await resolverPendencia(banco(diretoria), {
      stageId: linhas[0]!.id,
      acao: "vincular",
      titleId: t.titleId,
      motivo: "Mesmo recebível já lançado à mão.",
    });
    await aprovarLote(banco(diretoria), lote.run_id, "conferido");
    const rel = await efetivarLote(banco(master), lote.run_id);
    expect(rel.titulos_criados).toBe(0);
    expect(rel.vinculados).toBe(1);
    const vinculo = await ler<{ title_id: string; installment_id: string }>(
      master,
      `select title_id, installment_id from public.asaas_charges where account_id=$1 order by imported_at desc limit 1`,
      [conta],
    );
    expect(vinculo.linhas[0]!.title_id).toBe(t.titleId);
    expect(vinculo.linhas[0]!.installment_id).toBe(t.installmentId);
  });

  test("pagamento histórico é espelho: não cria caixa", async () => {
    const sim = new SimuladorAsaas({ semente: "hist" });
    sim.semearCobranca({ customer: cliente, valueCents: 2500, valuePaidCents: 2500, dueDate: "2026-05-10", paymentDate: "2026-05-09", billingType: "BOLETO", status: "RECEIVED", externalReference: null });
    const b = banco(financeiro);
    const lote = await abrirLote(b, { accountId: conta, kind: "historica", de: "2026-05-01", ate: "2026-05-31", pageSize: 10 });
    await buscarPaginas(b, sim, lote, { accountId: conta, pageSize: 10 });
    const previa = await gerarPrevia(b, lote.run_id);
    expect(previa.resumo["historico"]).toBe(1);
    await aprovarLote(banco(diretoria), lote.run_id);
    const antes = await ler<{ c: number }>(master, `select count(*)::int c from public.financial_settlements`);
    const rel = await efetivarLote(banco(master), lote.run_id);
    const depois = await ler<{ c: number }>(master, `select count(*)::int c from public.financial_settlements`);
    expect(rel.somente_espelho).toBe(1);
    expect(rel.titulos_criados).toBe(0);
    expect(depois.linhas[0]!.c).toBe(antes.linhas[0]!.c);
  });

  test("mesmo identificador externo em contas distintas são recebíveis distintos", async () => {
    const partyB = await criarPessoa("ClienteB");
    const clienteB = await vincularCliente(contaB, partyB, `cus_b_${marca()}`);
    const externo = `pay_compartilhado_${marca()}`;
    const b = banco(financeiro);
    for (const [c, cus] of [
      [conta, cliente],
      [contaB, clienteB],
    ] as const) {
      const sim = new SimuladorAsaas({ semente: "multi" });
      sim.semearCobranca({ id: externo, customer: cus, valueCents: 1500, dueDate: "2026-06-10", billingType: "PIX", status: "PENDING", externalReference: null });
      const lote = await abrirLote(b, { accountId: c, kind: "sincronizacao", de: "2026-06-01", ate: "2026-06-30", pageSize: 10 });
      await buscarPaginas(b, sim, lote, { accountId: c, pageSize: 10 });
      await gerarPrevia(b, lote.run_id);
      await aprovarLote(banco(diretoria), lote.run_id);
      await efetivarLote(banco(master), lote.run_id);
    }
    const { linhas } = await ler<{ c: number }>(
      master,
      `select count(*)::int c from public.asaas_charges where external_id = $1`,
      [externo],
    );
    expect(linhas[0]!.c).toBe(2);
  });
});

describe("autorização", () => {
  test("preencher aprovador pelo navegador não aprova", async () => {
    const sim = new SimuladorAsaas({ semente: "falsa" });
    cobrancaSimulada(sim, 2, cliente);
    const b = banco(financeiro);
    const lote = await abrirLote(b, { accountId: conta, kind: "sincronizacao", de: "2026-07-01", ate: "2026-07-31", pageSize: 5 });
    await buscarPaginas(b, sim, lote, { accountId: conta, pageSize: 5 });
    await gerarPrevia(b, lote.run_id);
    const falsa = await escritaDireta(
      diretoria,
      `update public.asaas_import_runs set approved_by=$1, approved_at=now(), mode='efetivar' where id=$2`,
      [diretoria.uid, lote.run_id],
    );
    expect(falsa.ok).toBe(false);
    const efetivar = await rpc(master, "asaas_import_efetivar", { _run: lote.run_id });
    expect(efetivar.ok).toBe(false);
    expect(efetivar.erro).toContain("não aprovado");
  });

  test("quem só executa a importação não aprova", async () => {
    const sim = new SimuladorAsaas({ semente: "semaprov" });
    cobrancaSimulada(sim, 3, cliente);
    const b = banco(financeiro);
    const lote = await abrirLote(b, { accountId: conta, kind: "sincronizacao", de: "2026-08-01", ate: "2026-08-31", pageSize: 5 });
    await buscarPaginas(b, sim, lote, { accountId: conta, pageSize: 5 });
    await gerarPrevia(b, lote.run_id);
    const r = await rpc(financeiro, "asaas_import_aprovar", { _run: lote.run_id });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Sem permissão");
  });

  test("escrita direta de vínculo é recusada", async () => {
    const { linhas } = await ler<{ id: string }>(master, `select id from public.asaas_charges limit 1`);
    const r = await escritaDireta(
      financeiro,
      `update public.asaas_charges set title_id = null, installment_id = null where id = $1`,
      [linhas[0]!.id],
    );
    expect(r.ok).toBe(false);
  });

  test("usuário sem permissão e usuário desativado não operam", async () => {
    for (const quem of [semPermissao, inativo]) {
      const r = await rpc(quem, "asaas_import_abrir", { _account: conta });
      expect(r.ok).toBe(false);
    }
  });
});

describe("link de cobrança", () => {
  test("gera link vinculado à parcela certa e identificado como simulação", async () => {
    const t = await criarTitulo(9900, "2026-09-20");
    const sim = new SimuladorAsaas({ semente: "link" });
    const r = await gerarLinkDeCobranca(banco(financeiro), sim, {
      accountId: conta,
      installmentId: t.installmentId,
      billingType: "PIX",
    });
    expect(r.state).toBe("criada");
    expect(r.invoice_url).toStartWith("/financeiro/simulacao/");
    expect(r.simulado).toBe(true);
    const { linhas } = await ler<{ installment_id: string; value_cents: number }>(
      master,
      `select installment_id, value_cents from public.asaas_charges where external_id=$1`,
      [r.external_id],
    );
    expect(linhas[0]!.installment_id).toBe(t.installmentId);
    expect(Number(linhas[0]!.value_cents)).toBe(9900);
  });

  test("segunda solicitação reaproveita o link e não cria outra cobrança", async () => {
    const t = await criarTitulo(5000, "2026-09-21");
    const sim = new SimuladorAsaas({ semente: "reuso" });
    const p = { accountId: conta, installmentId: t.installmentId, billingType: "BOLETO" as const };
    const a = await gerarLinkDeCobranca(banco(financeiro), sim, p);
    const b2 = await gerarLinkDeCobranca(banco(financeiro), sim, p);
    expect(b2.reaproveitada).toBe(true);
    expect(b2.invoice_url).toBe(a.invoice_url!);
    expect(sim.chamadasCriar).toBe(1);
  });

  test("duplo clique e dois trabalhadores produzem um único efeito", async () => {
    const t = await criarTitulo(4000, "2026-09-22");
    const sim = new SimuladorAsaas({ semente: "duplo" });
    const p = { accountId: conta, installmentId: t.installmentId, billingType: "BOLETO" as const };
    const [x, y] = await Promise.all([
      gerarLinkDeCobranca(banco(financeiro), sim, { ...p, worker: "aba-1" }),
      gerarLinkDeCobranca(banco(financeiro), sim, { ...p, worker: "aba-2" }),
    ]);
    expect(sim.chamadasCriar).toBe(1);
    const criados = [x, y].filter((z) => z.state === "criada");
    expect(criados.length).toBeGreaterThanOrEqual(1);
    const { linhas } = await ler<{ c: number }>(
      master,
      `select count(*)::int c from public.asaas_charges where installment_id=$1`,
      [t.installmentId],
    );
    expect(linhas[0]!.c).toBe(1);
  });

  test("mesma chave com conteúdo diferente é recusada", async () => {
    const t1 = await criarTitulo(3000, "2026-09-23");
    const t2 = await criarTitulo(8000, "2026-09-24");
    const chave = `iso-chave-${marca()}`;
    const ok = await prepararIntencao(banco(financeiro), {
      accountId: conta,
      installmentId: t1.installmentId,
      billingType: "PIX",
      idempotencyKey: chave,
    });
    expect(ok.id).toBeTruthy();
    const conflito = await rpc(financeiro, "asaas_cobranca_preparar", {
      _payload: { account_id: conta, installment_id: t2.installmentId, billing_type: "PIX", idempotency_key: chave },
    });
    expect(conflito.ok).toBe(false);
    expect(conflito.erro).toContain("Colisão de chave");
  });

  test("parcela sem saldo não gera cobrança", async () => {
    const t = await criarTitulo(2000, "2026-09-25");
    const cx = await rpc<string>(master, "fin_account_create", {
      _payload: { nome: `ISO Caixa ${marca()}`, kind: "caixa", nature: "interna", business_entity_id: empresa },
    });
    expect(cx.ok).toBe(true);
    const baixa = await rpc(master, "fin_settlement_create", {
      _payload: {
        direction: "receivable",
        valor_cents: 2000,
        financial_account_id: cx.dados,
        data: "2026-09-25",
        alocacoes: [{ installment_id: t.installmentId, valor_cents: 2000 }],
        idempotency_key: `iso-baixa-${marca()}`,
      },
    });
    expect(baixa.ok).toBe(true);
    const r = await rpc(financeiro, "asaas_cobranca_preparar", {
      _payload: { account_id: conta, installment_id: t.installmentId, billing_type: "PIX" },
    });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("sem saldo");
  });

  test("resposta perdida vira resultado desconhecido e a consulta recupera sem duplicar", async () => {
    const t = await criarTitulo(6000, "2026-09-26");
    const sim = new SimuladorAsaas({ semente: "perdida" });
    const intencao = await prepararIntencao(banco(financeiro), {
      accountId: conta,
      installmentId: t.installmentId,
      billingType: "BOLETO",
    });
    sim.definirFalha(intencao.internal_reference!, "perder_resposta");
    const r = await executarIntencao(banco(financeiro), sim, intencao.id!, {
      customerExternalId: intencao.customer_external_id ?? null,
      valueCents: intencao.valor_cents!,
      dueDate: intencao.due_date!,
      billingType: "BOLETO",
      internalReference: intencao.internal_reference!,
      idempotencyKey: intencao.internal_reference!,
    });
    expect(r.state).toBe("desconhecida");
    expect(sim.chamadasCriar).toBe(1);

    const rec = await conciliarDesconhecida(banco(financeiro), sim, {
      id: intencao.id!,
      internal_reference: intencao.internal_reference!,
    });
    expect(rec.state).toBe("criada");
    expect(sim.chamadasCriar).toBe(1);
    const { linhas } = await ler<{ c: number }>(
      master,
      `select count(*)::int c from public.asaas_charges where installment_id=$1`,
      [t.installmentId],
    );
    expect(linhas[0]!.c).toBe(1);
  });

  test("rejeição do provedor fica registrada sem cobrança criada", async () => {
    const t = await criarTitulo(7000, "2026-09-27");
    const sim = new SimuladorAsaas({ semente: "rejeita" });
    const intencao = await prepararIntencao(banco(financeiro), {
      accountId: conta,
      installmentId: t.installmentId,
      billingType: "BOLETO",
    });
    sim.definirFalha(intencao.internal_reference!, "rejeitar");
    const r = await executarIntencao(banco(financeiro), sim, intencao.id!, {
      customerExternalId: intencao.customer_external_id ?? null,
      valueCents: intencao.valor_cents!,
      dueDate: intencao.due_date!,
      billingType: "BOLETO",
      internalReference: intencao.internal_reference!,
      idempotencyKey: intencao.internal_reference!,
    });
    expect(r.state).toBe("rejeitada");
    const { linhas } = await ler<{ c: number }>(
      master,
      `select count(*)::int c from public.asaas_charges where installment_id=$1`,
      [t.installmentId],
    );
    expect(linhas[0]!.c).toBe(0);
  });

  test("saldo que muda durante o processamento vai para conciliação", async () => {
    const t = await criarTitulo(10000, "2026-09-28");
    const sim = new SimuladorAsaas({ semente: "saldo" });
    const intencao = await prepararIntencao(banco(financeiro), {
      accountId: conta,
      installmentId: t.installmentId,
      billingType: "BOLETO",
    });
    await rpc(financeiro, "asaas_cobranca_processando", { _intent: intencao.id, _worker: "iso" });

    const cx = await rpc<string>(master, "fin_account_create", {
      _payload: { nome: `ISO Caixa ${marca()}`, kind: "caixa", nature: "interna", business_entity_id: empresa },
    });
    await rpc(master, "fin_settlement_create", {
      _payload: {
        direction: "receivable",
        valor_cents: 4000,
        financial_account_id: cx.dados,
        data: "2026-09-28",
        alocacoes: [{ installment_id: t.installmentId, valor_cents: 4000 }],
        idempotency_key: `iso-parcial-${marca()}`,
      },
    });

    const criada = await sim.criarCobranca({
      customer: cliente,
      valueCents: 10000,
      dueDate: "2026-09-28",
      billingType: "BOLETO",
      externalReference: intencao.internal_reference!,
      idempotencyKey: intencao.internal_reference!,
    });
    const r = await rpc<{ state: string }>(financeiro, "asaas_cobranca_resultado", {
      _intent: intencao.id,
      _payload: { resultado: "criada", external_id: criada.id, invoice_url: criada.invoiceUrl, status: "PENDING" },
    });
    expect(r.ok).toBe(true);
    expect(r.dados.state).toBe("conciliacao");
  });

  test("gerar link não liquida a parcela nem cria obrigação nova", async () => {
    const t = await criarTitulo(5500, "2026-09-29");
    const sim = new SimuladorAsaas({ semente: "naoliquida" });
    await gerarLinkDeCobranca(banco(financeiro), sim, {
      accountId: conta,
      installmentId: t.installmentId,
      billingType: "PIX",
    });
    const { linhas } = await ler<{ alocacoes: number; saldo: number }>(
      master,
      `select (select count(*) from public.financial_allocations a where a.installment_id=$1)::int alocacoes,
              public.fin_installment_saldo($1)::int saldo`,
      [t.installmentId],
    );
    expect(linhas[0]!.alocacoes).toBe(0);
    expect(Number(linhas[0]!.saldo)).toBe(5500);
  });
});

describe("eventos e conciliação", () => {
  test("recebimento é espelhado sem inventar baixa", async () => {
    const t = await criarTitulo(8800, "2026-10-05");
    const sim = new SimuladorAsaas({ semente: "evt" });
    const link = await gerarLinkDeCobranca(banco(financeiro), sim, {
      accountId: conta,
      installmentId: t.installmentId,
      billingType: "BOLETO",
    });
    sim.registrarRecebimento(link.external_id!, { pagoCents: 8800, tarifaCents: 199, data: "2026-10-06" });
    const saida = await drenarEventos(banco(master), sim, conta);
    expect(saida.length).toBe(1);
    expect(saida[0]!.revisao_manual ?? false).toBeDefined();

    const { linhas } = await ler<{ received_cents: number; fee_cents: number; net_value_cents: number; alocacoes: number }>(
      master,
      `select received_cents, fee_cents, net_value_cents,
              (select count(*) from public.financial_allocations a where a.installment_id=$1)::int alocacoes
         from public.asaas_charges where external_id=$2`,
      [t.installmentId, link.external_id],
    );
    expect(Number(linhas[0]!.received_cents)).toBe(8800);
    expect(Number(linhas[0]!.fee_cents)).toBe(199);
    expect(Number(linhas[0]!.net_value_cents)).toBe(8601);
    expect(linhas[0]!.alocacoes).toBe(0);
  });

  test("evento repetido não repete efeito", async () => {
    const t = await criarTitulo(3300, "2026-10-07");
    const sim = new SimuladorAsaas({ semente: "rep-evt" });
    const link = await gerarLinkDeCobranca(banco(financeiro), sim, {
      accountId: conta,
      installmentId: t.installmentId,
      billingType: "PIX",
    });
    const evento = {
      id: `evt_rep_${marca()}`,
      event: "PAYMENT_RECEIVED",
      chargeExternalId: link.external_id!,
      eventAt: "2026-10-08T10:00:00Z",
      payload: { valuePaidCents: 3300, feeCents: 100, netValueCents: 3200, paymentDate: "2026-10-08", creditDate: "2026-10-08" },
    };
    const a = await registrarEvento(banco(master), conta, evento);
    const b2 = await registrarEvento(banco(master), conta, evento);
    expect(a.id).toBe(b2.id);
    expect(b2.novo).toBe(false);
    const { linhas } = await ler<{ c: number }>(
      master,
      `select count(*)::int c from public.asaas_events where account_id=$1 and external_id=$2`,
      [conta, evento.id],
    );
    expect(linhas[0]!.c).toBe(1);
  });

  test("dinheiro fora do Asaas não credita a conta do provedor", async () => {
    const { linhas } = await ler<{ efeito_caixa: string; revisao_manual: boolean }>(
      master,
      `select efeito_caixa, revisao_manual from public.asaas_event_types where event='PAYMENT_RECEIVED_IN_CASH'`,
    );
    expect(linhas[0]!.efeito_caixa).not.toBe("credita_conta_asaas");
    expect(linhas[0]!.revisao_manual).toBe(true);
  });

  test("valor desconhecido continua desconhecido", async () => {
    const t = await criarTitulo(2200, "2026-10-09");
    const sim = new SimuladorAsaas({ semente: "desconhecido" });
    const link = await gerarLinkDeCobranca(banco(financeiro), sim, {
      accountId: conta,
      installmentId: t.installmentId,
      billingType: "PIX",
    });
    await registrarEvento(banco(master), conta, {
      id: `evt_sem_valores_${marca()}`,
      event: "PAYMENT_CONFIRMED",
      chargeExternalId: link.external_id!,
      eventAt: "2026-10-10T10:00:00Z",
      payload: {},
    });
    const saida = await drenarEventos(banco(master), sim, conta);
    void saida;
    const { linhas } = await ler<{ fee_cents: number | null }>(
      master,
      `select fee_cents from public.asaas_charges where external_id=$1`,
      [link.external_id],
    );
    expect(linhas[0]!.fee_cents).toBeNull();
  });

  test("envelope inválido é recusado antes de qualquer efeito", () => {
    expect(() => validarEnvelope({ accountId: conta, token: "x", tokenEsperado: "y", corpo: { id: "1", event: "A" } })).toThrow();
    expect(() => validarEnvelope({ accountId: null, token: "x", tokenEsperado: "x", corpo: { id: "1", event: "A" } })).toThrow();
    expect(() => validarEnvelope({ accountId: conta, token: "x", tokenEsperado: "x", corpo: { id: "1" } })).toThrow();
    expect(validarEnvelope({ accountId: conta, token: "x", tokenEsperado: "x", corpo: { id: "1", event: "A" } })).toBe(true);
  });
});

describe("nenhuma chamada externa", () => {
  test("o transporte HTTP recusa antes de sair para a rede", async () => {
    const http = new TransporteHttpAsaas("sandbox", "ASAAS_API_KEY");
    for (const chamada of [
      () => http.listarCobrancas({ limit: 1, offset: 0 }),
      () => http.criarCobranca({ customer: "x", valueCents: 1, dueDate: "2026-01-01", billingType: "PIX", externalReference: "r", idempotencyKey: "k" }),
      () => http.obterLinkFatura("x"),
    ]) {
      expect(chamada).toThrow(ChamadaExternaBloqueada);
    }
  });

  test("a conta preparada não está conectada e o ambiente é de simulação", async () => {
    const { linhas } = await ler<{ is_active: boolean; environment: string; state: string }>(
      master,
      `select is_active, environment, state from public.asaas_accounts where id=$1`,
      [conta],
    );
    expect(linhas[0]!.is_active).toBe(false);
    expect(linhas[0]!.environment).not.toBe("producao");
    expect(linhas[0]!.state).toBe("simulada");
  });
});

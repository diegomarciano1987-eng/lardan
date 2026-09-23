/**
 * Contas a receber + link de cobrança Asaas — provas de aceitação.
 *
 * Tudo roda no banco ISOLADO e com o transporte SIMULADO. Os testes chamam os
 * SERVIÇOS da aplicação (src/lib/asaas/*), não reescrevem a importação com
 * INSERTs próprios. Nenhuma chamada externa acontece: o transporte HTTP recusa
 * antes de sair para a rede.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, escritaDireta, ler, rpc, rpcServico, type Conta } from "./base";
import type { BancoAsaas } from "../../src/lib/asaas/banco";
import { SimuladorAsaas, type EstadoSimulador } from "../../src/lib/asaas/simulador";
import { TransporteHttpAsaas, ChamadaExternaBloqueada } from "../../src/lib/asaas/transporte-http.server";
import { lerConfiguracao, criarTransporte, IntegracaoIndisponivel } from "../../src/lib/asaas/index";
import {
  abrirLote,
  aprovarLote,
  buscarPaginas,
  efetivarLote,
  gerarPrevia,
  resolverPendencia,
} from "../../src/lib/asaas/importacao";
import {
  executarIntencao,
  gerarLinkDeCobranca as gerarLinkServico,
  obterLinkCobranca,
  prepararIntencao,
  retomarPendentes,
  type PedidoCobranca,
} from "../../src/lib/asaas/cobranca";
import { drenarEventos, registrarEvento, validarEnvelope } from "../../src/lib/asaas/eventos";

const banco = (conta: Conta): BancoAsaas => ({
  async rpc<T>(fn: string, args: Record<string, unknown>) {
    const r = await rpc<T>(conta, fn, args);
    if (!r.ok) throw new Error(r.erro ?? "falhou");
    return r.dados;
  },
});

/** Executor interno: papel de serviço, sem sessão. */
const servico: BancoAsaas = {
  async rpc<T>(fn: string, args: Record<string, unknown>) {
    const r = await rpcServico<T>(fn, args);
    if (!r.ok) throw new Error(r.erro ?? "falhou");
    return r.dados;
  },
};

/** Percurso do botão: usuário solicita, executor grava. */
const gerarLinkDeCobranca = (usuario: BancoAsaas, sim: SimuladorAsaas, p: PedidoCobranca & { worker?: string }, ator?: string) =>
  gerarLinkServico(usuario, servico, sim, p, { actor: ator ?? financeiro.uid, ...(p.worker ? { worker: p.worker } : {}) });

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
    const sim = new SimuladorAsaas({ semente: `pag-${marca()}` });
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
    const sim = new SimuladorAsaas({ semente: `ret-${marca()}` });
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
    const sim = new SimuladorAsaas({ semente: `rep-${marca()}` });
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
    const sim = new SimuladorAsaas({ semente: `velha-${marca()}` });
    sim.semearCobranca({ customer: cliente, valueCents: 1000, dueDate: "2019-03-01", billingType: "BOLETO", status: "OVERDUE", externalReference: null });
    sim.semearCobranca({ customer: cliente, valueCents: 1000, dueDate: "2019-04-01", billingType: "BOLETO", status: "RECEIVED", externalReference: null });
    const pagina = await sim.listarCobrancas({ limit: 50, offset: 0, dueDateGE: "2026-01-01", incluirEmAbertoAnteriores: true });
    expect(pagina.itens.length).toBe(1);
    expect(pagina.itens[0]!.status).toBe("OVERDUE");
  });

  test("prévia classifica sem criar título, parcela ou baixa", async () => {
    const sim = new SimuladorAsaas({ semente: `prev-${marca()}` });
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
    const sim = new SimuladorAsaas({ semente: `amb-${marca()}` });
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
    const sim = new SimuladorAsaas({ semente: `dup-${marca()}` });
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
    const sim = new SimuladorAsaas({ semente: `hist-${marca()}` });
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
      const sim = new SimuladorAsaas({ semente: `multi-${marca()}` });
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
    const sim = new SimuladorAsaas({ semente: `falsa-${marca()}` });
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
    const sim = new SimuladorAsaas({ semente: `semaprov-${marca()}` });
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

/* ====================================================================== */
/* Rodada de correção da auditoria 15: executor interno, posse, links.     */
/* ====================================================================== */

/** simulador da conta principal, já conhecendo o cliente vinculado */
function simConta(semente: string, o: ConstructorParameters<typeof SimuladorAsaas>[0] = {}) {
  const sim = new SimuladorAsaas({ semente: `${semente}-${marca()}`, conta, ...o });
  sim.semearCliente({ id: cliente, name: "ISO Cliente" });
  return sim;
}

const contar = async (sql: string, p: unknown[]) =>
  Number(((await adm.unsafe(sql, p)) as { c: number }[])[0]!.c);

const intencaoDe = async (installment: string) =>
  ((await adm.unsafe(
    `select id, state, rejeicao_fase, external_id, charge_id, lease_until, attempts
       from public.asaas_charge_intents where installment_id=$1 order by created_at desc limit 1`,
    [installment],
  )) as { id: string; state: string; rejeicao_fase: string | null; external_id: string | null; charge_id: string | null; attempts: number }[])[0]!;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("link de cobrança", () => {
  test("gera link vinculado à parcela, guardado no espelho e identificado como simulação", async () => {
    const t = await criarTitulo(9900, "2026-09-20");
    const sim = simConta("link");
    const r = await gerarLinkDeCobranca(banco(financeiro), sim, { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    expect(r.state).toBe("criada");
    expect(r.invoice_url).toBe(`/financeiro/simulacao/${r.external_id}`);
    expect(r.simulado).toBe(true);
    const [c] = (await adm.unsafe(
      `select installment_id, value_cents, invoice_url from public.asaas_charges where external_id=$1`, [r.external_id],
    )) as { installment_id: string; value_cents: number; invoice_url: string }[];
    expect(c!.installment_id).toBe(t.installmentId);
    expect(Number(c!.value_cents)).toBe(9900);
    expect(c!.invoice_url).toBe(r.invoice_url!);
  });

  test("segunda solicitação reaproveita o link e não cria outra cobrança", async () => {
    const t = await criarTitulo(5000, "2026-09-21");
    const sim = simConta("reuso");
    const p = { accountId: conta, installmentId: t.installmentId, billingType: "BOLETO" as const };
    const a = await gerarLinkDeCobranca(banco(financeiro), sim, p);
    const b2 = await gerarLinkDeCobranca(banco(financeiro), sim, p);
    expect(b2.reaproveitada).toBe(true);
    expect(b2.invoice_url).toBe(a.invoice_url!);
    expect(sim.chamadasCriar).toBe(1);
  });

  test("duplo clique e dois trabalhadores produzem um único efeito", async () => {
    const t = await criarTitulo(4000, "2026-09-22");
    const sim = simConta("duplo");
    const p = { accountId: conta, installmentId: t.installmentId, billingType: "BOLETO" as const };
    await Promise.all([
      gerarLinkDeCobranca(banco(financeiro), sim, { ...p, worker: "aba-1" }),
      gerarLinkDeCobranca(banco(financeiro), sim, { ...p, worker: "aba-2" }),
    ]);
    expect(sim.chamadasCriar).toBe(1);
    expect(await contar(`select count(*)::int c from public.asaas_charges where installment_id=$1`, [t.installmentId])).toBe(1);
  });

  test("mesma chave com conteúdo diferente é recusada", async () => {
    const t1 = await criarTitulo(3000, "2026-09-23");
    const t2 = await criarTitulo(8000, "2026-09-24");
    const chave = `iso-chave-${marca()}`;
    const ok = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t1.installmentId, billingType: "PIX", idempotencyKey: chave });
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
    await rpc(master, "fin_settlement_create", {
      _payload: { direction: "receivable", valor_cents: 2000, financial_account_id: cx.dados, data: "2026-09-25",
        alocacoes: [{ installment_id: t.installmentId, valor_cents: 2000 }], idempotency_key: `iso-baixa-${marca()}` },
    });
    const r = await rpc(financeiro, "asaas_cobranca_preparar", { _payload: { account_id: conta, installment_id: t.installmentId, billing_type: "PIX" } });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("sem saldo");
  });

  test("resposta perdida: desconhecida bloqueia nova cobrança; retomada consulta e recupera sem duplicar", async () => {
    const t = await criarTitulo(6000, "2026-09-26");
    const sim = simConta("perdida");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "BOLETO" });
    sim.definirFalha(it.internal_reference!, "perder_resposta");
    const r = await executarIntencao(servico, sim, it.id!, { actor: financeiro.uid });
    expect(r.state).toBe("desconhecida");
    // nova solicitação não cria outra intenção enquanto o resultado é desconhecido
    const de2 = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "BOLETO" });
    expect(de2.id).toBe(it.id!);
    expect(de2.state).toBe("desconhecida");
    const rec = await executarIntencao(servico, sim, it.id!, { actor: financeiro.uid });
    expect(rec.state).toBe("criada");
    expect(sim.chamadasCriar).toBe(1);
    expect(await contar(`select count(*)::int c from public.asaas_charges where installment_id=$1`, [t.installmentId])).toBe(1);
  });

  test("recusa do provedor é rejeição com fase; nova solicitação é permitida", async () => {
    const t = await criarTitulo(7000, "2026-09-27");
    const sim = simConta("rejeita");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "BOLETO" });
    sim.definirFalha(it.internal_reference!, "rejeitar");
    const r = await executarIntencao(servico, sim, it.id!, { actor: financeiro.uid });
    expect(r.state).toBe("rejeitada");
    expect(r.fase).toBe("provedor_recusou");
    expect(await contar(`select count(*)::int c from public.asaas_charges where installment_id=$1`, [t.installmentId])).toBe(0);
    const nova = await gerarLinkDeCobranca(banco(financeiro), sim, { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    expect(nova.state).toBe("criada");
  });

  test("saldo que muda: conciliação preserva ID e vínculo e bloqueia outra cobrança", async () => {
    const t = await criarTitulo(10000, "2026-09-28");
    const sim = simConta("saldo");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "BOLETO" });
    // o saldo muda enquanto o executor fala com o provedor
    const criarOriginal = sim.criarCobranca.bind(sim);
    sim.criarCobranca = async (n) => {
      const cx = await rpc<string>(master, "fin_account_create", {
        _payload: { nome: `ISO Caixa ${marca()}`, kind: "caixa", nature: "interna", business_entity_id: empresa },
      });
      await rpc(master, "fin_settlement_create", {
        _payload: { direction: "receivable", valor_cents: 4000, financial_account_id: cx.dados, data: "2026-09-28",
          alocacoes: [{ installment_id: t.installmentId, valor_cents: 4000 }], idempotency_key: `iso-parcial-${marca()}` },
      });
      return criarOriginal(n);
    };
    const r = await executarIntencao(servico, sim, it.id!, { actor: financeiro.uid });
    expect(r.state).toBe("conciliacao");
    const i = await intencaoDe(t.installmentId);
    expect(i.external_id).toBeTruthy();
    expect(i.charge_id).toBeTruthy();
    const [c] = (await adm.unsafe(`select installment_id from public.asaas_charges where id=$1`, [i.charge_id])) as { installment_id: string }[];
    expect(c!.installment_id).toBe(t.installmentId);
    const denovo = await gerarLinkDeCobranca(banco(financeiro), sim, { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    expect(sim.chamadasCriar).toBe(1);
    expect(denovo.state === "conciliacao" || denovo.reaproveitada).toBe(true);
    expect(await contar(`select count(*)::int c from public.asaas_charge_intents where installment_id=$1`, [t.installmentId])).toBe(1);
  });

  test("gerar link não liquida a parcela nem cria obrigação nova", async () => {
    const t = await criarTitulo(5500, "2026-09-29");
    await gerarLinkDeCobranca(banco(financeiro), simConta("naoliquida"), { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    const [l] = (await adm.unsafe(
      `select (select count(*) from public.financial_allocations a where a.installment_id=$1)::int alocacoes,
              public.fin_installment_saldo($1)::int saldo`, [t.installmentId],
    )) as { alocacoes: number; saldo: number }[];
    expect(l!.alocacoes).toBe(0);
    expect(Number(l!.saldo)).toBe(5500);
  });
});

describe("segurança do executor", () => {
  test("usuário do navegador não grava resultado, evento, reserva nem link", async () => {
    for (const quem of [financeiro, master]) {
      for (const [fn, args] of [
        ["asaas_exec_resultado", { _intent: crypto.randomUUID(), _worker: "x", _tentativa: 1, _actor: quem.uid, _payload: { resultado: "criada", external_id: "sim_x", invoice_url: "/financeiro/simulacao/sim_x" } }],
        ["asaas_exec_reservar", { _intent: crypto.randomUUID(), _worker: "x", _actor: quem.uid }],
        ["asaas_exec_link", { _charge: crypto.randomUUID(), _actor: quem.uid, _url: "/financeiro/simulacao/sim_x" }],
        ["asaas_evento_registrar", { _payload: { account_id: conta, external_id: "e", event: "PAYMENT_RECEIVED" }, _origem: "simulacao", _actor: quem.uid }],
      ] as const) {
        const r = await rpc(quem, fn, args as Record<string, unknown>);
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/permission denied/i);
      }
    }
    const antigas = await contar(
      `select count(*)::int c from pg_proc where proname in ('asaas_cobranca_resultado','asaas_cobranca_processando')`, []);
    expect(antigas).toBe(0);
  });

  test("resultado exige posse, tentativa e formato; endereço estranho não é guardado", async () => {
    const t = await criarTitulo(4100, "2026-10-01");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    const res = await rpcServico<{ tentativa: number }>("asaas_exec_reservar", { _intent: it.id, _worker: "w1", _actor: financeiro.uid });
    expect(res.ok).toBe(true);
    const tent = res.dados.tentativa;
    const outro = await rpcServico("asaas_exec_resultado", { _intent: it.id, _worker: "intruso", _tentativa: tent, _actor: financeiro.uid, _payload: { resultado: "rejeitada", fase: "provedor_recusou" } });
    expect(outro.erro).toContain("Posse perdida");
    const velha = await rpcServico("asaas_exec_resultado", { _intent: it.id, _worker: "w1", _tentativa: tent - 1, _actor: financeiro.uid, _payload: { resultado: "rejeitada", fase: "provedor_recusou" } });
    expect(velha.erro).toContain("Posse perdida");
    const semFase = await rpcServico("asaas_exec_resultado", { _intent: it.id, _worker: "w1", _tentativa: tent, _actor: financeiro.uid, _payload: { resultado: "rejeitada" } });
    expect(semFase.erro).toContain("fase");
    const idRuim = await rpcServico("asaas_exec_resultado", { _intent: it.id, _worker: "w1", _tentativa: tent, _actor: financeiro.uid, _payload: { resultado: "criada", external_id: "pay_real123" } });
    expect(idRuim.erro).toContain("Identificador externo");
    const ext = `sim_pay_forjado_${marca()}`;
    const ok = await rpcServico<{ state: string; invoice_url: string | null }>("asaas_exec_resultado", {
      _intent: it.id, _worker: "w1", _tentativa: tent, _actor: financeiro.uid,
      _payload: { resultado: "criada", external_id: ext, invoice_url: "https://evil.example/pagar" },
    });
    expect(ok.dados.state).toBe("criada");
    expect(ok.dados.invoice_url).toBeNull();
    const url = ((await adm.unsafe(`select invoice_url from public.asaas_charges where external_id=$1`, [ext])) as { invoice_url: string | null }[])[0]!.invoice_url;
    expect(url).toBeNull();
  });

  test("executor recusa ator sem permissão e ator inativo", async () => {
    const t = await criarTitulo(4200, "2026-10-02");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    for (const q of [semPermissao, inativo]) {
      const r = await rpcServico("asaas_exec_reservar", { _intent: it.id, _worker: "w", _actor: q.uid });
      expect(r.ok).toBe(false);
      expect(r.erro).toContain("Sem permissão");
    }
  });

  test("escrita direta do endereço da fatura é recusada", async () => {
    const r = await escritaDireta(financeiro, `update public.asaas_charges set invoice_url = '/financeiro/simulacao/x'`);
    expect(r.ok).toBe(false);
  });
});

describe("falhas e retomada", () => {
  test("falha ao preparar cliente: rejeição sem cobrança; a próxima localiza o cliente e não duplica", async () => {
    const p2 = await criarPessoa("SemCliente");
    const t = await criarTitulo(3100, "2026-10-03", p2);
    const sim = simConta("cli");
    sim.definirFalhaCliente(`lardan:party:${p2}`, "perder_resposta");
    const a = await gerarLinkDeCobranca(banco(financeiro), sim, { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    expect(a.state).toBe("rejeitada");
    expect(a.fase).toBe("cliente");
    expect(sim.chamadasCriar).toBe(0);
    const b2 = await gerarLinkDeCobranca(banco(financeiro), sim, { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    expect(b2.state).toBe("criada");
    expect(sim.chamadasCriarCliente).toBe(1);
    const clientes = (await adm.unsafe(
      `select external_id, match_status from public.asaas_customers where account_id=$1 and party_id=$2`, [conta, p2],
    )) as { external_id: string; match_status: string }[];
    expect(clientes.length).toBe(1);
    expect(clientes[0]!.match_status).toBe("vinculado");
  });

  test("link que falha: cobrança criada fica sem link e é recuperada pelo ID, sem criar outra", async () => {
    const t = await criarTitulo(3200, "2026-10-04");
    const sim = simConta("semlink");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    sim.definirFalha(it.internal_reference!, "sem_link");
    const r = await executarIntencao(servico, sim, it.id!, { actor: financeiro.uid });
    expect(r.state).toBe("criada");
    expect(r.invoice_url ?? null).toBeNull();
    const link = await obterLinkCobranca(servico, sim, r.charge_id!, financeiro.uid);
    expect(link.consultado).toBe(true);
    expect(link.invoice_url).toBe(`/financeiro/simulacao/${r.external_id}`);
    expect(sim.chamadasCriar).toBe(1);
  });

  test("falha ao gravar o resultado: posse vence, retomada consulta e não reenvia", async () => {
    const t = await criarTitulo(3300, "2026-10-05");
    const sim = simConta("persist");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    let falhar = true;
    const quebrado: BancoAsaas = {
      async rpc<T>(fn: string, args: Record<string, unknown>) {
        if (fn === "asaas_exec_resultado" && falhar) { falhar = false; throw new Error("conexão com o banco caiu"); }
        return servico.rpc<T>(fn, args);
      },
    };
    await expect(executarIntencao(quebrado, sim, it.id!, { actor: financeiro.uid, leaseSegundos: 1 })).rejects.toThrow("caiu");
    expect((await intencaoDe(t.installmentId)).state).toBe("processando");
    // antes de a posse vencer, ninguém retoma
    const cedo = await executarIntencao(servico, sim, it.id!, { actor: financeiro.uid });
    expect(cedo.reaproveitada).toBe(true);
    await esperar(1200);
    const saida = await retomarPendentes(servico, async () => sim, { actor: null, accountId: conta, preparadaSegundos: 3600 });
    expect(saida.find((s) => s.id === it.id)?.state).toBe("criada");
    expect(sim.chamadasCriar).toBe(1);
    const ev = (await adm.unsafe(`select para, detalhe from public.asaas_charge_intent_events where intent_id=$1 order by created_at`, [it.id])) as { para: string; detalhe: { motivo?: string } }[];
    expect(ev.some((e) => e.detalhe.motivo === "posse_expirada")).toBe(true);
  });

  test("erro inesperado depois do envio vira desconhecida, nunca rejeitada", async () => {
    const t = await criarTitulo(3400, "2026-10-06");
    const sim = simConta("inesperado");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    sim.definirFalha(it.internal_reference!, "erro_inesperado");
    const r = await executarIntencao(servico, sim, it.id!, { actor: financeiro.uid });
    expect(r.state).toBe("desconhecida");
  });

  test("desconhecida sem registro no provedor: só encerra depois da consulta", async () => {
    const t = await criarTitulo(3450, "2026-10-06");
    const sim = simConta("semregistro");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    const res = await rpcServico<{ tentativa: number }>("asaas_exec_reservar", { _intent: it.id, _worker: "w", _actor: financeiro.uid });
    await rpcServico("asaas_exec_resultado", { _intent: it.id, _worker: "w", _tentativa: res.dados.tentativa, _actor: financeiro.uid, _payload: { resultado: "desconhecida", erro: "timeout" } });
    const r = await executarIntencao(servico, sim, it.id!, { actor: financeiro.uid });
    expect(r.state).toBe("rejeitada");
    expect(r.fase).toBe("sem_registro_apos_consulta");
    expect(sim.chamadasCriar).toBe(0);
  });

  test("intenção preparada que nunca começou é retomada", async () => {
    const t = await criarTitulo(3500, "2026-10-07");
    const sim = simConta("preparada");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    const saida = await retomarPendentes(servico, async () => sim, { actor: null, accountId: conta, preparadaSegundos: 0 });
    expect(saida.find((s) => s.id === it.id)?.state).toBe("criada");
  });

  test("sobrevive a reinício: estado do simulador e da intenção persistem", async () => {
    const t = await criarTitulo(3600, "2026-10-08");
    let guardado: EstadoSimulador | null = null;
    const armazenamento = { carregar: () => guardado, salvar: (e: EstadoSimulador) => { guardado = JSON.parse(JSON.stringify(e)); } };
    const antes = simConta("reinicio", { armazenamento });
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    antes.definirFalha(it.internal_reference!, "perder_resposta");
    expect((await executarIntencao(servico, antes, it.id!, { actor: financeiro.uid })).state).toBe("desconhecida");
    // "reinício": nova instância, mesmo armazenamento
    const depois = new SimuladorAsaas({ conta, semente: "outra", armazenamento });
    const r = await executarIntencao(servico, depois, it.id!, { actor: financeiro.uid });
    expect(r.state).toBe("criada");
    expect(depois.chamadasCriar).toBe(1);
  });

  test("modo do servidor diferente do da conta: rejeição antes do provedor", async () => {
    const t = await criarTitulo(3700, "2026-10-09");
    const it = await prepararIntencao(banco(financeiro), { accountId: conta, installmentId: t.installmentId, billingType: "PIX" });
    const http = new TransporteHttpAsaas({ ambiente: "sandbox", chave: "$aact_hmlg_teste" });
    const r = await executarIntencao(servico, http, it.id!, { actor: financeiro.uid });
    expect(r.state).toBe("rejeitada");
    expect(r.fase).toBe("antes_do_provedor");
  });
});

describe("links de cobranças importadas", () => {
  test("link válido do payload é guardado; inválido é descartado; ausente é consultado pelo ID", async () => {
    const sim = simConta("imp");
    const comLink = sim.semearCobranca({ customer: cliente, valueCents: 100, dueDate: "2026-10-10", billingType: "PIX", status: "PENDING" });
    const semLink = sim.semearCobranca({ customer: cliente, valueCents: 200, dueDate: "2026-10-10", billingType: "PIX", status: "PENDING" }, { semLinkNaListagem: true });
    const ins = async (ext: string, raw: Record<string, unknown>) =>
      ((await adm.unsafe(
        `insert into public.asaas_charges (account_id, external_id, value_cents, reconcile_status, raw)
         values ($1,$2,100,'pendente',$3::text::jsonb) returning id, invoice_url`, [conta, ext, JSON.stringify(raw)],
      )) as { id: string; invoice_url: string | null }[])[0]!;
    const a = await ins(comLink.id, { invoiceUrl: comLink.invoiceUrl });
    expect(a.invoice_url).toBe(comLink.invoiceUrl!);
    const ruim = await ins(`sim_pay_ruim_${marca()}`, { invoiceUrl: "https://outro.site/i/abc123" });
    expect(ruim.invoice_url).toBeNull();
    const b2 = await ins(semLink.id, {});
    expect(b2.invoice_url).toBeNull();
    const antes = sim.chamadasCriar;
    const l = await obterLinkCobranca(servico, sim, b2.id, financeiro.uid);
    expect(l.invoice_url).toBe(`/financeiro/simulacao/${semLink.id}`);
    expect(sim.chamadasCriar).toBe(antes);
    const invalido = await rpcServico("asaas_exec_link", { _charge: ruim.id, _actor: financeiro.uid, _url: "https://www.asaas.com/i/abc123" });
    expect(invalido.ok).toBe(false);
  });

  test("validação de endereço por modo e ambiente", async () => {
    const [cx] = (await adm.unsafe(
      `insert into public.asaas_accounts (label, environment, state, owner_entity_id, modo_execucao, ambiente_provedor)
       values ($1,'sandbox','sandbox_conectada',$2,'conectado','sandbox') returning id`, [`ISO conectada ${marca()}`, empresa],
    )) as { id: string }[];
    const v = async (acc: string, ext: string, url: string) =>
      ((await adm.unsafe(`select public.asaas_fatura_url_valida($1,$2,$3) v`, [acc, ext, url])) as { v: boolean }[])[0]!.v;
    expect(await v(cx!.id, "pay_abc123", "https://sandbox.asaas.com/i/abc123def")).toBe(true);
    expect(await v(cx!.id, "pay_abc123", "https://www.asaas.com/i/abc123def")).toBe(false);
    expect(await v(cx!.id, "pay_abc123", "/financeiro/simulacao/pay_abc123")).toBe(false);
    expect(await v(conta, "sim_pay_x", "https://sandbox.asaas.com/i/abc123def")).toBe(false);
    expect(await v(conta, "sim_pay_x", "/financeiro/simulacao/sim_pay_y")).toBe(false);
    const inval = await adm.unsafe(
      `update public.asaas_accounts set ambiente_provedor = null where id=$1`, [cx!.id],
    ).then(() => true, () => false);
    expect(inval).toBe(false);
  });
});

describe("paginação do painel", () => {
  test("mais de 200 parcelas: cursor estável sem repetir nem pular; busca e situação no servidor", async () => {
    const p3 = await criarPessoa("PaginaGrande");
    const [pn] = (await adm.unsafe(`select display_name from public.parties where id=$1`, [p3])) as { display_name: string }[];
    for (let i = 0; i < 205; i++) {
      await criarTitulo(1000 + i, `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, p3);
    }
    const vistos = new Set<string>();
    let cursor: unknown = null;
    let paginas = 0;
    let total = 0;
    do {
      const r = await rpc<{ itens: { installment_id: string }[]; proximo: unknown; total: number }>(financeiro, "asaas_receber_parcelas", {
        _filtros: { busca: pn!.display_name, limite: 60, cursor },
      });
      expect(r.ok).toBe(true);
      total = Number(r.dados.total);
      for (const i of r.dados.itens) {
        expect(vistos.has(i.installment_id)).toBe(false);
        vistos.add(i.installment_id);
      }
      cursor = r.dados.proximo;
      paginas++;
    } while (cursor && paginas < 20);
    expect(total).toBe(205);
    expect(vistos.size).toBe(205);
    expect(paginas).toBe(4);
    const sem = await rpc<{ total: number }>(financeiro, "asaas_receber_parcelas", { _filtros: { busca: pn!.display_name, situacao: "com_link", limite: 5 } });
    expect(Number(sem.dados.total)).toBe(0);
    const ruim = await rpc(financeiro, "asaas_receber_parcelas", { _filtros: { situacao: "inventada" } });
    expect(ruim.ok).toBe(false);
    const semCap = await rpc(semPermissao, "asaas_receber_parcelas", { _filtros: {} });
    expect(semCap.ok).toBe(false);
  }, 120_000);

  test("fila e ocorrências paginadas por cursor", async () => {
    const f1 = await rpc<{ itens: { id: string }[]; proximo: unknown }>(financeiro, "asaas_receber_fila", { _filtros: { limite: 1 } });
    expect(f1.ok).toBe(true);
    if (f1.dados.proximo) {
      const f2 = await rpc<{ itens: { id: string }[] }>(financeiro, "asaas_receber_fila", { _filtros: { limite: 1, cursor: f1.dados.proximo } });
      expect(f2.dados.itens[0]!.id).not.toBe(f1.dados.itens[0]!.id);
    }
    const o1 = await rpc(financeiro, "asaas_receber_ocorrencias", { _filtros: { limite: 1 } });
    expect(o1.ok).toBe(true);
  });
});

describe("isolamento entre contas e configuração", () => {
  test("simuladores por conta não compartilham cobranças nem eventos", async () => {
    const a = new SimuladorAsaas({ conta, semente: "iso" });
    const b = new SimuladorAsaas({ conta: contaB, semente: "iso" });
    a.semearCliente({ id: "sim_cus_a", name: "A" });
    const ca = a.semearCobranca({ customer: "sim_cus_a", valueCents: 100, dueDate: "2026-10-10", billingType: "PIX", status: "PENDING" });
    expect(await b.consultarCobranca(ca.id)).toBeNull();
    a.registrarRecebimento(ca.id, { pagoCents: 100, tarifaCents: 1, data: "2026-10-10" });
    expect((await b.receberEventos()).length).toBe(0);
    expect((await a.receberEventos()).length).toBe(1);
    const cb = b.semearCobranca({ customer: "x", valueCents: 1, dueDate: "2026-10-10", billingType: "PIX", status: "PENDING" });
    expect(cb.id).not.toBe(ca.id);
  });

  test("configuração ausente, ambígua ou inválida deixa a integração indisponível", async () => {
    expect(lerConfiguracao({}).disponivel).toBe(false);
    expect(lerConfiguracao({ ASAAS_MODO: "simulado" }).disponivel).toBe(true);
    expect(lerConfiguracao({ ASAAS_MODO: "simulado", ASAAS_AMBIENTE: "sandbox" }).disponivel).toBe(false);
    expect(lerConfiguracao({ ASAAS_MODO: "simulado", ASAAS_API_KEY: "$aact_hmlg_x" }).disponivel).toBe(false);
    expect(lerConfiguracao({ ASAAS_MODO: "conectado" }).disponivel).toBe(false);
    expect(lerConfiguracao({ ASAAS_MODO: "conectado", ASAAS_AMBIENTE: "sandbox" }).disponivel).toBe(false);
    expect(lerConfiguracao({ ASAAS_MODO: "conectado", ASAAS_AMBIENTE: "sandbox", ASAAS_API_KEY: "$aact_prod_x" }).disponivel).toBe(false);
    expect(lerConfiguracao({ ASAAS_MODO: "conectado", ASAAS_AMBIENTE: "producao", ASAAS_API_KEY: "$aact_prod_x", LARDAN_DEMO_ISOLADO: "1" }).disponivel).toBe(false);
    expect(lerConfiguracao({ ASAAS_MODO: "conectado", ASAAS_AMBIENTE: "sandbox", ASAAS_API_KEY: "$aact_hmlg_x" }).disponivel).toBe(true);
    expect(lerConfiguracao({ ASAAS_MODO: "simulacao" }).disponivel).toBe(false);
    await expect(criarTransporte(conta, lerConfiguracao({}))).rejects.toBeInstanceOf(IntegracaoIndisponivel);
  });
});

describe("eventos e conciliação", () => {
  test("recebimento é espelhado sem inventar baixa", async () => {
    const t = await criarTitulo(8800, "2026-10-05");
    const sim = simConta("evt");
    const link = await gerarLinkDeCobranca(banco(financeiro), sim, { accountId: conta, installmentId: t.installmentId, billingType: "BOLETO" });
    sim.registrarRecebimento(link.external_id!, { pagoCents: 8800, tarifaCents: 199, data: "2026-10-06" });
    const saida = await drenarEventos(servico, banco(master), sim, conta, "simulacao", master.uid);
    expect(saida.length).toBe(1);
    const [l] = (await adm.unsafe(
      `select received_cents, fee_cents, net_value_cents,
              (select count(*) from public.financial_allocations a where a.installment_id=$1)::int alocacoes
         from public.asaas_charges where external_id=$2`, [t.installmentId, link.external_id],
    )) as { received_cents: number; fee_cents: number; net_value_cents: number; alocacoes: number }[];
    expect(Number(l!.received_cents)).toBe(8800);
    expect(Number(l!.fee_cents)).toBe(199);
    expect(Number(l!.net_value_cents)).toBe(8601);
    expect(l!.alocacoes).toBe(0);
  });

  test("evento repetido não repete efeito", async () => {
    const evento = { id: `evt_rep_${marca()}`, event: "PAYMENT_CONFIRMED", chargeExternalId: "sim_pay_nenhuma", eventAt: "2026-10-08T10:00:00Z", payload: {} };
    const a = await registrarEvento(servico, conta, evento, "simulacao", master.uid);
    const b2 = await registrarEvento(servico, conta, evento, "simulacao", master.uid);
    expect(a.id).toBe(b2.id);
    expect(b2.novo).toBe(false);
  });

  test("entrada de evento: origem, conta e autorização conferidas", async () => {
    const e = { account_id: conta, external_id: `evt_${marca()}`, event: "PAYMENT_RECEIVED" };
    expect((await rpcServico("asaas_evento_registrar", { _payload: e, _origem: "provedor" })).erro).toContain("Conta sem conexão");
    expect((await rpcServico("asaas_evento_registrar", { _payload: e, _origem: "simulacao" })).erro).toContain("Sem permissão");
    expect((await rpcServico("asaas_evento_registrar", { _payload: e, _origem: "simulacao", _actor: semPermissao.uid })).erro).toContain("Sem permissão");
    expect((await rpcServico("asaas_evento_registrar", { _payload: e, _origem: "inventada", _actor: master.uid })).ok).toBe(false);
    expect((await rpcServico("asaas_evento_registrar", { _payload: { ...e, account_id: crypto.randomUUID() }, _origem: "simulacao", _actor: master.uid })).erro).toContain("conta");
  });

  test("dinheiro fora do Asaas não credita a conta do provedor", async () => {
    const [l] = (await adm.unsafe(`select efeito_caixa, revisao_manual from public.asaas_event_types where event='PAYMENT_RECEIVED_IN_CASH'`)) as { efeito_caixa: string; revisao_manual: boolean }[];
    expect(l!.efeito_caixa).not.toBe("credita_conta_asaas");
    expect(l!.revisao_manual).toBe(true);
  });

  test("envelope inválido é recusado antes de qualquer efeito", () => {
    expect(() => validarEnvelope({ accountId: conta, token: "x", tokenEsperado: "y", corpo: { id: "1", event: "A" } })).toThrow();
    expect(() => validarEnvelope({ accountId: null, token: "x", tokenEsperado: "x", corpo: { id: "1", event: "A" } })).toThrow();
    expect(() => validarEnvelope({ accountId: conta, token: "x", tokenEsperado: "x", corpo: { id: "1" } })).toThrow();
    expect(validarEnvelope({ accountId: conta, token: "x", tokenEsperado: "x", corpo: { id: "1", event: "A" } })).toBe(true);
  });
});

describe("nenhuma chamada externa", () => {
  test("o transporte HTTP padrão recusa antes de sair para a rede", async () => {
    const http = new TransporteHttpAsaas({ ambiente: "sandbox", chave: "$aact_hmlg_teste" });
    await expect(http.listarCobrancas({ limit: 1, offset: 0 })).rejects.toBeInstanceOf(ChamadaExternaBloqueada);
    await expect(http.criarCobranca({ customer: "x", valueCents: 1, dueDate: "2026-01-01", billingType: "PIX", externalReference: "r", idempotencyKey: "k" })).rejects.toBeInstanceOf(ChamadaExternaBloqueada);
  });

  test("a conta preparada está em modo simulado, sem ambiente de provedor", async () => {
    const [l] = (await adm.unsafe(`select is_active, modo_execucao, ambiente_provedor from public.asaas_accounts where id=$1`, [conta])) as { is_active: boolean; modo_execucao: string; ambiente_provedor: string | null }[];
    expect(l!.is_active).toBe(false);
    expect(l!.modo_execucao).toBe("simulado");
    expect(l!.ambiente_provedor).toBeNull();
  });
});

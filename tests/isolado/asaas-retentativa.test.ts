/**
 * Fechamento técnico — provas de retentativa, preflight, posse do cliente com
 * token, paginação oficial (offset + limit), concorrência de consultas e
 * privilégios. Banco ISOLADO, transporte SIMULADO ou falso; nenhuma rede.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, rpcServico, type Conta } from "./base";
import type { BancoAsaas } from "../../src/lib/asaas/banco";
import { SimuladorAsaas } from "../../src/lib/asaas/simulador";
import {
  ConsultaIndisponivel,
  CredencialRecusada,
  LimiteDeRequisicoes,
  RecusadoPeloProvedor,
  proximoOffsetOficial,
  type CobrancaExterna,
  type FiltroCobrancas,
  type Pagina,
  type TransporteAsaas,
} from "../../src/lib/asaas/contrato";
import { executarIntencao, prepararIntencao, retomarPendentes } from "../../src/lib/asaas/cobranca";
import { abrirLote, buscarPaginas, CONSULTAS_SIMULTANEAS } from "../../src/lib/asaas/importacao";
import { importarComPreflight, solicitarCobranca } from "../../src/lib/asaas/operacoes";

const banco = (c: Conta): BancoAsaas => ({
  async rpc<T>(fn: string, a: Record<string, unknown>) {
    const r = await rpc<T>(c, fn, a);
    if (!r.ok) throw new Error(r.erro ?? "falhou");
    return r.dados;
  },
});
const servico: BancoAsaas = {
  async rpc<T>(fn: string, a: Record<string, unknown>) {
    const r = await rpcServico<T>(fn, a);
    if (!r.ok) throw new Error(r.erro ?? "falhou");
    return r.dados;
  },
};

let fin: Conta, master: Conta, consultora: Conta, representante: Conta, inativo: Conta, semPessoa: Conta, diretoria: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const contar = async (sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as { c: number }[])[0]!.c;
const futuro = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const ENV_ISO = { LARDAN_DEMO_ISOLADO: "1" };

async function cenario(estado: "simulada" | "preparada" | "suspensa" | "sandbox_conectada" = "simulada") {
  const [e] = (await adm.unsafe(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp ${marca()}`])) as { id: string }[];
  const [a] = (await adm.unsafe(
    `insert into public.asaas_accounts (label, environment, state, owner_entity_id, opening_balance_strategy, external_account_id)
     values ($1,'sandbox','simulada',$2,'ignorar_anteriores',$3) returning id`, [`ISO Conta ${marca()}`, e!.id, `acc_${marca()}`])) as { id: string }[];
  if (estado !== "simulada") {
    const r = await rpc(master, "asaas_account_configurar", {
      _account: a!.id, _state: estado,
      _secret_ref: estado === "sandbox_conectada" ? "ASAAS_SANDBOX_LARDAN" : null,
      _webhook_secret_ref: estado === "sandbox_conectada" ? "ASAAS_WEBHOOK_LARDAN" : null,
    });
    if (!r.ok) throw new Error(r.erro ?? "");
  }
  const [p] = (await adm.unsafe(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO Dev ${marca()}`])) as { id: string }[];
  return { empresa: e!.id, conta: a!.id, party: p!.id };
}

async function vincular(conta: string, party: string) {
  const ext = `cus_${marca()}`;
  await adm.unsafe(`insert into public.asaas_customers (account_id, external_id, name, party_id, match_status) values ($1,$2,'ISO',$3,'vinculado')`, [conta, ext, party]);
  return ext;
}

async function titulo(empresa: string, party: string, valor = 5000) {
  const t = await rpc<string>(master, "fin_title_create", { _payload: {
    direction: "receivable", business_entity_id: empresa, party_id: party, descricao: `ISO ${marca()}`,
    valor_cents: valor, emissao: "2026-10-10", origem: "manual", status: "ativo",
    parcelas: [{ vencimento: "2026-10-10", valor_cents: valor }] } });
  if (!t.ok) throw new Error(t.erro ?? "");
  await rpc(master, "fin_title_approve", { _title: t.dados, _motivo: "ISO" });
  const { linhas } = await ler<{ id: string }>(master, `select id from public.financial_installments where title_id=$1`, [t.dados]);
  return { titleId: t.dados as unknown as string, installmentId: linhas[0]!.id };
}

const intencao = async (inst: string) =>
  ((await adm.unsafe(`select * from public.asaas_charge_intents where installment_id=$1 order by created_at`, [inst])) as Record<string, unknown>[]);

beforeAll(async () => {
  fin = await criarConta({ nome: "fin-rt", papeis: ["financeiro"], comParty: true });
  master = await criarConta({ nome: "master-rt", papeis: ["master"], comParty: true });
  diretoria = await criarConta({ nome: "dir-rt", papeis: ["diretoria"], comParty: true });
  consultora = await criarConta({ nome: "cons-rt", papeis: ["consultora"], comParty: true });
  representante = await criarConta({ nome: "rep-rt", papeis: ["representante"], comParty: true });
  inativo = await criarConta({ nome: "inat-rt", papeis: ["financeiro"], ativo: false, comParty: true });
  semPessoa = await criarConta({ nome: "semp-rt", papeis: ["financeiro"], comParty: false });
});

/* ======================================================================= */
describe("máquina de estados das retentativas (relógio controlado)", () => {
  async function comFalha(erro: () => Error) {
    const c = await cenario();
    const t = await titulo(c.empresa, c.party);
    const sim = new SimuladorAsaas({ conta: c.conta, semente: marca() });
    sim.semearCliente({ id: await vincular(c.conta, c.party), name: "ISO" });
    const original = sim.criarCobranca.bind(sim);
    let falhar = true;
    sim.criarCobranca = async (x) => { if (falhar) throw erro(); return original(x); };
    const it = await prepararIntencao(banco(fin), { installmentId: t.installmentId, billingType: "PIX" });
    const r = await executarIntencao(servico, sim, it.id!, { actor: fin.uid, worker: "w1" });
    return { c, t, sim, it, r, liberar: () => { falhar = false; } };
  }

  for (const status of [401, 403] as const) {
    test(`${status}: mesma intenção em espera, pendência operacional visível, nada antes do prazo`, async () => {
      const { c, t, sim, it, r, liberar } = await comFalha(() => new CredencialRecusada(status, ["invalid_access_token"]));
      expect(r.state).toBe("aguardando_retentativa");
      expect(r.failure_class).toBe("credencial");
      expect(r.pendencia_operacional).toBe(true);
      const [row] = await intencao(t.installmentId);
      expect(row!["lease_until"]).toBeNull();
      expect(row!["retomar_modo"]).toBe("criar");
      const prazo = new Date(row!["next_attempt_at"] as string).getTime();
      expect(prazo - Date.now()).toBeGreaterThan(3500_000);
      // nova solicitação não cria outra intenção
      const de_novo = await prepararIntencao(banco(fin), { installmentId: t.installmentId, billingType: "PIX" });
      expect(de_novo.id).toBe(it.id);
      expect((await intencao(t.installmentId)).length).toBe(1);
      // clique manual antes do prazo
      const cedo = await executarIntencao(servico, sim, it.id!, { actor: fin.uid, worker: "manual" });
      expect(cedo.reaproveitada).toBe(true);
      expect(cedo.state).toBe("aguardando_retentativa");
      // trabalhador automático antes do prazo
      const pend = await rpcServico<{ id: string }[]>("asaas_exec_pendentes", { _account: c.conta, _preparada_seg: 0 });
      expect(pend.dados.some((p) => p.id === it.id)).toBe(false);
      // painel mostra pendência
      const fila = await rpc<{ itens: { id: string; pendencia_operacional: boolean }[] }>(fin, "asaas_receber_fila", { _filtros: { account_id: c.conta } });
      expect(fila.dados.itens.find((i) => i.id === it.id)?.pendencia_operacional).toBe(true);
      // depois do prazo: retoma a MESMA intenção
      liberar();
      const depois = new Date(prazo + 1000).toISOString();
      const pend2 = await rpcServico<{ id: string }[]>("asaas_exec_pendentes", { _account: c.conta, _preparada_seg: 0, _agora: depois });
      expect(pend2.dados.some((p) => p.id === it.id)).toBe(true);
      const ok = await executarIntencao(servico, sim, it.id!, { actor: fin.uid, worker: "w2", agora: depois });
      expect(ok.state).toBe("criada");
      expect(sim.chamadasCriar).toBe(1);
      expect((await intencao(t.installmentId)).length).toBe(1);
      const ev = (await adm.unsafe(`select de, para from public.asaas_charge_intent_events where intent_id=$1 order by created_at, id`, [it.id])) as { de: string; para: string }[];
      expect(ev.map((e) => `${e.de ?? ""}>${e.para}`)).toEqual(
        expect.arrayContaining(["processando>aguardando_retentativa", "aguardando_retentativa>processando"]));
    });
  }

  test("429: Retry-After válido respeitado; inválido usa prazo padrão; mesma intenção", async () => {
    const { t, r } = await comFalha(() => new LimiteDeRequisicoes(12, ["rate_limit"]));
    expect(r.state).toBe("aguardando_retentativa");
    expect(r.failure_class).toBe("limite");
    const prazo = new Date((await intencao(t.installmentId))[0]!["next_attempt_at"] as string).getTime() - Date.now();
    expect(prazo).toBeGreaterThan(9_000);
    expect(prazo).toBeLessThan(15_000);
    const b = await comFalha(() => new LimiteDeRequisicoes(null));
    const p2 = new Date((await intencao(b.t.installmentId))[0]!["next_attempt_at"] as string).getTime() - Date.now();
    expect(p2).toBeGreaterThan(55_000);
    expect(p2).toBeLessThan(65_000);
  });

  test("consulta indisponível: espera em modo CONSULTAR; depois do prazo consulta, nunca reenvia", async () => {
    const c = await cenario();
    const t = await titulo(c.empresa, c.party);
    const sim = new SimuladorAsaas({ conta: c.conta, semente: marca() });
    sim.semearCliente({ id: await vincular(c.conta, c.party), name: "ISO" });
    const it = await prepararIntencao(banco(fin), { installmentId: t.installmentId, billingType: "PIX" });
    sim.definirFalha(it.internal_reference!, "perder_resposta");
    const a = await executarIntencao(servico, sim, it.id!, { actor: fin.uid });
    expect(a.state).toBe("desconhecida");
    const consultar = sim.consultarCobrancaPorReferencia.bind(sim);
    let fora = true;
    sim.consultarCobrancaPorReferencia = async (ref) => { if (fora) throw new ConsultaIndisponivel("fora do ar"); return consultar(ref); };
    const b = await executarIntencao(servico, sim, it.id!, { actor: fin.uid });
    expect(b.state).toBe("aguardando_retentativa");
    const [row] = await intencao(t.installmentId);
    expect(row!["retomar_modo"]).toBe("consultar");
    expect((await executarIntencao(servico, sim, it.id!, { actor: fin.uid })).reaproveitada).toBe(true);
    fora = false;
    const depois = futuro(400);
    const ok = await executarIntencao(servico, sim, it.id!, { actor: fin.uid, agora: depois });
    expect(ok.state).toBe("criada");
    expect(sim.chamadasCriar).toBe(1); // nenhum reenvio
  });

  test("dois trabalhadores simultâneos depois do prazo: apenas um assume", async () => {
    const { t, sim, it, liberar } = await comFalha(() => new LimiteDeRequisicoes(5));
    liberar();
    const depois = futuro(30);
    const [x, y] = await Promise.all([
      executarIntencao(servico, sim, it.id!, { actor: fin.uid, worker: "inst-a", agora: depois }),
      executarIntencao(servico, sim, it.id!, { actor: fin.uid, worker: "inst-b", agora: depois }),
    ]);
    expect([x.reaproveitada ?? false, y.reaproveitada ?? false].filter((v) => !v).length).toBe(1);
    expect(sim.chamadasCriar).toBe(1);
    expect(await contar(`select count(*)::int c from public.asaas_charges where installment_id=$1`, [t.installmentId])).toBe(1);
  });

  test("reinício antes do prazo continua bloqueado; retomada depois do prazo conclui", async () => {
    const { c, t, it, sim } = await comFalha(() => new LimiteDeRequisicoes(60));
    const estado = JSON.parse(JSON.stringify((sim as unknown as { estado(): unknown }).estado?.() ?? null));
    // "reinício": novo processo, novo simulador, novo trabalhador
    const reiniciado = new SimuladorAsaas({ conta: c.conta, semente: `re-${marca()}` });
    reiniciado.semearCliente({ id: String((await intencao(t.installmentId))[0]!["customer_external_id"]), name: "ISO" });
    void estado;
    const antes = await retomarPendentes(servico, async () => reiniciado, { actor: fin.uid, accountId: c.conta, preparadaSegundos: 0 });
    expect(antes.some((s) => s.id === it.id)).toBe(false);
    const depois = await retomarPendentes(servico, async () => reiniciado, { actor: fin.uid, accountId: c.conta, preparadaSegundos: 0, agora: futuro(120) });
    expect(depois.find((s) => s.id === it.id)?.state).toBe("criada");
    expect((await intencao(t.installmentId)).length).toBe(1);
  });

  test("erro terminal continua terminal", async () => {
    const { it, sim } = await comFalha(() => new RecusadoPeloProvedor("valor inválido", 400, ["invalid_value"]));
    const r = await executarIntencao(servico, sim, it.id!, { actor: fin.uid, agora: futuro(99999) });
    expect(r.state).toBe("rejeitada");
    expect(r.reaproveitada).toBe(true);
  });
});

/* ======================================================================= */
describe("preflight: nada é criado com conta indisponível", () => {
  const SECRETO = "$aact_hmlg_valor_sintetico_nao_real";
  const casos: { nome: string; estado: "preparada" | "suspensa" | "sandbox_conectada"; env: (conta: string) => Record<string, string>; situacao: string }[] = [
    { nome: "conta preparada", estado: "preparada", env: () => ENV_ISO, situacao: "preparada" },
    { nome: "conta suspensa", estado: "suspensa", env: () => ENV_ISO, situacao: "conta_suspensa" },
    { nome: "segredo ausente", estado: "sandbox_conectada", env: (c) => ({ ASAAS_CONNECTED_ACCOUNT_ID: c, ASAAS_EGRESS_ENABLED: "1" }), situacao: "credencial_ausente" },
    { nome: "segredo de outro ambiente", estado: "sandbox_conectada", env: (c) => ({ ASAAS_SANDBOX_LARDAN: "$aact_prod_x", ASAAS_CONNECTED_ACCOUNT_ID: c, ASAAS_EGRESS_ENABLED: "1" }), situacao: "credencial_ausente" },
    { nome: "conta não autorizada no servidor", estado: "sandbox_conectada", env: () => ({ ASAAS_SANDBOX_LARDAN: SECRETO, ASAAS_CONNECTED_ACCOUNT_ID: crypto.randomUUID(), ASAAS_EGRESS_ENABLED: "1" }), situacao: "indisponivel" },
    { nome: "saída externa desligada", estado: "sandbox_conectada", env: (c) => ({ ASAAS_SANDBOX_LARDAN: SECRETO, ASAAS_CONNECTED_ACCOUNT_ID: c }), situacao: "saida_desligada" },
  ];
  for (const caso of casos) {
    test(caso.nome, async () => {
      const c = await cenario(caso.estado);
      const t = await titulo(c.empresa, c.party);
      const antes = {
        it: await contar(`select count(*)::int c from public.asaas_charge_intents`),
        ev: await contar(`select count(*)::int c from public.asaas_charge_intent_events`),
        lote: await contar(`select count(*)::int c from public.asaas_import_runs`),
        ch: await contar(`select count(*)::int c from public.asaas_charges`),
        tit: JSON.stringify(await adm.unsafe(`select t.updated_at, i.updated_at u2 from public.financial_titles t join public.financial_installments i on i.title_id=t.id where t.id=$1`, [t.titleId])),
      };
      let fetchChamado = 0;
      const env = caso.env(c.conta);
      const r = await solicitarCobranca(banco(fin), servico, fin.uid!, { installmentId: t.installmentId, billingType: "PIX" },
        { env, fetch: async () => { fetchChamado++; throw new Error("rede"); } });
      expect(r.state).toBe("indisponivel");
      expect((r as { situacao: string }).situacao).toBe(caso.situacao);
      const imp = await importarComPreflight(banco(fin), servico, fin.uid!, { accountId: c.conta }, { env });
      expect(imp.indisponivel).toBe(true);
      const texto = JSON.stringify([r, imp]);
      expect(texto).not.toContain("ASAAS_SANDBOX");
      expect(texto).not.toContain("$aact");
      expect(texto).not.toContain("ASAAS_CONNECTED");
      expect(fetchChamado).toBe(0);
      expect(await contar(`select count(*)::int c from public.asaas_charge_intents`)).toBe(antes.it);
      expect(await contar(`select count(*)::int c from public.asaas_charge_intent_events`)).toBe(antes.ev);
      expect(await contar(`select count(*)::int c from public.asaas_import_runs`)).toBe(antes.lote);
      expect(await contar(`select count(*)::int c from public.asaas_charges`)).toBe(antes.ch);
      expect(JSON.stringify(await adm.unsafe(`select t.updated_at, i.updated_at u2 from public.financial_titles t join public.financial_installments i on i.title_id=t.id where t.id=$1`, [t.titleId]))).toBe(antes.tit);
      // nenhum segredo persistido no banco
      expect(await contar(`select count(*)::int c from public.asaas_accounts where coalesce(secret_ref,'') like '$aact%' or coalesce(webhook_secret_ref,'') like '$aact%'`)).toBe(0);
    });
  }

  test("simulação fora do ambiente isolado também é recusada antes de criar", async () => {
    const c = await cenario();
    const t = await titulo(c.empresa, c.party);
    const r = await solicitarCobranca(banco(fin), servico, fin.uid!, { installmentId: t.installmentId, billingType: "PIX" }, { env: {} });
    expect(r.state).toBe("indisponivel");
    expect((await intencao(t.installmentId)).length).toBe(0);
  });

  test("produção não pode ser ativada", async () => {
    const c = await cenario();
    const r = await rpc(master, "asaas_account_configurar", { _account: c.conta, _state: "producao_conectada", _secret_ref: "ASAAS_PRODUCAO_LARDAN" });
    expect(r.ok).toBe(false);
  });
});

/* ======================================================================= */
describe("paginação oficial: próximo = offset + limit", () => {
  /** Provedor sintético com páginas curtas/vazias programadas; cursor oficial. */
  function provedor(total: number, curtas: Record<number, number> = {}, recebidas = new Set<number>()) {
    const todos = Array.from({ length: total }, (_, i) => ({
      id: `pay_${String(i).padStart(5, "0")}`, customer: "", valueCents: 100, dueDate: "2026-10-10", billingType: "PIX",
      status: recebidas.has(i) ? "RECEIVED" : "PENDING", externalReference: null,
    }) as unknown as CobrancaExterna);
    const pedidos: number[] = [];
    const t = {
      ambiente: "sandbox", simulado: true, modo: "simulado", timeoutRequisicaoSegundos: 0,
      async listarCobrancas(f: FiltroCobrancas): Promise<Pagina<CobrancaExterna>> {
        pedidos.push(f.offset);
        const cheia = todos.slice(f.offset, f.offset + f.limit);
        const bruta = f.offset in curtas ? cheia.slice(0, curtas[f.offset]) : cheia;
        const hasMore = f.offset + f.limit < total;
        // filtro local: recebidas antigas não são mantidas
        const itens = bruta.filter((x) => x.status !== "RECEIVED");
        return { itens, quantidadeBruta: bruta.length, offset: f.offset, limit: f.limit, hasMore, total, proximoOffset: proximoOffsetOficial(f.offset, f.limit, bruta.length, hasMore) };
      },
      async consultarCliente() { return null; },
    } as unknown as TransporteAsaas;
    return { t, pedidos, todos };
  }
  const pedido = (conta: string, pageSize: number) => ({ accountId: conta, kind: "historica" as const, de: `2020-${String((n % 12) + 1).padStart(2, "0")}-01`, pageSize });
  const ids = async (run: string) => ((await adm.unsafe(`select external_id from public.asaas_import_stage where run_id=$1 and tipo='cobranca' order by external_id`, [run])) as { external_id: string }[]).map((r) => r.external_id);

  test("normal, curta com hasMore, vazia com hasMore e 100 recebidos/0 mantidos", async () => {
    const c = await cenario();
    // offset 100: 100 brutos, todos filtrados; offset 200: curta (30); offset 300: vazia
    const recebidas = new Set(Array.from({ length: 100 }, (_, i) => 100 + i));
    const { t, pedidos, todos } = provedor(450, { 200: 30, 300: 0 }, recebidas);
    const b = banco(fin);
    const lote = await abrirLote(b, pedido(c.conta, 100));
    const r = await buscarPaginas(b, t, lote, pedido(c.conta, 100));
    expect(pedidos).toEqual([0, 100, 200, 300, 400]);
    expect(r.offset).toBe(450);
    expect(r.hasMore).toBe(false);
    const esperado = todos.filter((_, i) => !recebidas.has(i) && !(i >= 230 && i < 300) && !(i >= 300 && i < 400)).map((x) => x.id);
    expect(await ids(lote.run_id)).toEqual(esperado);
    const pags = (await adm.unsafe(`select requested_offset, raw_count, kept_count, next_offset from public.asaas_import_pages where run_id=$1 order by requested_offset`, [lote.run_id])) as Record<string, number>[];
    expect(pags.map((p) => [p["requested_offset"], p["raw_count"], p["kept_count"], p["next_offset"]])).toEqual([
      [0, 100, 100, 100], [100, 100, 0, 200], [200, 30, 30, 300], [300, 0, 0, 400], [400, 50, 50, 450]]);
  });

  test("interrupção e retomada sem repetir nem pular", async () => {
    const c = await cenario();
    const { t, pedidos } = provedor(250, { 100: 10 });
    const b = banco(fin);
    const p = pedido(c.conta, 100);
    const lote = await abrirLote(b, p);
    await buscarPaginas(b, t, lote, { ...p, maxPaginas: 2 });
    const retomado = await abrirLote(b, p);
    expect(retomado.run_id).toBe(lote.run_id);
    expect(retomado.offset).toBe(200);
    const r = await buscarPaginas(b, t, retomado, p);
    expect(pedidos).toEqual([0, 100, 200]);
    expect(r.offset).toBe(250);
    const lista = await ids(lote.run_id);
    expect(new Set(lista).size).toBe(lista.length);
    expect(lista.length).toBe(100 + 10 + 50);
  });

  test("1.005 cobranças: nada omitido, nada repetido, sem ciclo", async () => {
    const c = await cenario();
    const { t, pedidos } = provedor(1005);
    const b = banco(fin);
    const lote = await abrirLote(b, pedido(c.conta, 100));
    const r = await buscarPaginas(b, t, lote, pedido(c.conta, 100));
    expect(r.paginas).toBe(11);
    expect(pedidos).toEqual(Array.from({ length: 11 }, (_, i) => i * 100));
    const lista = await ids(lote.run_id);
    expect(lista.length).toBe(1005);
    expect(new Set(lista).size).toBe(1005);
  }, 120_000);

  test("o banco recusa cursor calculado por data.length e aceita página repetida idêntica", async () => {
    const c = await cenario();
    const b = banco(fin);
    const lote = await abrirLote(b, pedido(c.conta, 100));
    const errado = await rpc(fin, "asaas_import_pagina", { _run: lote.run_id, _offset: 0, _limit: 100, _raw_count: 1, _next_offset: 1, _itens: [{ id: "pay_x" }], _has_more: true });
    expect(errado.ok).toBe(false);
    const args = { _run: lote.run_id, _offset: 0, _limit: 100, _raw_count: 1, _next_offset: 100, _itens: [{ id: "pay_x" }], _has_more: true };
    expect((await rpc(fin, "asaas_import_pagina", args)).ok).toBe(true);
    const repetida = await rpc<{ pagina_repetida: boolean }>(fin, "asaas_import_pagina", args);
    expect(repetida.dados.pagina_repetida).toBe(true);
    const regressiva = await rpc(fin, "asaas_import_pagina", { ...args, _offset: 0, _itens: [{ id: "pay_y" }] });
    expect(regressiva.ok).toBe(false);
  });

  test("consultas de clientes na importação têm concorrência limitada", async () => {
    const c = await cenario();
    let voo = 0, pico = 0;
    const itens = Array.from({ length: 40 }, (_, i) => ({ id: `pay_c${i}`, customer: `cus_c${i}`, valueCents: 1, dueDate: "2026-10-10", billingType: "PIX", status: "PENDING" }) as unknown as CobrancaExterna);
    const t = {
      ambiente: "sandbox", simulado: true, modo: "simulado", timeoutRequisicaoSegundos: 0,
      async listarCobrancas(f: FiltroCobrancas) { return { itens, quantidadeBruta: 40, offset: f.offset, limit: f.limit, hasMore: false, total: 40, proximoOffset: f.offset + 40 }; },
      async consultarCliente(id: string) { voo++; pico = Math.max(pico, voo); await new Promise((r) => setTimeout(r, 5)); voo--; return { id, name: id }; },
    } as unknown as TransporteAsaas;
    const b = banco(fin);
    const lote = await abrirLote(b, pedido(c.conta, 50));
    await buscarPaginas(b, t, lote, pedido(c.conta, 50));
    expect(pico).toBeLessThanOrEqual(CONSULTAS_SIMULTANEAS);
    expect(pico).toBeGreaterThan(1);
  });
});

/* ======================================================================= */
describe("posse do cliente com token", () => {
  async function duasIntencoes() {
    const c = await cenario();
    const a = await titulo(c.empresa, c.party, 1000);
    const b = await titulo(c.empresa, c.party, 2000);
    const ia = await prepararIntencao(banco(fin), { installmentId: a.installmentId, billingType: "PIX" });
    const ib = await prepararIntencao(banco(fin), { installmentId: b.installmentId, billingType: "PIX" });
    const ra = await rpcServico<{ tentativa: number }>("asaas_exec_reservar", { _intent: ia.id, _worker: "w1", _actor: fin.uid });
    const rb = await rpcServico<{ tentativa: number }>("asaas_exec_reservar", { _intent: ib.id, _worker: "w2", _actor: fin.uid });
    return { c, ia: ia.id!, ib: ib.id!, ta: ra.dados.tentativa, tb: rb.dados.tentativa };
  }

  test("trabalhador antigo não grava depois de perder a posse; renovação só para o dono", async () => {
    const { c, ia, ib, ta, tb } = await duasIntencoes();
    const l1 = await rpcServico<{ reservada: boolean; token: string }>("asaas_exec_cliente_reservar", { _intent: ia, _worker: "w1", _tentativa: ta, _actor: fin.uid });
    expect(l1.dados.reservada).toBe(true);
    const ocupado = await rpcServico<{ reservada: boolean }>("asaas_exec_cliente_reservar", { _intent: ib, _worker: "w2", _tentativa: tb, _actor: fin.uid });
    expect(ocupado.dados.reservada).toBe(false);
    expect((await rpcServico<boolean>("asaas_exec_cliente_renovar", { _intent: ia, _worker: "w1", _tentativa: ta, _actor: fin.uid, _token: l1.dados.token })).dados).toBe(true);
    expect((await rpcServico<boolean>("asaas_exec_cliente_renovar", { _intent: ia, _worker: "w1", _tentativa: ta, _actor: fin.uid, _token: crypto.randomUUID() })).dados).toBe(false);
    await adm.unsafe(`update public.asaas_customer_leases set lease_until=now()-interval '1 hour' where account_id=$1 and party_id=$2`, [c.conta, c.party]);
    const l2 = await rpcServico<{ reservada: boolean; token: string }>("asaas_exec_cliente_reservar", { _intent: ib, _worker: "w2", _tentativa: tb, _actor: fin.uid });
    expect(l2.dados.reservada).toBe(true);
    const velho = await rpcServico("asaas_exec_cliente", { _intent: ia, _worker: "w1", _tentativa: ta, _actor: fin.uid, _token: l1.dados.token, _external_id: "cus_velho", _nome: "x" });
    expect(velho.ok).toBe(false);
    expect(velho.erro).toContain("Posse do cliente perdida");
    const novo = await rpcServico("asaas_exec_cliente", { _intent: ib, _worker: "w2", _tentativa: tb, _actor: fin.uid, _token: l2.dados.token, _external_id: "cus_novo", _nome: "x" });
    expect(novo.ok).toBe(true);
    expect(await contar(`select count(*)::int c from public.asaas_customers where account_id=$1 and party_id=$2`, [c.conta, c.party])).toBe(1);
  });

  test("expiração durante POST lento: folga da requisição impede assumir; quem assume herda 'desconhecida'", async () => {
    const { c, ia, ib, ta, tb } = await duasIntencoes();
    const l1 = await rpcServico<{ token: string }>("asaas_exec_cliente_reservar", { _intent: ia, _worker: "w1", _tentativa: ta, _actor: fin.uid, _lease: 120, _timeout_req: 30 });
    await rpcServico("asaas_exec_cliente_estado", { _intent: ia, _worker: "w1", _tentativa: ta, _actor: fin.uid, _token: l1.dados.token, _state: "criar" });
    // posse venceu há 10 s, mas a requisição pode durar 30 s: ainda em voo
    await adm.unsafe(`update public.asaas_customer_leases set lease_until=now()-interval '10 seconds' where account_id=$1 and party_id=$2`, [c.conta, c.party]);
    const cedo = await rpcServico<{ reservada: boolean }>("asaas_exec_cliente_reservar", { _intent: ib, _worker: "w2", _tentativa: tb, _actor: fin.uid });
    expect(cedo.dados.reservada).toBe(false);
    await adm.unsafe(`update public.asaas_customer_leases set lease_until=now()-interval '31 seconds' where account_id=$1 and party_id=$2`, [c.conta, c.party]);
    const tarde = await rpcServico<{ reservada: boolean; estado: string }>("asaas_exec_cliente_reservar", { _intent: ib, _worker: "w2", _tentativa: tb, _actor: fin.uid });
    expect(tarde.dados.reservada).toBe(true);
    expect(tarde.dados.estado).toBe("desconhecida");
  });

  test("duas instâncias com criação de cliente lenta e renovação: um cliente externo, duas cobranças", async () => {
    const c = await cenario();
    const a = await titulo(c.empresa, c.party, 1100);
    const b = await titulo(c.empresa, c.party, 1200);
    const sim = new SimuladorAsaas({ conta: c.conta, semente: marca() });
    const criar = sim.prepararCliente.bind(sim);
    sim.prepararCliente = async (d) => { await new Promise((r) => setTimeout(r, 700)); return criar(d); };
    const env = ENV_ISO;
    const [x, y] = await Promise.all([
      solicitarCobranca(banco(fin), servico, fin.uid!, { installmentId: a.installmentId, billingType: "PIX" }, { env, transporte: async () => sim, worker: "inst-a" }),
      solicitarCobranca(banco(fin), servico, fin.uid!, { installmentId: b.installmentId, billingType: "PIX" }, { env, transporte: async () => sim, worker: "inst-b" }),
    ]);
    const pend = [x, y].filter((r) => r.state !== "criada");
    for (let i = 0; i < 3 && pend.length; i++) {
      await retomarPendentes(servico, async () => sim, { actor: fin.uid, accountId: c.conta, preparadaSegundos: 0, agora: futuro(200) });
    }
    expect(sim.chamadasCriarCliente).toBe(1);
    expect(await contar(`select count(*)::int c from public.asaas_customers where account_id=$1 and party_id=$2`, [c.conta, c.party])).toBe(1);
    expect(await contar(`select count(*)::int c from public.asaas_charges where installment_id in ($1,$2)`, [a.installmentId, b.installmentId])).toBe(2);
  }, 20_000);
});

/* ======================================================================= */
describe("privilégios das rotinas internas", () => {
  test("nenhuma rotina interna é executável por anon, authenticated ou PUBLIC", async () => {
    const linhas = (await adm.unsafe(`
      select p.proname, r.rolname
        from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
        cross join (values ('anon'),('authenticated'),('public')) r(rolname)
       where ns.nspname='public'
         and (p.proname like 'asaas_exec_%' or p.proname in ('asaas_cliente_posse','asaas_conta_situacao','asaas_receber_contas','asaas_evento_registrar'))
         and case when r.rolname='public'
                  then exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
                  else has_function_privilege(r.rolname, p.oid, 'EXECUTE') end`)) as { proname: string; rolname: string }[];
    expect(linhas).toEqual([]);
    const servicoPode = (await adm.unsafe(`select count(*)::int c from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
       where ns.nspname='public' and p.proname like 'asaas_exec_%'
         and p.proname not in ('asaas_exec_posse','asaas_exec_exigir_usuario') -- auxiliares internos das rotinas
         and not has_function_privilege('service_role', p.oid, 'EXECUTE')`)) as { c: number }[];
    expect(servicoPode[0]!.c).toBe(0);
  });

  test("perfis: desativado, sem pessoa, consultora, representante e visitante recusados; Financeiro e Diretoria separados", async () => {
    const c = await cenario();
    for (const quem of [inativo, semPessoa, consultora, representante]) {
      const r = await rpcServico("asaas_exec_preflight_conta", { _account: c.conta, _actor: quem.uid, _cap: "finance.receivable.view" });
      expect(r.ok).toBe(false);
      expect((await rpc(quem, "asaas_receber_fila", { _filtros: {} })).ok).toBe(false);
    }
    expect((await rpcServico("asaas_exec_preflight_conta", { _account: c.conta, _actor: null, _cap: "finance.receivable.view" })).ok).toBe(false);
    expect((await rpcServico("asaas_exec_preflight_conta", { _account: c.conta, _actor: fin.uid, _cap: "finance.receivable.manage" })).ok).toBe(true);
    // Diretoria acompanha, não opera cobrança
    expect((await rpcServico("asaas_exec_preflight_conta", { _account: c.conta, _actor: diretoria.uid, _cap: "finance.receivable.manage" })).ok).toBe(false);
    // capacidade arbitrária não é aceita
    expect((await rpcServico("asaas_exec_preflight_conta", { _account: c.conta, _actor: fin.uid, _cap: "finance.settings.manage" })).ok).toBe(false);
  });
});

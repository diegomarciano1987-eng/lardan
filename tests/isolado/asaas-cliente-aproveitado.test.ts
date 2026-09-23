/**
 * Bloqueio do ZIP 19 — cliente aproveitado + resposta perdida (usa os mesmos auxiliares). Fechamento técnico — provas de retentativa, preflight, posse do cliente com
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
  RespostaPerdida,
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
  // o cadastro cria pessoa automaticamente; aqui ela é removida de propósito
  await adm.unsafe(`update public.profiles set party_id=null where id=$1`, [semPessoa.uid]);
});


/** Espião por cima do simulador: conta POSTs e consultas por referência. */
function espiao(sim: SimuladorAsaas, perderRespostaDe: Set<string>) {
  const posts: string[] = []; const consultas: string[] = [];
  const criar = sim.criarCobranca.bind(sim);
  const consultar = sim.consultarCobrancaPorReferencia.bind(sim);
  const t = Object.create(sim) as TransporteAsaas;
  t.criarCobranca = async (x) => {
    posts.push(x.externalReference);
    const c = await criar(x); // o provedor CRIA
    if (perderRespostaDe.has(x.externalReference)) { perderRespostaDe.delete(x.externalReference); throw new RespostaPerdida("resposta perdida depois do envio"); }
    return c;
  };
  t.consultarCobrancaPorReferencia = async (ref) => { consultas.push(ref); return consultar(ref); };
  return { t, posts, consultas };
}

describe("ZIP 19: cliente vinculado por outra execução + resposta perdida", () => {
  test("duas parcelas da mesma pessoa: uma criação por parcela, recuperação após reinício devolve o mesmo identificador", async () => {
    const c = await cenario();
    const t1 = await titulo(c.empresa, c.party);
    const t2 = await titulo(c.empresa, c.party);
    const sim = new SimuladorAsaas({ conta: c.conta, semente: marca() });

    // as duas intenções são preparadas ANTES de existir cliente vinculado
    const i1 = await prepararIntencao(banco(fin), { installmentId: t1.installmentId, billingType: "PIX" });
    const i2 = await prepararIntencao(banco(fin), { installmentId: t2.installmentId, billingType: "PIX" });
    expect((await intencao(t2.installmentId))[0]!["customer_external_id"]).toBeNull();
    // execução A cria e vincula o cliente da pessoa
    const a = espiao(sim, new Set());
    const r1 = await executarIntencao(servico, a.t, i1.id!, { actor: fin.uid, worker: "wA" });
    expect(r1.state).toBe("criada");
    const [cli] = (await adm.unsafe(`select external_id from public.asaas_customers where account_id=$1 and party_id=$2`, [c.conta, c.party])) as { external_id: string }[];

    // execução B aproveita o cliente; o provedor cria a cobrança e a resposta se perde
    const [antes] = await intencao(t2.installmentId);
    const ref2 = antes!["internal_reference"] as string;
    const b = espiao(sim, new Set([ref2]));
    const r2 = await executarIntencao(servico, b.t, i2.id!, { actor: fin.uid, worker: "wB" });
    expect(r2.state).toBe("desconhecida");
    const [aposFalha] = await intencao(t2.installmentId);
    expect(aposFalha!["customer_external_id"]).toBe(cli!.external_id); // persistido ANTES do POST
    const criadaNoProvedor = await sim.consultarCobrancaPorReferencia(ref2);
    expect(criadaNoProvedor).not.toBeNull();

    // reinício: novo transporte (o provedor mantém o estado), nova execução
    const rein = espiao(sim, new Set());
    const r3 = await executarIntencao(servico, rein.t, i2.id!, { actor: fin.uid, worker: "wC" });
    expect(r3.state).toBe("criada");
    expect(r3.external_id).toBe(criadaNoProvedor!.id);
    expect(rein.consultas).toContain(ref2);
    expect(rein.posts).toHaveLength(0);
    expect([...b.posts, ...rein.posts].filter((x) => x === ref2)).toHaveLength(1);
    const intents2 = await intencao(t2.installmentId);
    expect(intents2).toHaveLength(1); // mesma intenção
    expect(intents2[0]!["internal_reference"]).toBe(ref2); // mesma referência
    const lista = await sim.listarCobrancas({ limit: 100, offset: 0 });
    expect(lista.itens.filter((x) => x.externalReference === ref2)).toHaveLength(1);
    expect(await contar(`select count(*)::int c from public.asaas_customers where account_id=$1 and party_id=$2`, [c.conta, c.party])).toBe(1);
  });

  test("intenção desconhecida já existente SEM vínculo de cliente: consulta antes de qualquer POST e recupera o mesmo identificador", async () => {
    const c = await cenario();
    const t = await titulo(c.empresa, c.party);
    const sim = new SimuladorAsaas({ conta: c.conta, semente: marca() });
    sim.semearCliente({ id: await vincular(c.conta, c.party), name: "ISO" });
    const it = await prepararIntencao(banco(fin), { installmentId: t.installmentId, billingType: "PIX" });
    const [row0] = await intencao(t.installmentId);
    const ref = row0!["internal_reference"] as string;
    const x = espiao(sim, new Set([ref]));
    expect((await executarIntencao(servico, x.t, it.id!, { actor: fin.uid, worker: "w1" })).state).toBe("desconhecida");
    // estado legado: desconhecida com customer_external_id nulo (como no serviço original)
    await adm.begin(async (tx) => {
      await tx.unsafe(`select set_config('lardann.asaas_intent','on',true)`);
      await tx.unsafe(`update public.asaas_charge_intents set customer_external_id=null where id=$1`, [it.id]);
    });
    expect((await intencao(t.installmentId))[0]!["customer_external_id"]).toBeNull();
    const achada = await sim.consultarCobrancaPorReferencia(ref);

    const y = espiao(sim, new Set());
    const r = await executarIntencao(servico, y.t, it.id!, { actor: fin.uid, worker: "w2" });
    expect(r.state).toBe("criada");
    expect(r.external_id).toBe(achada!.id);
    expect(y.consultas[0]).toBe(ref);
    expect(y.posts).toHaveLength(0);
    expect([...x.posts, ...y.posts]).toHaveLength(1);
    expect((await intencao(t.installmentId))).toHaveLength(1);
  });

  test("desconhecida sem vínculo e SEM cobrança no provedor: consulta primeiro, depois um único envio", async () => {
    const c = await cenario();
    const t = await titulo(c.empresa, c.party);
    const sim = new SimuladorAsaas({ conta: c.conta, semente: marca() });
    sim.semearCliente({ id: await vincular(c.conta, c.party), name: "ISO" });
    const it = await prepararIntencao(banco(fin), { installmentId: t.installmentId, billingType: "PIX" });
    const ref = (await intencao(t.installmentId))[0]!["internal_reference"] as string;
    // força "desconhecida" sem nenhum POST: falha de transporte antes de chegar ao provedor
    const z = Object.create(sim) as TransporteAsaas;
    z.criarCobranca = async () => { throw new RespostaPerdida("queda"); };
    expect((await executarIntencao(servico, z, it.id!, { actor: fin.uid, worker: "w1" })).state).toBe("desconhecida");
    await adm.begin(async (tx) => {
      await tx.unsafe(`select set_config('lardann.asaas_intent','on',true)`);
      await tx.unsafe(`update public.asaas_charge_intents set customer_external_id=null where id=$1`, [it.id]);
    });
    const y = espiao(sim, new Set());
    const r = await executarIntencao(servico, y.t, it.id!, { actor: fin.uid, worker: "w2" });
    expect(y.consultas).toEqual([ref]);
    expect(y.posts).toEqual([ref]);
    expect(r.state).toBe("criada");
    expect((await intencao(t.installmentId))[0]!["customer_external_id"]).not.toBeNull();
  });
});

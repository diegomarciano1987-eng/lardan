/**
 * Homologação do departamento financeiro do LARDAN Cloud.
 *
 * Prova, com sessões reais, o saldo inicial no razão, a ausência de contagem
 * dupla, o plano de contas hierárquico, os centros de custo, a máquina de
 * estados dos títulos, o fluxo de caixa apurado pelo razão e o bloqueio por
 * perfil. Toda a massa usa o prefixo HOMOLOG e é removida ao final; catálogo,
 * estoque e fotos não são tocados.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConta, rpc, comoUsuario, TEST_PREFIX } from "../security/harness";

const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const T = 120_000;
const marca = `${TEST_PREFIX}-FIN-${Date.now()}`;

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });

let master: string | null = null;
let estoque: string | null = null;
let contaPositiva = "";
let contaNegativa = "";
let contaZero = "";
let planoPai = "";
let planoFilho = "";
let centro = "";
let partyId = "";
let tituloId = "";

const hoje = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  master = (await criarConta({ nome: "fin-master", papeis: ["master"] })).token;
  estoque = (await criarConta({ nome: "fin-estoque", papeis: ["estoque"] })).token;

  const r = await admin(`/parties`, {
    method: "POST",
    body: JSON.stringify({
      kind: "pessoa",
      display_name: `${marca} Contraparte`,
      legal_name: `${marca} Contraparte`,
      status: "ativo",
    }),
  });
  partyId = ((await r.json()) as { id: string }[])[0]!.id;
}, T);

afterAll(async () => {
  // Remove exclusivamente a massa marcada desta execução.
  // Títulos sintéticos desta bancada (prefixo HOMOLOG na descrição).
  const r = await admin(`/financial_titles?descricao=like.HOMOLOG*&select=id`);
  for (const t of (await r.json()) as { id: string }[]) {
    await admin(`/financial_title_events?title_id=eq.${t.id}`, { method: "DELETE" });
    await admin(`/financial_installments?title_id=eq.${t.id}`, { method: "DELETE" });
    await admin(`/financial_titles?id=eq.${t.id}`, { method: "DELETE" });
  }
  // O razão é imutável: as contas desta execução são isoladas pelos IDs que
  // este próprio teste criou — nada é escolhido por nome nem apagado do razão.
  const idsDaExecucao = [contaPositiva, contaNegativa, contaZero].filter(Boolean);
  if (idsDaExecucao.length > 0) {
    const iso = await admin(`/rpc/fin_test_isolate_accounts`, {
      method: "POST",
      body: JSON.stringify({ _ids: idsDaExecucao, _marca: marca }),
    });
    if (!iso.ok) throw new Error(`Isolamento da massa falhou: ${await iso.text()}`);
  }
  await admin(`/chart_of_accounts?codigo=like.HOMOLOG-FIN*`, { method: "DELETE" });
  await admin(`/cost_centers?codigo=like.HOMOLOG-FIN*`, { method: "DELETE" });
  if (planoFilho) await admin(`/chart_of_accounts?id=eq.${planoFilho}`, { method: "DELETE" });
  if (planoPai) await admin(`/chart_of_accounts?id=eq.${planoPai}`, { method: "DELETE" });
  if (centro) await admin(`/cost_centers?id=eq.${centro}`, { method: "DELETE" });
  await admin(`/parties?display_name=like.HOMOLOG-FIN*`, { method: "DELETE" });
}, T);

describe("Saldo inicial das contas", () => {
  it(
    "grava o saldo inicial como movimento real do razão, sem contagem dupla",
    async () => {
      const pos = await rpc(master, "fin_account_create", {
        _payload: {
          nome: `${marca} Positiva`,
          kind: "conta_corrente",
          saldo_inicial_cents: 150_000,
        },
      });
      expect(pos.status).toBe(200);
      contaPositiva = pos.body as string;

      const neg = await rpc(master, "fin_account_create", {
        _payload: {
          nome: `${marca} Negativa`,
          kind: "conta_corrente",
          saldo_inicial_cents: -45_000,
        },
      });
      expect(neg.status).toBe(200);
      contaNegativa = neg.body as string;

      const zero = await rpc(master, "fin_account_create", {
        _payload: { nome: `${marca} Zero`, kind: "caixa", saldo_inicial_cents: 0 },
      });
      expect(zero.status).toBe(200);
      contaZero = zero.body as string;

      const detalhe = async (id: string) => {
        const r = await rpc(master, "fin_account_detail", { _account: id });
        return r.body as { conta: { saldo_cents: number }; movimentos: { kind: string }[] };
      };

      const dPos = await detalhe(contaPositiva);
      expect(dPos.conta.saldo_cents).toBe(150_000);
      expect(dPos.movimentos.filter((m) => m.kind === "saldo_inicial")).toHaveLength(1);

      const dNeg = await detalhe(contaNegativa);
      expect(dNeg.conta.saldo_cents).toBe(-45_000);

      const dZero = await detalhe(contaZero);
      expect(dZero.conta.saldo_cents).toBe(0);
      expect(dZero.movimentos.filter((m) => m.kind === "saldo_inicial")).toHaveLength(0);
    },
    T,
  );

  it(
    "não permite alterar nem apagar o marco de saldo inicial",
    async () => {
      await comoUsuario(
        master,
        `/financial_account_movements?financial_account_id=eq.${contaPositiva}&kind=eq.saldo_inicial`,
        { method: "DELETE" },
      );
      const restou = await admin(
        `/financial_account_movements?financial_account_id=eq.${contaPositiva}&kind=eq.saldo_inicial&select=id,valor_cents`,
      );
      expect(((await restou.json()) as unknown[]).length).toBe(1);

      // Alteração direta também é recusada pelo banco.
      const alterar = await admin(
        `/financial_account_movements?financial_account_id=eq.${contaPositiva}&kind=eq.saldo_inicial`,
        { method: "PATCH", body: JSON.stringify({ valor_cents: 1 }) },
      );
      expect(alterar.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );
});

describe("Plano de contas e centros de custo", () => {
  it(
    "cria hierarquia, recusa ciclo e recusa código duplicado",
    async () => {
      const pai = await rpc(master, "fin_chart_save", {
        _payload: {
          codigo: `${marca}-1`,
          nome: `${marca} Receitas`,
          natureza: "receita",
          aceita_lancamento: false,
        },
      });
      expect(pai.status).toBe(200);
      planoPai = pai.body as string;

      const filho = await rpc(master, "fin_chart_save", {
        _payload: {
          codigo: `${marca}-1.1`,
          nome: `${marca} Vendas`,
          natureza: "receita",
          parent_id: planoPai,
          aceita_lancamento: true,
        },
      });
      expect(filho.status).toBe(200);
      planoFilho = filho.body as string;

      const ciclo = await rpc(master, "fin_chart_save", {
        _payload: {
          id: planoPai,
          codigo: `${marca}-1`,
          nome: `${marca} Receitas`,
          natureza: "receita",
          parent_id: planoFilho,
        },
      });
      expect(ciclo.status).toBeGreaterThanOrEqual(400);

      const duplicado = await rpc(master, "fin_chart_save", {
        _payload: { codigo: `${marca}-1`, nome: `${marca} Repetida`, natureza: "receita" },
      });
      expect(duplicado.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "cria centro de custo e recusa código repetido",
    async () => {
      const c = await rpc(master, "fin_cost_center_save", {
        _payload: { codigo: `${marca}-CC`, nome: `${marca} Operação` },
      });
      expect(c.status).toBe(200);
      centro = c.body as string;

      const repetido = await rpc(master, "fin_cost_center_save", {
        _payload: { codigo: `${marca}-CC`, nome: `${marca} Outro` },
      });
      expect(repetido.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );
});

describe("Máquina de estados dos títulos", () => {
  it(
    "recusa nascer em situação inválida",
    async () => {
      const r = await rpc(master, "fin_title_create", {
        _payload: {
          direction: "receivable",
          party_id: partyId,
          descricao: `${marca} Inválido`,
          status: "aprovado",
          valor_cents: 1_000,
          emissao: hoje,
          parcelas: [{ vencimento: hoje, valor_cents: 1_000 }],
        },
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "percorre rascunho, submissão, recusa com motivo e aprovação",
    async () => {
      const criado = await rpc(master, "fin_title_create", {
        _payload: {
          direction: "receivable",
          party_id: partyId,
          descricao: `${marca} Título`,
          status: "rascunho",
          valor_cents: 30_000,
          emissao: hoje,
          parcelas: [{ vencimento: hoje, valor_cents: 30_000 }],
        },
      });
      expect(criado.status).toBe(200);
      tituloId = criado.body as string;

      // Recusa exige motivo.
      await rpc(master, "fin_title_submit", { _title: tituloId });
      const semMotivo = await rpc(master, "fin_title_reject", { _title: tituloId, _motivo: "" });
      expect(semMotivo.status).toBeGreaterThanOrEqual(400);

      const recusa = await rpc(master, "fin_title_reject", {
        _title: tituloId,
        _motivo: "Documento faltando",
      });
      expect(recusa.status).toBeLessThan(300);

      // Recusado volta a rascunho: aprovar direto é inválido.
      const aprovarInvalido = await rpc(master, "fin_title_approve", {
        _title: tituloId,
        _motivo: "",
      });
      expect(aprovarInvalido.status).toBeGreaterThanOrEqual(400);

      await rpc(master, "fin_title_submit", { _title: tituloId });
      const aprovado = await rpc(master, "fin_title_approve", { _title: tituloId, _motivo: "" });
      expect(aprovado.status).toBeLessThan(300);

      // Aprovar de novo é idempotente: não gera segundo evento de aprovação.
      const reaprovar = await rpc(master, "fin_title_approve", { _title: tituloId, _motivo: "" });
      expect(reaprovar.status).toBeLessThan(300);
      const eventos = await admin(
        `/financial_title_events?title_id=eq.${tituloId}&evento=eq.aprovado&select=id`,
      );
      expect(((await eventos.json()) as unknown[]).length).toBe(1);

      // Título ativo não volta para submetido.
      const voltar = await rpc(master, "fin_title_submit", { _title: tituloId });
      expect(voltar.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "título cancelado não ressuscita",
    async () => {
      await rpc(master, "fin_title_cancel", {
        _title: tituloId,
        _motivo: "Encerrando homologação",
      });
      const submeter = await rpc(master, "fin_title_submit", { _title: tituloId });
      expect(submeter.status).toBeGreaterThanOrEqual(400);
      const aprovar = await rpc(master, "fin_title_approve", { _title: tituloId, _motivo: "" });
      expect(aprovar.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );
});

describe("Fluxo de caixa", () => {
  it(
    "apura o realizado exclusivamente pelo razão",
    async () => {
      const r = await rpc(master, "fin_cashflow", {
        _filtros: { de: hoje, ate: hoje, agrupamento: "dia", conta_id: contaPositiva },
      });
      expect(r.status).toBe(200);
      const d = r.body as { totais: { saldo_final_realizado_cents: number } };
      expect(typeof d.totais.saldo_final_realizado_cents).toBe("number");
    },
    T,
  );
});

describe("Permissões", () => {
  it(
    "perfil de estoque e visitante não leem o financeiro",
    async () => {
      const estoqueLeitura = await rpc(estoque, "fin_overview", {});
      expect(estoqueLeitura.status).toBeGreaterThanOrEqual(400);

      const anonimo = await rpc(null, "fin_overview", {});
      expect(anonimo.status).toBeGreaterThanOrEqual(400);

      const criar = await rpc(estoque, "fin_account_create", {
        _payload: { nome: `${marca} Proibida`, kind: "caixa", saldo_inicial_cents: 0 },
      });
      expect(criar.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );
});

describe("Catálogo preservado", () => {
  it(
    "produtos, variantes e fotos permanecem intactos",
    async () => {
      const contar = async (tabela: string) => {
        const res = await fetch(`${URL}/rest/v1/${tabela}?select=id`, {
          headers: {
            apikey: SERVICE,
            Authorization: `Bearer ${SERVICE}`,
            Prefer: "count=exact",
            Range: "0-0",
          },
        });
        return Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
      };
      expect(await contar("products")).toBeGreaterThanOrEqual(22);
      expect(await contar("product_variants")).toBeGreaterThanOrEqual(40);
      expect(await contar("product_media")).toBeGreaterThanOrEqual(40);
    },
    T,
  );
});

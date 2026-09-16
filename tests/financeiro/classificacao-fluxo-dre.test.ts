/**
 * Classificação de títulos, fluxo de caixa e DRE gerencial.
 *
 * Toda a massa é criada aqui, marcada com o prefixo HOMOLOG desta execução e
 * removida ao final pelos IDs que este próprio teste gerou. O razão nunca é
 * apagado: as contas usadas são isoladas pela rotina técnica, que recusa
 * qualquer ID fora do conjunto criado agora.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConta, rpc, TEST_PREFIX } from "../security/harness";

const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const T = 120_000;
const marca = `${TEST_PREFIX}-CLASS-${Date.now()}`;

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

const hoje = new Date().toISOString().slice(0, 10);

let master: string | null = null;
let party = "";
let conta = "";
let planoReceita = "";
let planoDespesa = "";
let planoInativo = "";
let centro = "";
let tituloReceber = "";
let tituloPagar = "";
let tituloSemClasse = "";

async function criarPlano(codigo: string, nome: string, natureza: string) {
  const r = await admin(`/chart_of_accounts`, {
    method: "POST",
    body: JSON.stringify({ codigo, nome, natureza, aceita_lancamento: true, is_active: true }),
  });
  return ((await r.json()) as { id: string }[])[0]!.id;
}

beforeAll(async () => {
  master = (await criarConta({ nome: "class-master", papeis: ["master"] })).token;

  const p = await admin(`/parties`, {
    method: "POST",
    body: JSON.stringify({
      kind: "pessoa",
      display_name: `${marca} Contraparte`,
      legal_name: `${marca} Contraparte`,
      status: "ativo",
    }),
  });
  party = ((await p.json()) as { id: string }[])[0]!.id;

  planoReceita = await criarPlano(`${marca}-3.1`, "Vendas de semijoias", "receita");
  planoDespesa = await criarPlano(`${marca}-4.1`, "Despesas administrativas", "despesa");
  planoInativo = await criarPlano(`${marca}-4.9`, "Conta encerrada", "despesa");
  await admin(`/chart_of_accounts?id=eq.${planoInativo}`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: false }),
  });

  const cc = await admin(`/cost_centers`, {
    method: "POST",
    body: JSON.stringify({ codigo: `${marca}-CC`, nome: "Maletas", is_active: true }),
  });
  centro = ((await cc.json()) as { id: string }[])[0]!.id;

  const c = await rpc(master, "fin_account_create", {
    _payload: { nome: `${marca} Caixa`, kind: "caixa", saldo_inicial_cents: 100_000 },
  });
  conta = c.body as string;
}, T);

afterAll(async () => {
  for (const id of [tituloReceber, tituloPagar, tituloSemClasse].filter(Boolean)) {
    const parcelas = await admin(`/financial_installments?title_id=eq.${id}&select=id`);
    for (const i of (await parcelas.json()) as { id: string }[]) {
      await admin(`/financial_allocations?installment_id=eq.${i.id}`, { method: "DELETE" });
    }
    await admin(`/financial_title_events?title_id=eq.${id}`, { method: "DELETE" });
    await admin(`/financial_installments?title_id=eq.${id}`, { method: "DELETE" });
    await admin(`/financial_titles?id=eq.${id}`, { method: "DELETE" });
  }
  if (conta) {
    const iso = await admin(`/rpc/fin_test_isolate_accounts`, {
      method: "POST",
      body: JSON.stringify({ _ids: [conta], _marca: marca }),
    });
    if (!iso.ok) throw new Error(`Isolamento falhou: ${await iso.text()}`);
  }
  for (const id of [planoReceita, planoDespesa, planoInativo].filter(Boolean)) {
    await admin(`/chart_of_accounts?id=eq.${id}`, { method: "DELETE" });
  }
  if (centro) await admin(`/cost_centers?id=eq.${centro}`, { method: "DELETE" });
  if (party) await admin(`/parties?id=eq.${party}`, { method: "DELETE" });
}, T);

describe("Classificação do título", () => {
  it(
    "grava o título com plano de contas e centro de custo e recarrega igual",
    async () => {
      const r = await rpc(master, "fin_title_create", {
        _payload: {
          direction: "receivable",
          party_id: party,
          descricao: `${marca} venda classificada`,
          valor_cents: 50_000,
          competencia: hoje,
          emissao: hoje,
          chart_account_id: planoReceita,
          cost_center_id: centro,
          parcelas: [{ vencimento: hoje, valor_cents: 50_000 }],
        },
      });
      expect(r.status).toBe(200);
      tituloReceber = r.body as string;

      const d = await rpc(master, "fin_title_detail", { _title: tituloReceber });
      const t = (d.body as { titulo: Record<string, unknown> }).titulo;
      expect(t["chart_account_id"]).toBe(planoReceita);
      expect(t["cost_center_id"]).toBe(centro);
      expect(t["pendente_classificacao"]).toBe(false);
    },
    T,
  );

  it(
    "aceita título sem classificação e o marca como pendente",
    async () => {
      const r = await rpc(master, "fin_title_create", {
        _payload: {
          direction: "payable",
          party_id: party,
          descricao: `${marca} despesa sem classificação`,
          valor_cents: 12_345,
          competencia: hoje,
          emissao: hoje,
          parcelas: [{ vencimento: hoje, valor_cents: 12_345 }],
        },
      });
      expect(r.status).toBe(200);
      tituloSemClasse = r.body as string;

      const d = await rpc(master, "fin_title_detail", { _title: tituloSemClasse });
      expect(
        (d.body as { titulo: Record<string, unknown> }).titulo["pendente_classificacao"],
      ).toBe(true);
    },
    T,
  );

  it(
    "recusa natureza incompatível e conta contábil inativa",
    async () => {
      const incompativel = await rpc(master, "fin_title_create", {
        _payload: {
          direction: "receivable",
          party_id: party,
          descricao: `${marca} incompatível`,
          valor_cents: 1_000,
          chart_account_id: planoDespesa,
          parcelas: [{ vencimento: hoje, valor_cents: 1_000 }],
        },
      });
      expect(incompativel.status).toBeGreaterThanOrEqual(400);

      const inativa = await rpc(master, "fin_title_create", {
        _payload: {
          direction: "payable",
          party_id: party,
          descricao: `${marca} inativa`,
          valor_cents: 1_000,
          chart_account_id: planoInativo,
          parcelas: [{ vencimento: hoje, valor_cents: 1_000 }],
        },
      });
      expect(inativa.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "classifica depois, registra o histórico e barra alteração concorrente",
    async () => {
      const antes = await rpc(master, "fin_title_detail", { _title: tituloSemClasse });
      const updated = (
        (antes.body as { titulo: Record<string, unknown> }).titulo["updated_at"] as string
      ).toString();

      const ok = await rpc(master, "fin_title_classify", {
        _payload: {
          title_id: tituloSemClasse,
          chart_account_id: planoDespesa,
          cost_center_id: centro,
          esperado_updated_at: updated,
          motivo: "Classificação inicial da homologação",
        },
      });
      expect(ok.status).toBe(200);

      const depois = await rpc(master, "fin_title_detail", { _title: tituloSemClasse });
      const corpo = depois.body as {
        titulo: Record<string, unknown>;
        eventos: { evento: string }[];
      };
      expect(corpo.titulo["chart_account_id"]).toBe(planoDespesa);
      expect(corpo.eventos.some((e) => e.evento === "classificado")).toBe(true);

      const velho = await rpc(master, "fin_title_classify", {
        _payload: {
          title_id: tituloSemClasse,
          chart_account_id: planoDespesa,
          esperado_updated_at: updated,
        },
      });
      expect(velho.status).toBeGreaterThanOrEqual(400);
      tituloPagar = tituloSemClasse;
      tituloSemClasse = "";
    },
    T,
  );
});

describe("Fluxo de caixa em centavos", () => {
  it(
    "separa saldo de abertura, realizado e previsto",
    async () => {
      const baixa = await rpc(master, "fin_settlement_create", {
        _payload: {
          direction: "receivable",
          financial_account_id: conta,
          data: hoje,
          valor_cents: 20_000,
          idempotency_key: `${marca}-baixa`,
          alocacoes: [
            {
              installment_id: (
                (
                  (await rpc(master, "fin_title_detail", { _title: tituloReceber })).body as {
                    parcelas: { id: string }[];
                  }
                ).parcelas[0] as { id: string }
              ).id,
              valor_cents: 20_000,
            },
          ],
        },
      });
      expect(baixa.status).toBe(200);

      const f = await rpc(master, "fin_cashflow", {
        _filtros: { de: hoje, ate: hoje, agrupamento: "dia", conta_id: conta },
      });
      const c = f.body as {
        saldo_abertura_cents: number;
        totais: Record<string, number>;
      };
      // Saldo inicial da conta é abertura, nunca entrada operacional do período.
      expect(c.saldo_abertura_cents).toBe(100_000);
      expect(c.totais["entradas_realizadas_cents"]).toBe(20_000);
      expect(c.totais["saidas_realizadas_cents"]).toBe(0);
      expect(c.totais["saldo_final_realizado_cents"]).toBe(120_000);

      const det = await rpc(master, "fin_cashflow_detail", {
        _filtros: { de: hoje, ate: hoje, conta_id: conta, tipo: "realizado" },
      });
      expect((det.body as { soma_cents: number }).soma_cents).toBe(20_000);
    },
    T,
  );

  it(
    "mostra movimento sem a classificação filtrada à parte, em vez de descartar",
    async () => {
      const f = await rpc(master, "fin_cashflow", {
        _filtros: { de: hoje, ate: hoje, conta_id: conta, centro_custo_id: centro },
      });
      const t = (f.body as { totais: Record<string, number> }).totais;
      expect(t["entradas_realizadas_cents"] + t["nao_classificado_entradas_cents"]).toBe(20_000);
    },
    T,
  );
});

describe("DRE gerencial", () => {
  it(
    "soma por natureza em competência e aponta pendências",
    async () => {
      const r = await rpc(master, "fin_dre", {
        _filtros: { de: hoje, ate: hoje, regime: "competencia" },
      });
      const d = r.body as {
        linhas: { chart_id: string; valor_cents: number }[];
        totais: Record<string, number>;
        pendentes_classificacao: { quantidade: number };
      };
      const receita = d.linhas.find((l) => l.chart_id === planoReceita);
      expect(receita?.valor_cents).toBe(50_000);
      const despesa = d.linhas.find((l) => l.chart_id === planoDespesa);
      expect(despesa?.valor_cents).toBe(12_345);
      // O resultado é sempre receitas menos despesas do período, mesmo quando
      // há outras linhas classificadas no mesmo dia.
      expect(d.totais["resultado_cents"]).toBe(
        (d.totais["receitas_cents"] ?? 0) - (d.totais["despesas_cents"] ?? 0),
      );
      expect(d.pendentes_classificacao.quantidade).toBeGreaterThanOrEqual(0);
    },
    T,
  );

  it(
    "no regime de caixa considera apenas o que foi efetivamente movimentado",
    async () => {
      const r = await rpc(master, "fin_dre", {
        _filtros: { de: hoje, ate: hoje, regime: "caixa" },
      });
      const d = r.body as { linhas: { chart_id: string; valor_cents: number }[] };
      const receita = d.linhas.find((l) => l.chart_id === planoReceita);
      expect(receita?.valor_cents).toBe(20_000);
      expect(d.linhas.find((l) => l.chart_id === planoDespesa)).toBeUndefined();
    },
    T,
  );
});

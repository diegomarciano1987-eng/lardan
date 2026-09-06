/**
 * Bateria de homologação de permissões — roda contra o banco real com contas
 * sintéticas (@lardan.test). Prova, papel a papel, o que cada um consegue ler.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarConta, limpar, rpc, type Conta } from "./harness";

const T = 60_000;
const contas: Record<string, Conta> = {};

beforeAll(async () => {
  for (const [nome, papel] of [
    ["master", "master"],
    ["estoque", "estoque"],
    ["financeiro", "financeiro"],
    ["consultora", "consultora"],
  ] as const) {
    contas[nome] = await criarConta({ nome, papel });
  }
  contas["inativo"] = await criarConta({ nome: "inativo", papel: "master", ativo: false });
}, 120_000);

afterAll(async () => {
  await limpar();
}, 120_000);

describe("visitante não logado", () => {
  it(
    "não lê tabelas sensíveis pela Data API",
    async () => {
      for (const tabela of ["parties", "stock_movements", "variant_costs", "profiles"]) {
        const r = await comoUsuario(null, `/${tabela}?select=id&limit=1`);
        // Ou a porta está fechada, ou a resposta vem vazia: nunca com dado.
        const vazio = Array.isArray(r.body) && r.body.length === 0;
        expect(r.status >= 400 || vazio, `${tabela} devolveu ${r.status}`).toBe(true);
      }
    },
    T,
  );

  it(
    "não executa funções internas",
    async () => {
      for (const fn of ["stock_movements_list", "list_parties", "publish_products", "my_roles"]) {
        const r = await rpc(null, fn, {});
        expect(r.status, `${fn} devolveu ${r.status}`).toBeGreaterThanOrEqual(400);
      }
    },
    T,
  );

  it(
    "enxerga apenas o catálogo publicado",
    async () => {
      const r = await rpc(null, "public_categories", {});
      expect(r.status).toBe(200);
    },
    T,
  );
});

describe("custo unitário", () => {
  it(
    "não volta para o papel Estoque",
    async () => {
      const r = await rpc(contas["estoque"]!.token, "stock_movements_list", { _size: 5 });
      expect(r.status).toBe(200);
      const payload = r.body as { pode_ver_custo: boolean; rows: Record<string, unknown>[] };
      expect(payload.pode_ver_custo).toBe(false);
      for (const linha of payload.rows) {
        expect(Object.keys(linha)).not.toContain("unit_cost_cents");
      }
    },
    T,
  );

  it(
    "volta para Master e Financeiro",
    async () => {
      for (const nome of ["master", "financeiro"]) {
        const r = await rpc(contas[nome]!.token, "stock_movements_list", { _size: 5 });
        expect(r.status, nome).toBe(200);
        const payload = r.body as { pode_ver_custo: boolean; rows: Record<string, unknown>[] };
        expect(payload.pode_ver_custo, nome).toBe(true);
        for (const linha of payload.rows) {
          expect(Object.keys(linha), nome).toContain("unit_cost_cents");
        }
      }
    },
    T,
  );

  it(
    "consultora não vê estoque nenhum",
    async () => {
      const r = await rpc(contas["consultora"]!.token, "stock_movements_list", {});
      expect(r.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );
});

describe("documento (CPF/CNPJ)", () => {
  it(
    "consultora não recebe documento aberto nem consegue revelar",
    async () => {
      const lista = await rpc(contas["consultora"]!.token, "list_parties", { _size: 5 });
      if (lista.status === 200) {
        const rows = (lista.body as { rows?: Record<string, unknown>[] }).rows ?? [];
        for (const linha of rows) {
          expect(linha["doc"] ?? null).toBeNull();
        }
      } else {
        expect(lista.status).toBeGreaterThanOrEqual(400);
      }
      const reveal = await rpc(contas["consultora"]!.token, "party_doc_reveal", {
        _party_id: "00000000-0000-0000-0000-000000000000",
      });
      expect(reveal.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );
});

describe("perfil desativado", () => {
  it(
    "Master inativo perde todas as capacidades",
    async () => {
      const r = await rpc(contas["inativo"]!.token, "my_capabilities", {});
      expect(r.status).toBe(200);
      expect((r.body as unknown[]).length).toBe(0);
    },
    T,
  );
});

/**
 * Custo no cockpit de produtos — banco ISOLADO, dados sintéticos.
 *  1. A permissão catalog.cost.view existe só para Master, Diretoria e Financeiro.
 *  2. product_costs_read devolve o custo importado para quem tem a permissão.
 *  3. Estoque, marketing e consultora são recusados pela rotina de custos.
 *  4. O custo salvo no banco é exatamente o que a tela recebe (sem arredondar).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta, diretoria: Conta, financeiro: Conta;
let estoque: Conta, marketing: Conta, consultora: Conta;
let produtoId = "";
const CUSTO_CENTS = 4321;

interface CustosLidos {
  produto: { id: string; cost_price_cents: number | null };
}

beforeAll(async () => {
  master = await criarConta({ nome: "master-custos-tela", papeis: ["master"], comParty: true });
  diretoria = await criarConta({ nome: "dir-custos-tela", papeis: ["diretoria"], comParty: true });
  financeiro = await criarConta({ nome: "fin-custos-tela", papeis: ["financeiro"], comParty: true });
  estoque = await criarConta({ nome: "est-custos-tela", papeis: ["estoque"], comParty: true });
  marketing = await criarConta({ nome: "mkt-custos-tela", papeis: ["marketing"], comParty: true });
  consultora = await criarConta({ nome: "cons-custos-tela", papeis: ["consultora"], comParty: true });

  const [p] = (await adm.unsafe(
    `insert into public.products (name, slug, cost_price_cents)
     values ($1, $2, $3) returning id`,
    [`ISO Peça custo tela ${Date.now()}`, `iso-custo-tela-${Date.now()}`, CUSTO_CENTS],
  )) as { id: string }[];
  produtoId = p!.id;
});

describe("custo no cockpit de produtos", () => {
  test("catalog.cost.view existe só para Master, Diretoria e Financeiro", async () => {
    const linhas = (await adm.unsafe(
      `select role::text as role from public.role_capabilities
       where capability = 'catalog.cost.view' order by role`,
    )) as { role: string }[];
    expect(linhas.map((l) => l.role)).toEqual(["diretoria", "financeiro", "master"]);
  });

  test("Master, Diretoria e Financeiro leem o custo importado pela rotina autorizada", async () => {
    for (const conta of [master, diretoria, financeiro]) {
      const r = await rpc<CustosLidos>(conta, "product_costs_read", { _product: produtoId });
      expect(r.erro).toBeNull();
      expect(r.dados?.produto?.cost_price_cents).toBe(CUSTO_CENTS);
    }
  });

  test("Estoque, marketing e consultora são recusados pela rotina de custos", async () => {
    for (const conta of [estoque, marketing, consultora]) {
      const r = await rpc<CustosLidos>(conta, "product_costs_read", { _product: produtoId });
      expect(r.ok).toBe(false);
      expect(r.erro).toBeTruthy();
    }
  });

  test("produto sem custo devolve vazio, não zero inventado", async () => {
    const [p] = (await adm.unsafe(
      `insert into public.products (name, slug) values ($1, $2) returning id`,
      [`ISO Peça sem custo ${Date.now()}`, `iso-sem-custo-${Date.now()}`],
    )) as { id: string }[];
    const r = await rpc<CustosLidos>(master, "product_costs_read", { _product: p!.id });
    expect(r.erro).toBeNull();
    expect(r.dados?.produto?.cost_price_cents ?? null).toBeNull();
  });
});

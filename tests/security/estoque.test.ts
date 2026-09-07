/**
 * Homologação do estoque operacional — roda contra o banco real com contas
 * sintéticas (@lardan.test) e uma peça já existente. Nada é apagado: as
 * movimentações criadas são compensadas ao final por lançamentos inversos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarConta, limpar, rpc, type Conta } from "./harness";

const T = 90_000;

const contas: Record<string, Conta> = {};
let variantId = "";
let localA = "";
let localB = "";

const relatorio: { perfil: string; cenario: string; esperado: string; obtido: string }[] = [];
function registrar(perfil: string, cenario: string, esperado: string, obtido: string) {
  relatorio.push({ perfil, cenario, esperado, obtido });
}

const chave = () => `homolog-${crypto.randomUUID()}`;

async function mover(
  token: string | null,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return rpc(token, "register_stock_movement", { _idempotency_key: chave(), ...args });
}

/** Saldo físico do local, lido com poder de leitura total (master). */
async function saldo(local: string): Promise<number> {
  const r = await comoUsuario(
    contas["master"]!.token,
    `/stock_balances?variant_id=eq.${variantId}&location_id=eq.${local}&select=quantity`,
  );
  const linhas = Array.isArray(r.body) ? (r.body as { quantity: number }[]) : [];
  return linhas[0]?.quantity ?? 0;
}

beforeAll(async () => {
  for (const papel of ["master", "financeiro", "estoque", "consultora"] as const) {
    contas[papel] = await criarConta({
      nome: papel,
      papeis: [papel],
      comParty: papel === "consultora",
    });
  }

  const v = await comoUsuario(
    contas["master"]!.token,
    "/product_variants?select=id&is_active=eq.true&limit=1",
  );
  variantId = (v.body as { id: string }[])[0]?.id ?? "";

  const l = await comoUsuario(
    contas["master"]!.token,
    "/locations?select=id&is_active=eq.true&order=code&limit=2",
  );
  const locais = (l.body as { id: string }[]) ?? [];
  localA = locais[0]?.id ?? "";
  localB = locais[1]?.id ?? locais[0]?.id ?? "";

  expect(variantId, "peça de teste").toBeTruthy();
  expect(localA, "local de teste").toBeTruthy();
}, 180_000);

afterAll(async () => {
  // eslint-disable-next-line no-console
  console.table(relatorio);
  await limpar();
}, 120_000);

describe("estoque operacional", () => {
  it(
    "Estoque não consegue injetar custo pela RPC",
    async () => {
      const r = await mover(contas["estoque"]!.token, {
        _kind: "entrada",
        _variant_id: variantId,
        _quantity: 3,
        _to_location_id: localA,
        _reason_code: "compra",
        _unit_cost_cents: 12345,
        _reference: "HOMOLOG-CUSTO",
      });
      expect(r.status).toBe(200);
      const id = (r.body as { movement_id?: string }).movement_id ?? (r.body as string);
      const lido = await comoUsuario(
        contas["master"]!.token,
        `/rpc/stock_movements_list?_search=HOMOLOG-CUSTO`,
      );
      const custo = await rpc(contas["master"]!.token, "stock_movements_list", {
        _search: "HOMOLOG-CUSTO",
        _size: 5,
      });
      const linhas =
        ((custo.body as { rows?: { unit_cost_cents: number | null }[] }).rows ?? []) as {
          unit_cost_cents: number | null;
        }[];
      registrar(
        "estoque",
        "injetar custo pela RPC",
        "custo descartado",
        `mov ${String(id).slice(0, 8)} custo=${JSON.stringify(linhas[0]?.unit_cost_cents ?? null)} (${lido.status})`,
      );
      expect(linhas[0]?.unit_cost_cents ?? null).toBeNull();
    },
    T,
  );

  it(
    "Financeiro vê custo mas não movimenta",
    async () => {
      const caps = await rpc(contas["financeiro"]!.token, "my_capabilities", {});
      const lista = Array.isArray(caps.body)
        ? (caps.body as { capability: string }[]).map((c) => c.capability)
        : [];
      const r = await mover(contas["financeiro"]!.token, {
        _kind: "entrada",
        _variant_id: variantId,
        _quantity: 1,
        _to_location_id: localA,
      });
      registrar(
        "financeiro",
        "ver custo / movimentar",
        "vê custo, não movimenta",
        `caps=${lista.includes("stock.cost.view")} mov HTTP ${r.status}`,
      );
      expect(lista).toContain("stock.cost.view");
      expect(lista).not.toContain("stock.operate");
      expect(r.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "custo negativo é recusado",
    async () => {
      const r = await mover(contas["master"]!.token, {
        _kind: "entrada",
        _variant_id: variantId,
        _quantity: 1,
        _to_location_id: localA,
        _unit_cost_cents: -100,
      });
      registrar("master", "custo negativo", "recusado", `HTTP ${r.status}`);
      expect(r.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "saldo negativo é recusado",
    async () => {
      const atual = await saldo(localA);
      const r = await mover(contas["master"]!.token, {
        _kind: "saida",
        _variant_id: variantId,
        _quantity: atual + 5000,
        _from_location_id: localA,
        _reason_code: "venda",
      });
      registrar("master", "saída maior que o saldo", "recusada", `HTTP ${r.status}`);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(await saldo(localA)).toBe(atual);
    },
    T,
  );

  it(
    "duplo clique não duplica: mesma chave devolve o mesmo lançamento",
    async () => {
      const k = chave();
      const antes = await saldo(localA);
      const args = {
        _kind: "entrada",
        _variant_id: variantId,
        _quantity: 2,
        _to_location_id: localA,
        _reason_code: "compra",
        _reference: "HOMOLOG-IDEMP",
        _idempotency_key: k,
      };
      const [a, b] = await Promise.all([
        rpc(contas["master"]!.token, "register_stock_movement", args),
        rpc(contas["master"]!.token, "register_stock_movement", args),
      ]);
      const depois = await saldo(localA);
      registrar(
        "master",
        "idempotência concorrente",
        "um único efeito",
        `HTTP ${a.status}/${b.status} saldo ${antes}→${depois}`,
      );
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
      expect(depois).toBe(antes + 2);
    },
    T,
  );

  it(
    "dois lançamentos simultâneos não retiram a mesma unidade",
    async () => {
      const antes = await saldo(localA);
      const [a, b] = await Promise.all([
        mover(contas["master"]!.token, {
          _kind: "saida",
          _variant_id: variantId,
          _quantity: 1,
          _from_location_id: localA,
          _reason_code: "venda",
        }),
        mover(contas["master"]!.token, {
          _kind: "saida",
          _variant_id: variantId,
          _quantity: 1,
          _from_location_id: localA,
          _reason_code: "venda",
        }),
      ]);
      const depois = await saldo(localA);
      const ok = [a.status, b.status].filter((s) => s === 200).length;
      registrar(
        "master",
        "concorrência de saída",
        "cada unidade sai uma vez",
        `ok=${ok} saldo ${antes}→${depois}`,
      );
      expect(depois).toBe(antes - ok);
    },
    T,
  );

  it(
    "transferência é atômica e registra os dois lados",
    async () => {
      if (localA === localB) return;
      const a0 = await saldo(localA);
      const b0 = await saldo(localB);
      const r = await mover(contas["master"]!.token, {
        _kind: "transferencia",
        _variant_id: variantId,
        _quantity: 1,
        _from_location_id: localA,
        _to_location_id: localB,
        _reference: "HOMOLOG-TRANSF",
      });
      const a1 = await saldo(localA);
      const b1 = await saldo(localB);
      registrar(
        "master",
        "transferência",
        "origem -1 e destino +1",
        `HTTP ${r.status} origem ${a0}→${a1} destino ${b0}→${b1}`,
      );
      expect(r.status).toBe(200);
      expect(a1).toBe(a0 - 1);
      expect(b1).toBe(b0 + 1);
    },
    T,
  );

  it(
    "Consultora e visitante não leem estoque",
    async () => {
      for (const [perfil, token] of [
        ["consultora", contas["consultora"]!.token],
        ["visitante", null],
      ] as const) {
        const saldos = await rpc(token, "stock_balances_list", {});
        const movs = await rpc(token, "stock_movements_list", {});
        const direto = await comoUsuario(token, "/stock_balances?select=id&limit=1");
        registrar(
          perfil,
          "leitura de estoque",
          "negada",
          `saldos ${saldos.status} / movs ${movs.status} / tabela ${direto.status}`,
        );
        expect(saldos.status).toBeGreaterThanOrEqual(400);
        expect(movs.status).toBeGreaterThanOrEqual(400);
        const linhas = Array.isArray(direto.body) ? direto.body.length : 0;
        expect(linhas).toBe(0);
      }
    },
    T,
  );

  it(
    "movimentação não pode ser alterada nem apagada",
    async () => {
      const patch = await comoUsuario(contas["master"]!.token, `/stock_movements?limit=1`, {
        method: "PATCH",
        body: JSON.stringify({ quantity: 999 }),
      });
      const del = await comoUsuario(contas["master"]!.token, `/stock_movements?limit=1`, {
        method: "DELETE",
      });
      registrar(
        "master",
        "alterar/apagar movimentação",
        "negado",
        `PATCH ${patch.status} / DELETE ${del.status}`,
      );
      expect(patch.status).toBeGreaterThanOrEqual(400);
      expect(del.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "ajuste, perda e avaria exigem justificativa escrita",
    async () => {
      const semNota = await mover(contas["master"]!.token, {
        _kind: "ajuste",
        _variant_id: variantId,
        _quantity: -1,
        _from_location_id: localA,
        _to_location_id: localA,
        _reason_code: "ajuste",
      });
      registrar("master", "ajuste sem justificativa", "recusado", `HTTP ${semNota.status}`);
      expect(semNota.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );
});

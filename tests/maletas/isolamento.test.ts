/**
 * Homologação de segurança e integridade das maletas.
 *
 * Cobre isolamento por pessoa, recusa de acesso sem identidade válida,
 * bloqueio de escrita direta nas tabelas, integridade do aceite,
 * concorrência na montagem e busca de pessoas além da primeira página.
 *
 * Tudo é sintético (prefixo HOMOLOG). Nenhum produto publicado, foto,
 * consultora real ou saldo de produção é tocado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConta, limpar, rpc, TEST_PREFIX } from "../security/harness";

const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const ANON =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const T = 180_000;

const admin = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  try {
    return { status: res.status, body: JSON.parse(txt) as unknown };
  } catch {
    return { status: res.status, body: txt as unknown };
  }
};

/** Chamada REST direta na tabela, como o usuário logado faria pelo navegador. */
const tabela = async (token: string | null, path: string, init: RequestInit = {}) => {
  const res = await fetch(`${URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  try {
    return { status: res.status, body: JSON.parse(txt) as unknown };
  } catch {
    return { status: res.status, body: txt as unknown };
  }
};

const marca = Date.now();
let tokenMaster: string | null = null;
let tokenA: string | null = null;
let tokenB: string | null = null;
let tokenRepA: string | null = null;
let tokenRepB: string | null = null;
let tokenSemVinculo: string | null = null;
let tokenSemPapel: string | null = null;
let tokenDesativado: string | null = null;
let partyA = "";
let partyB = "";
let repA = "";
let deposito = "";
let varA = "";
let varEscasso = "";
let cicloA = "";
let cicloB = "";

async function saldo(variant: string, quantidade: number) {
  await admin(`/stock_balances?on_conflict=variant_id,location_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      variant_id: variant,
      location_id: deposito,
      quantity: quantidade,
      reserved: 0,
    }),
  });
}

beforeAll(async () => {
  tokenMaster = (await criarConta({ nome: "iso-master", papeis: ["master"] })).token;
  const a = await criarConta({ nome: "iso-consultora-a", papeis: ["consultora"], comParty: true });
  const b = await criarConta({ nome: "iso-consultora-b", papeis: ["consultora"], comParty: true });
  const ra = await criarConta({ nome: "iso-rep-a", papeis: ["representante"], comParty: true });
  const rb = await criarConta({ nome: "iso-rep-b", papeis: ["representante"], comParty: true });
  tokenA = a.token;
  tokenB = b.token;
  tokenRepA = ra.token;
  tokenRepB = rb.token;
  partyA = a.partyId!;
  partyB = b.partyId!;
  repA = ra.partyId!;

  const semVinculo = await criarConta({ nome: "iso-sem-vinculo", papeis: ["consultora"] });
  // o cadastro cria uma pessoa automaticamente: aqui o vínculo é desfeito de propósito
  await admin(`/profiles?id=eq.${semVinculo.userId}`, {
    method: "PATCH",
    body: JSON.stringify({ party_id: null }),
  });
  tokenSemVinculo = semVinculo.token;
  tokenSemPapel = (await criarConta({ nome: "iso-sem-papel", papeis: [], comParty: true })).token;
  tokenDesativado = (
    await criarConta({ nome: "iso-desativado", papeis: ["consultora"], comParty: true, ativo: false })
  ).token;

  const dep = await admin(`/locations`, {
    method: "POST",
    body: JSON.stringify({
      code: `HOMOLOG-ISO-${marca}`,
      name: `${TEST_PREFIX} Depósito iso ${marca}`,
      kind: "deposito",
      is_active: true,
    }),
  });
  deposito = (dep.body as { id: string }[])[0]!.id;

  const prod = await admin(`/products`, {
    method: "POST",
    body: JSON.stringify({
      name: `${TEST_PREFIX} Peça iso ${marca}`,
      slug: `homolog-iso-${marca}`,
    }),
  });
  const produto = (prod.body as { id: string }[])[0]!.id;

  const vars = await admin(`/product_variants`, {
    method: "POST",
    body: JSON.stringify([
      { product_id: produto, sku: `HOM-ISO-${marca}-A`, label: "A", price_cents: 12000, is_active: true },
      { product_id: produto, sku: `HOM-ISO-${marca}-E`, label: "E", price_cents: 15000, is_active: true },
    ]),
  });
  const criadas = (vars.body as { id: string; sku: string }[]).sort((x, y) => x.sku.localeCompare(y.sku));
  varA = criadas[0]!.id;
  varEscasso = criadas[1]!.id;

  await saldo(varA, 300);
  await saldo(varEscasso, 2);

  const ca = await rpc(tokenMaster, "kit_cycle_create", {
    _payload: { origin_location_id: deposito, consultora_party_id: partyA, representante_party_id: repA },
  });
  cicloA = (ca.body as { cycle_id: string }).cycle_id;
  const cb = await rpc(tokenMaster, "kit_cycle_create", {
    _payload: { origin_location_id: deposito, consultora_party_id: partyB },
  });
  cicloB = (cb.body as { cycle_id: string }).cycle_id;

  await rpc(tokenMaster, "kit_item_upsert", { _cycle: cicloA, _variant: varA, _qty: 4 });
  await rpc(tokenMaster, "kit_item_upsert", { _cycle: cicloB, _variant: varA, _qty: 2 });
}, T);

afterAll(async () => {
  await admin(`/kit_balances?variant_id=in.(${varA},${varEscasso})`, { method: "DELETE" });
  await limpar();
}, T);

describe("Maletas — isolamento por pessoa", () => {
  it(
    "1. consultora A só vê as próprias maletas no quadro",
    async () => {
      const r = await rpc(tokenA, "kit_board", { _filtros: {} });
      expect(r.status).toBe(200);
      const ids = (r.body as { cycle_id: string }[]).map((m) => m.cycle_id);
      expect(ids).toContain(cicloA);
      expect(ids).not.toContain(cicloB);
    },
    T,
  );

  it(
    "2. consultora A não abre o detalhe da maleta de B, mesmo conhecendo o identificador",
    async () => {
      const r = await rpc(tokenA, "kit_detail", { _cycle: cicloB });
      expect(r.status).toBeGreaterThanOrEqual(400);
      const leitura = await tabela(tokenA, `/kit_cycles?select=id&id=eq.${cicloB}`);
      expect(leitura.body).toEqual([]);
    },
    T,
  );

  it(
    "3. representante só vê a carteira sob sua responsabilidade",
    async () => {
      const seu = await rpc(tokenRepA, "kit_board", { _filtros: {} });
      expect((seu.body as { cycle_id: string }[]).map((m) => m.cycle_id)).toContain(cicloA);
      const outro = await rpc(tokenRepB, "kit_board", { _filtros: {} });
      const ids = (outro.body as { cycle_id: string }[]).map((m) => m.cycle_id);
      expect(ids).not.toContain(cicloA);
      expect(ids).not.toContain(cicloB);
    },
    T,
  );

  it(
    "4. visitante, usuário sem vínculo, sem papel e desativado são recusados",
    async () => {
      const visitante = await rpc(null, "kit_board", { _filtros: {} });
      expect(visitante.status).toBeGreaterThanOrEqual(400);

      const semVinculo = await rpc(tokenSemVinculo, "kit_board", { _filtros: {} });
      expect(semVinculo.status).toBeGreaterThanOrEqual(400);

      const semPapel = await rpc(tokenSemPapel, "kit_board", { _filtros: {} });
      expect(semPapel.status).toBeGreaterThanOrEqual(400);

      const desativado = await rpc(tokenDesativado, "kit_board", { _filtros: {} });
      expect(desativado.status).toBeGreaterThanOrEqual(400);

      const detalhe = await rpc(tokenDesativado, "kit_detail", { _cycle: cicloA });
      expect(detalhe.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "5. papel removido durante a sessão tira o acesso na hora",
    async () => {
      const conta = await criarConta({ nome: "iso-perde-papel", papeis: ["consultora"], comParty: true });
      const antes = await rpc(conta.token, "kit_board", { _filtros: {} });
      expect(antes.status).toBe(200);
      await admin(`/user_roles?user_id=eq.${conta.userId}`, { method: "DELETE" });
      const depois = await rpc(conta.token, "kit_board", { _filtros: {} });
      expect(depois.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );
});

describe("Maletas — escrita direta bloqueada", () => {
  it(
    "6. consultora não muda o estado nem o responsável do ciclo por escrita direta",
    async () => {
      const estado = await tabela(tokenA, `/kit_cycles?id=eq.${cicloA}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "operacao" }),
      });
      expect(estado.status).toBeGreaterThanOrEqual(400);

      const dono = await tabela(tokenA, `/kit_cycles?id=eq.${cicloB}`, {
        method: "PATCH",
        body: JSON.stringify({ consultora_party_id: partyA }),
      });
      expect(dono.status).toBeGreaterThanOrEqual(400);

      const linha = await admin(`/kit_cycles?select=status,consultora_party_id&id=eq.${cicloB}`);
      const row = (linha.body as { status: string; consultora_party_id: string }[])[0]!;
      expect(row.consultora_party_id).toBe(partyB);
    },
    T,
  );

  it(
    "7. perfil interno também não altera a composição conferida por escrita direta",
    async () => {
      const c = await rpc(tokenMaster, "kit_cycle_create", {
        _payload: { origin_location_id: deposito, consultora_party_id: partyA },
      });
      const ciclo = (c.body as { cycle_id: string }).cycle_id;
      await rpc(tokenMaster, "kit_item_upsert", { _cycle: ciclo, _variant: varA, _qty: 2 });
      await rpc(tokenMaster, "kit_conferir", { _cycle: ciclo });

      const comp = await admin(`/kit_compositions?select=id&cycle_id=eq.${ciclo}`);
      const compId = (comp.body as { id: string }[])[0]!.id;

      const direta = await tabela(
        tokenMaster,
        `/kit_composition_items?composition_id=eq.${compId}&variant_id=eq.${varA}`,
        { method: "PATCH", body: JSON.stringify({ quantity: 99 }) },
      );
      expect(direta.status).toBeGreaterThanOrEqual(400);

      // nem mesmo com privilégio de serviço a composição congelada muda em silêncio
      const servico = await admin(
        `/kit_composition_items?composition_id=eq.${compId}&variant_id=eq.${varA}`,
        { method: "PATCH", body: JSON.stringify({ quantity: 99 }) },
      );
      expect(servico.status).toBeGreaterThanOrEqual(400);

      const conferida = await admin(
        `/kit_composition_items?select=quantity&composition_id=eq.${compId}`,
      );
      expect((conferida.body as { quantity: number }[])[0]!.quantity).toBe(2);
    },
    T,
  );
});

describe("Maletas — integridade do aceite", () => {
  async function maletaPronta(qtd: number) {
    const c = await rpc(tokenMaster, "kit_cycle_create", {
      _payload: { origin_location_id: deposito, consultora_party_id: partyA },
    });
    const ciclo = (c.body as { cycle_id: string }).cycle_id;
    await rpc(tokenMaster, "kit_item_upsert", { _cycle: ciclo, _variant: varA, _qty: qtd });
    await rpc(tokenMaster, "kit_conferir", { _cycle: ciclo });
    await rpc(tokenMaster, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
    return ciclo;
  }

  it(
    "8. conferência que deixa peças sem classificação é recusada",
    async () => {
      const ciclo = await maletaPronta(10);
      const r = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [{ variant_id: varA, qty_accepted: 5, qty_divergent: 0 }],
        _idempotency_key: `iso-parcial-${ciclo}`,
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(r.body)).toMatch(/somando 10/i);

      const ciclos = await admin(`/kit_cycles?select=status&id=eq.${ciclo}`);
      expect((ciclos.body as { status: string }[])[0]!.status).toBe("transito");
    },
    T,
  );

  it(
    "9. conferência vazia, quantidade negativa, acima do enviado e peça repetida são recusadas",
    async () => {
      const ciclo = await maletaPronta(3);
      const vazio = await rpc(tokenA, "kit_aceitar", { _cycle: ciclo, _itens: [] });
      expect(vazio.status).toBeGreaterThanOrEqual(400);

      const negativo = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [{ variant_id: varA, qty_accepted: 4, qty_divergent: -1 }],
      });
      expect(negativo.status).toBeGreaterThanOrEqual(400);

      const acima = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [{ variant_id: varA, qty_accepted: 5, qty_divergent: 0 }],
      });
      expect(acima.status).toBeGreaterThanOrEqual(400);

      const repetida = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [
          { variant_id: varA, qty_accepted: 3, qty_divergent: 0 },
          { variant_id: varA, qty_accepted: 0, qty_divergent: 3 },
        ],
      });
      expect(repetida.status).toBeGreaterThanOrEqual(400);

      const forasteira = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [{ variant_id: varEscasso, qty_accepted: 3, qty_divergent: 0 }],
      });
      expect(forasteira.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "10. divergência exige tipo (faltante ou defeito) e justificativa",
    async () => {
      const ciclo = await maletaPronta(4);
      const semTipo = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [{ variant_id: varA, qty_accepted: 3, qty_divergent: 1, motivo: "faltou" }],
      });
      expect(semTipo.status).toBeGreaterThanOrEqual(400);

      const semMotivo = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [
          { variant_id: varA, qty_accepted: 3, qty_divergent: 1, tipo_divergencia: "defeito" },
        ],
      });
      expect(semMotivo.status).toBeGreaterThanOrEqual(400);

      const ok = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [
          {
            variant_id: varA,
            qty_accepted: 3,
            qty_divergent: 1,
            tipo_divergencia: "defeito",
            motivo: "peça riscada",
          },
        ],
        _idempotency_key: `iso-ok-${ciclo}`,
      });
      expect(ok.status).toBe(200);
      expect((ok.body as { tipo: string }).tipo).toBe("parcial");

      const itens = await admin(
        `/kit_acceptance_items?select=divergence_kind,qty_accepted,qty_divergent&acceptance_id=eq.${
          (ok.body as { acceptance_id: string }).acceptance_id
        }`,
      );
      const item = (itens.body as { divergence_kind: string; qty_accepted: number }[])[0]!;
      expect(item.divergence_kind).toBe("defeito");
      expect(item.qty_accepted).toBe(3);
    },
    T,
  );

  it(
    "11. mesma chave com conteúdo diferente é recusada; conteúdo igual não duplica",
    async () => {
      const ciclo = await maletaPronta(2);
      const chave = `iso-chave-${ciclo}`;
      const primeiro = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [{ variant_id: varA, qty_accepted: 2, qty_divergent: 0 }],
        _idempotency_key: chave,
      });
      expect(primeiro.status).toBe(200);

      const igual = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [{ variant_id: varA, qty_accepted: 2, qty_divergent: 0 }],
        _idempotency_key: chave,
      });
      expect((igual.body as { repetida?: boolean }).repetida).toBe(true);

      const diferente = await rpc(tokenA, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [
          {
            variant_id: varA,
            qty_accepted: 1,
            qty_divergent: 1,
            tipo_divergencia: "faltante",
            motivo: "não veio",
          },
        ],
        _idempotency_key: chave,
      });
      expect(diferente.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(diferente.body)).toMatch(/outro conteúdo/i);

      const aceites = await admin(`/kit_acceptances?select=id&cycle_id=eq.${ciclo}`);
      expect((aceites.body as unknown[]).length).toBe(1);
    },
    T,
  );
});

describe("Maletas — estoque, concorrência e escala", () => {
  it(
    "12. duas montagens disputando as últimas unidades não reservam além do disponível",
    async () => {
      const c1 = await rpc(tokenMaster, "kit_cycle_create", {
        _payload: { origin_location_id: deposito, consultora_party_id: partyA },
      });
      const c2 = await rpc(tokenMaster, "kit_cycle_create", {
        _payload: { origin_location_id: deposito, consultora_party_id: partyB },
      });
      const ciclo1 = (c1.body as { cycle_id: string }).cycle_id;
      const ciclo2 = (c2.body as { cycle_id: string }).cycle_id;

      await rpc(tokenMaster, "kit_item_upsert", { _cycle: ciclo1, _variant: varEscasso, _qty: 2 });
      await rpc(tokenMaster, "kit_item_upsert", { _cycle: ciclo2, _variant: varEscasso, _qty: 2 });

      const [r1, r2] = await Promise.all([
        rpc(tokenMaster, "kit_conferir", { _cycle: ciclo1 }),
        rpc(tokenMaster, "kit_conferir", { _cycle: ciclo2 }),
      ]);
      const ok = [r1, r2].filter((r) => r.status === 200).length;
      expect(ok).toBe(1);

      const b = await admin(
        `/stock_balances?select=quantity,reserved&variant_id=eq.${varEscasso}&location_id=eq.${deposito}`,
      );
      const linha = (b.body as { quantity: number; reserved: number }[])[0]!;
      expect(linha.reserved).toBeLessThanOrEqual(linha.quantity);
      expect(linha.reserved).toBe(2);
    },
    T,
  );

  it(
    "13. posição física do depósito/maleta bate com o saldo do ciclo",
    async () => {
      const c = await rpc(tokenMaster, "kit_cycle_create", {
        _payload: { origin_location_id: deposito, consultora_party_id: partyA },
      });
      const ciclo = (c.body as { cycle_id: string }).cycle_id;
      await rpc(tokenMaster, "kit_item_upsert", { _cycle: ciclo, _variant: varA, _qty: 3 });
      await rpc(tokenMaster, "kit_conferir", { _cycle: ciclo });
      await rpc(tokenMaster, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });

      const kit = await admin(`/kit_cycles?select=kit_id,current_location_id&id=eq.${ciclo}`);
      const loc = (kit.body as { current_location_id: string }[])[0]!.current_location_id;
      const fisico = await admin(
        `/stock_balances?select=quantity&variant_id=eq.${varA}&location_id=eq.${loc}`,
      );
      const ciclos = await admin(
        `/kit_balances?select=qty_allocated&cycle_id=eq.${ciclo}&variant_id=eq.${varA}`,
      );
      expect((fisico.body as { quantity: number }[])[0]!.quantity).toBe(
        (ciclos.body as { qty_allocated: number }[])[0]!.qty_allocated,
      );
    },
    T,
  );

  it(
    "14. depósito de origem é obrigatório quando há mais de um ativo",
    async () => {
      const r = await rpc(tokenMaster, "kit_cycle_create", {
        _payload: { consultora_party_id: partyA },
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(r.body)).toMatch(/depósito de origem/i);
    },
    T,
  );

  it(
    "15. busca de pessoas vai ao servidor e passa dos 30 primeiros registros",
    async () => {
      const pagina1 = await rpc(tokenMaster, "list_parties", { _limit: 30, _offset: 0, _role: "consultora" });
      const linhas1 = pagina1.body as { id: string; total: number }[];
      expect(pagina1.status).toBe(200);
      expect(linhas1.length).toBeLessThanOrEqual(30);
      const total = Number(linhas1[0]?.total ?? 0);
      expect(total).toBeGreaterThan(30);

      const pagina2 = await rpc(tokenMaster, "list_parties", { _limit: 30, _offset: 30, _role: "consultora" });
      const linhas2 = pagina2.body as { id: string }[];
      expect(linhas2.length).toBeGreaterThan(0);
      expect(linhas2[0]!.id).not.toBe(linhas1[0]!.id);

      // termo enviado ao banco encontra alguém fora da primeira página
      const alvo = linhas2[linhas2.length - 1]!.id;
      const nome = await admin(`/parties?select=display_name&id=eq.${alvo}`);
      const termo = (nome.body as { display_name: string }[])[0]!.display_name.split(" ")[0]!;
      const busca = await rpc(tokenMaster, "list_parties", {
        _limit: 40,
        _offset: 0,
        _role: "consultora",
        _search: termo,
      });
      expect((busca.body as unknown[]).length).toBeGreaterThan(0);
    },
    T,
  );
});

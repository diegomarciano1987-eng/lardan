/**
 * Homologação do histórico de movimentações da maleta.
 *
 * Cenário obrigatório: remessa inicial de 50, acréscimo de 5, retorno de 20.
 * As 35 restantes precisam continuar aparecendo como "a explicar" — nunca
 * como venda nem como dívida.
 *
 * Tudo é sintético (prefixo HOMOLOG) e a limpeza só apaga o que esta
 * execução criou. Nenhum produto publicado, consultora real ou saldo de
 * produção é tocado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConta, limpar, rpc, TEST_PREFIX } from "../security/harness";

const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
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

type Linha = {
  variant_id: string;
  enviado: number;
  acrescido: number;
  saiu: number;
  retornado: number;
  retorno_em_transito: number;
  garantia: number;
  perda: number;
  mantida: number;
  vendido: number;
  sob_responsabilidade: number;
  a_explicar: number;
};
type Conciliacao = {
  linhas: Linha[];
  totais: { saiu: number; retornado: number; a_explicar: number; perda: number; mantida: number };
  vendas_disponiveis: boolean;
};

const marca = Date.now();
let tokenMaster: string | null = null;
let tokenConsultora: string | null = null;
let tokenOutra: string | null = null;
let partyConsultora = "";
let deposito = "";
let variante = "";
let ciclo = "";
let acrescimoId = "";

async function saldoDeposito() {
  const r = await admin(`/stock_balances?select=quantity&variant_id=eq.${variante}&location_id=eq.${deposito}`);
  return (r.body as { quantity: number }[])[0]?.quantity ?? 0;
}

async function conciliar(token: string | null = tokenMaster) {
  const r = await rpc(token, "kit_conciliacao", { _cycle: ciclo });
  return { status: r.status, dados: r.body as Conciliacao };
}

beforeAll(async () => {
  tokenMaster = (await criarConta({ nome: "mov-master", papeis: ["master"] })).token;
  const c = await criarConta({ nome: "mov-consultora", papeis: ["consultora"], comParty: true });
  const o = await criarConta({ nome: "mov-outra", papeis: ["consultora"], comParty: true });
  tokenConsultora = c.token;
  tokenOutra = o.token;
  partyConsultora = c.partyId!;

  const dep = await admin(`/locations`, {
    method: "POST",
    body: JSON.stringify({
      code: `HOMOLOG-MOV-${marca}`,
      name: `${TEST_PREFIX} Depósito mov ${marca}`,
      kind: "deposito",
      is_active: true,
    }),
  });
  deposito = (dep.body as { id: string }[])[0]!.id;

  const prod = await admin(`/products`, {
    method: "POST",
    body: JSON.stringify({ name: `${TEST_PREFIX} Peça mov ${marca}`, slug: `homolog-mov-${marca}` }),
  });
  const produto = (prod.body as { id: string }[])[0]!.id;

  const v = await admin(`/product_variants`, {
    method: "POST",
    body: JSON.stringify({
      product_id: produto,
      sku: `HOM-MOV-${marca}`,
      label: "U",
      price_cents: 9900,
      is_active: true,
    }),
  });
  variante = (v.body as { id: string }[])[0]!.id;

  await admin(`/stock_balances?on_conflict=variant_id,location_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ variant_id: variante, location_id: deposito, quantity: 200, reserved: 0 }),
  });

  const cc = await rpc(tokenMaster, "kit_cycle_create", {
    _payload: { origin_location_id: deposito, consultora_party_id: partyConsultora },
  });
  ciclo = (cc.body as { cycle_id: string }).cycle_id;
}, T);

afterAll(async () => {
  await admin(`/kit_balances?variant_id=eq.${variante}`, { method: "DELETE" });
  await limpar();
}, T);

describe("Maletas — remessa inicial de 50", () => {
  it(
    "1. expedição registra remessa inicial no histórico e dá baixa no depósito",
    async () => {
      const antes = await saldoDeposito();
      await rpc(tokenMaster, "kit_item_upsert", { _cycle: ciclo, _variant: variante, _qty: 50 });
      await rpc(tokenMaster, "kit_conferir", { _cycle: ciclo });
      const exp = await rpc(tokenMaster, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
      expect(exp.status).toBe(200);

      const depois = await saldoDeposito();
      expect(antes - depois).toBe(50);

      const h = await rpc(tokenMaster, "kit_historico", { _cycle: ciclo });
      const movs = (h.body as { movimentos: { tipo: string; situacao: string; itens: { quantidade: number }[] }[] })
        .movimentos;
      const remessa = movs.find((m) => m.tipo === "remessa_inicial")!;
      expect(remessa).toBeTruthy();
      expect(remessa.situacao).toBe("confirmado");
      expect(remessa.itens.reduce((s, i) => s + i.quantidade, 0)).toBe(50);
    },
    T,
  );

  it(
    "2. consultora confirma o recebimento, aceita as 50 e a conferência mostra 50 sob responsabilidade",
    async () => {
      const t = await admin(`/kit_transfers?select=id&cycle_id=eq.${ciclo}&order=seq.asc`);
      const transfer = (t.body as { id: string }[])[0]!.id;
      const conf = await rpc(tokenConsultora, "kit_transfer_confirm", { _transfer: transfer });
      expect(conf.status).toBe(200);

      const aceite = await rpc(tokenConsultora, "kit_aceitar", {
        _cycle: ciclo,
        _itens: [{ variant_id: variante, qty_accepted: 50, qty_divergent: 0 }],
        _idempotency_key: `mov-aceite-${marca}`,
      });
      expect(aceite.status).toBe(200);

      const { dados } = await conciliar();
      expect(dados.totais.saiu).toBe(50);
      expect(dados.totais.a_explicar).toBe(50);
      expect(dados.vendas_disponiveis).toBe(false);
    },
    T,
  );
});


describe("Maletas — acréscimo de 5 peças", () => {
  it(
    "3. acréscimo dá baixa na origem e as peças ficam a caminho até a confirmação",
    async () => {
      const antes = await saldoDeposito();
      const r = await rpc(tokenMaster, "kit_acrescimo", {
        _cycle: ciclo,
        _payload: {
          origem_location_id: deposito,
          itens: [{ variant_id: variante, quantity: 5 }],
          idempotency_key: `mov-acr-${marca}`,
        },
      });
      expect(r.status).toBe(200);
      acrescimoId = (r.body as { movement_id: string }).movement_id;

      const depois = await saldoDeposito();
      expect(antes - depois).toBe(5);

      // ainda não confirmado: não entra no que saiu
      const { dados } = await conciliar();
      expect(dados.totais.saiu).toBe(50);

      const b = await admin(`/kit_balances?select=qty_incoming&cycle_id=eq.${ciclo}&variant_id=eq.${variante}`);
      expect((b.body as { qty_incoming: number }[])[0]!.qty_incoming).toBe(5);
    },
    T,
  );

  it(
    "4. repetir o acréscimo com a mesma chave não duplica peças",
    async () => {
      const antes = await saldoDeposito();
      const r = await rpc(tokenMaster, "kit_acrescimo", {
        _cycle: ciclo,
        _payload: {
          origem_location_id: deposito,
          itens: [{ variant_id: variante, quantity: 5 }],
          idempotency_key: `mov-acr-${marca}`,
        },
      });
      expect(r.status).toBe(200);
      expect((r.body as { repetida?: boolean }).repetida).toBe(true);
      expect(await saldoDeposito()).toBe(antes);
    },
    T,
  );

  it(
    "5. mesma chave com conteúdo diferente é recusada",
    async () => {
      const r = await rpc(tokenMaster, "kit_acrescimo", {
        _cycle: ciclo,
        _payload: {
          origem_location_id: deposito,
          itens: [{ variant_id: variante, quantity: 9 }],
          idempotency_key: `mov-acr-${marca}`,
        },
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "6. confirmado o recebimento, o total que saiu passa a 55",
    async () => {
      const ok = await rpc(tokenConsultora, "kit_acrescimo_confirmar", { _movement: acrescimoId });
      expect(ok.status).toBe(200);
      const repetida = await rpc(tokenConsultora, "kit_acrescimo_confirmar", { _movement: acrescimoId });
      expect((repetida.body as { repetida?: boolean }).repetida).toBe(true);

      const { dados } = await conciliar();
      expect(dados.totais.saiu).toBe(55);
      expect(dados.linhas[0]!.acrescido).toBe(5);
      expect(dados.linhas[0]!.enviado).toBe(50);
      expect(dados.totais.a_explicar).toBe(55);
    },
    T,
  );

  it(
    "7. consultora não envia acréscimo para si mesma e outra consultora não confirma o meu",
    async () => {
      const tentativa = await rpc(tokenConsultora, "kit_acrescimo", {
        _cycle: ciclo,
        _payload: { origem_location_id: deposito, itens: [{ variant_id: variante, quantity: 1 }] },
      });
      expect(tentativa.status).toBeGreaterThanOrEqual(400);

      const outro = await rpc(tokenMaster, "kit_acrescimo", {
        _cycle: ciclo,
        _payload: {
          origem_location_id: deposito,
          itens: [{ variant_id: variante, quantity: 1 }],
          idempotency_key: `mov-acr-outra-${marca}`,
        },
      });
      const movimento = (outro.body as { movement_id: string }).movement_id;
      const invasao = await rpc(tokenOutra, "kit_acrescimo_confirmar", { _movement: movimento });
      expect(invasao.status).toBeGreaterThanOrEqual(400);
      // devolve a peça ao fluxo confirmando pelo caminho certo
      await rpc(tokenConsultora, "kit_acrescimo_confirmar", { _movement: movimento });
    },
    T,
  );
});

describe("Maletas — retorno de 20 peças", () => {
  it(
    "8. retorno fica em trânsito e só baixa no depósito depois da conferência na Matriz",
    async () => {
      const antes = await saldoDeposito();
      const r = await rpc(tokenConsultora, "kit_retorno", {
        _cycle: ciclo,
        _payload: {
          itens: [{ variant_id: variante, quantity: 20, destino: "retorno" }],
          idempotency_key: `mov-ret-${marca}`,
        },
      });
      expect(r.status).toBe(200);
      const movimento = (r.body as { movement_id: string }).movement_id;
      expect(await saldoDeposito()).toBe(antes);

      const emTransito = await conciliar();
      expect(emTransito.dados.totais.retorno_em_transito ?? emTransito.dados.linhas[0]!.retorno_em_transito).toBe(20);

      const conf = await rpc(tokenMaster, "kit_retorno_confirmar", {
        _movement: movimento,
        _payload: { destino_location_id: deposito },
      });
      expect(conf.status).toBe(200);
      expect(await saldoDeposito()).toBe(antes + 20);

      const repetida = await rpc(tokenMaster, "kit_retorno_confirmar", { _movement: movimento });
      expect((repetida.body as { repetida?: boolean }).repetida).toBe(true);
      expect(await saldoDeposito()).toBe(antes + 20);
    },
    T,
  );

  it(
    "9. consultora não confirma o próprio retorno na Matriz",
    async () => {
      const r = await rpc(tokenConsultora, "kit_retorno", {
        _cycle: ciclo,
        _payload: { itens: [{ variant_id: variante, quantity: 1, destino: "retorno" }] },
      });
      const movimento = (r.body as { movement_id: string }).movement_id;
      const invasao = await rpc(tokenConsultora, "kit_retorno_confirmar", { _movement: movimento });
      expect(invasao.status).toBeGreaterThanOrEqual(400);
      // devolve o cenário ao ponto anterior confirmando pelo caminho autorizado
      await rpc(tokenMaster, "kit_retorno_confirmar", {
        _movement: movimento,
        _payload: { destino_location_id: deposito },
      });
    },
    T,
  );

  it(
    "10. não é possível devolver mais do que está sob responsabilidade",
    async () => {
      const r = await rpc(tokenConsultora, "kit_retorno", {
        _cycle: ciclo,
        _payload: { itens: [{ variant_id: variante, quantity: 9999, destino: "retorno" }] },
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "11. perda exige motivo e sai do estoque da maleta; peça mantida não vira retorno",
    async () => {
      const semMotivo = await rpc(tokenConsultora, "kit_retorno", {
        _cycle: ciclo,
        _payload: { itens: [{ variant_id: variante, quantity: 1, destino: "perda" }] },
      });
      expect(semMotivo.status).toBeGreaterThanOrEqual(400);

      const comMotivo = await rpc(tokenConsultora, "kit_retorno", {
        _cycle: ciclo,
        _payload: {
          itens: [
            { variant_id: variante, quantity: 1, destino: "perda", reason: "Peça danificada no transporte" },
            { variant_id: variante, quantity: 2, destino: "mantida" },
          ],
        },
      });
      expect(comMotivo.status).toBe(200);
      const movPerda = (comMotivo.body as { movement_id: string }).movement_id;

      // a baixa física da perda só acontece na confirmação pela Matriz
      const conf = await rpc(tokenMaster, "kit_retorno_confirmar", { _movement: movPerda });
      expect(conf.status).toBe(200);
      expect((conf.body as { perdas: number }).perdas).toBe(1);

      const { dados } = await conciliar();
      expect(dados.totais.perda).toBe(1);
      expect(dados.totais.mantida).toBe(2);

    },
    T,
  );
});

describe("Maletas — conferência 50 + 5 − 20", () => {
  it(
    "12. as unidades restantes aparecem como a explicar, sem virar venda nem dívida",
    async () => {
      const { dados } = await conciliar();
      const l = dados.linhas[0]!;
      // 50 enviadas + 5 acrescidas + 1 do teste 7 = 56; 20 + 1 devolvidas; 1 perda; 2 mantidas
      expect(l.saiu).toBe(l.enviado + l.acrescido);
      expect(l.vendido).toBe(0);
      expect(l.a_explicar).toBe(
        l.saiu - l.retornado - l.retorno_em_transito - l.garantia - l.perda - l.mantida - l.vendido,
      );
      expect(l.a_explicar).toBeGreaterThan(0);
      expect(dados.vendas_disponiveis).toBe(false);
    },
    T,
  );

  it(
    "13. cada peça é contada em uma única categoria",
    async () => {
      const { dados } = await conciliar();
      const l = dados.linhas[0]!;
      const destinos = l.retornado + l.retorno_em_transito + l.garantia + l.perda + l.mantida + l.vendido;
      expect(destinos + l.a_explicar).toBe(l.saiu);
    },
    T,
  );

  it(
    "14. histórico preserva remessa, acréscimo e retorno separados, sem sobrescrever a composição expedida",
    async () => {
      const h = await rpc(tokenMaster, "kit_historico", { _cycle: ciclo });
      const movs = (h.body as { movimentos: { tipo: string }[] }).movimentos;
      expect(movs.filter((m) => m.tipo === "remessa_inicial").length).toBe(1);
      expect(movs.filter((m) => m.tipo === "acrescimo").length).toBeGreaterThanOrEqual(2);
      expect(movs.filter((m) => m.tipo === "retorno").length).toBeGreaterThanOrEqual(3);

      // a composição originalmente expedida continua com as 50 peças
      const comps = await admin(`/kit_compositions?select=id&cycle_id=eq.${ciclo}`);
      const ids = (comps.body as { id: string }[]).map((x) => x.id).join(",");
      const comp = await admin(`/kit_composition_items?select=quantity&composition_id=in.(${ids})`);
      const totalComposicao = (comp.body as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0);
      expect(totalComposicao).toBe(50);

    },
    T,
  );

  it(
    "15. outra consultora não enxerga o histórico nem a conferência desta maleta",
    async () => {
      const h = await rpc(tokenOutra, "kit_historico", { _cycle: ciclo });
      expect(h.status).toBeGreaterThanOrEqual(400);
      const c = await rpc(tokenOutra, "kit_conciliacao", { _cycle: ciclo });
      expect(c.status).toBeGreaterThanOrEqual(400);
      const visitante = await rpc(null, "kit_conciliacao", { _cycle: ciclo });
      expect(visitante.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );
});

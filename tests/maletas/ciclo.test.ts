/**
 * Homologação do núcleo comercial — ciclo da maleta.
 *
 * Cobre montagem, conferência, expedição (rota direta e via representante),
 * cadeia de custódia, aceite integral/parcial/repetido e escopo de acesso.
 *
 * Tudo é sintético (prefixo HOMOLOG): produto, variantes, depósito e contas.
 * Nenhum produto publicado, foto ou saldo real é tocado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConta, criarPartySintetica, limpar, rpc, TEST_PREFIX } from "../security/harness";

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

const marca = Date.now();
let tokenMaster: string | null = null;
let tokenConsultora: string | null = null;
let tokenOutra: string | null = null;
let tokenRep: string | null = null;
let consultoraParty = "";
let outraParty = "";
let repParty = "";
let deposito = "";
let produto = "";
let varA = "";
let varB = "";

async function saldo(variant: string, quantidade: number) {
  await admin(`/stock_balances?on_conflict=variant_id,location_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ variant_id: variant, location_id: deposito, quantity: quantidade, reserved: 0 }),
  });
}

beforeAll(async () => {
  const master = await criarConta({ nome: "maleta-master", papeis: ["master"] });
  tokenMaster = master.token;

  const consultora = await criarConta({
    nome: "maleta-consultora",
    papeis: ["consultora"],
    comParty: true,
  });
  tokenConsultora = consultora.token;
  consultoraParty = consultora.partyId!;

  const outra = await criarConta({
    nome: "maleta-consultora2",
    papeis: ["consultora"],
    comParty: true,
  });
  tokenOutra = outra.token;
  outraParty = outra.partyId!;

  const rep = await criarConta({
    nome: "maleta-representante",
    papeis: ["representante"],
    comParty: true,
  });
  tokenRep = rep.token;
  repParty = rep.partyId!;

  // depósito sintético exclusivo desta bateria
  const dep = await admin(`/locations`, {
    method: "POST",
    body: JSON.stringify({
      code: `HOMOLOG-DEP-${marca}`,
      name: `${TEST_PREFIX} Depósito ${marca}`,
      kind: "deposito",
      is_active: true,
    }),
  });
  deposito = (dep.body as { id: string }[])[0]!.id;

  // produto + variantes sintéticos (nunca publicados)
  const prod = await admin(`/products`, {
    method: "POST",
    body: JSON.stringify({
      name: `${TEST_PREFIX} Peça maleta ${marca}`,
      slug: `homolog-maleta-${marca}`,
    }),
  });
  produto = (prod.body as { id: string }[])[0]!.id;

  const vars = await admin(`/product_variants`, {
    method: "POST",
    body: JSON.stringify([
      { product_id: produto, sku: `HOM-MAL-${marca}-A`, label: "A", price_cents: 10000, is_active: true },
      { product_id: produto, sku: `HOM-MAL-${marca}-B`, label: "B", price_cents: 20000, is_active: true },
    ]),
  });
  const criadas = (vars.body as { id: string; sku: string }[]).sort((a, b) =>
    a.sku.localeCompare(b.sku),
  );
  varA = criadas[0]!.id;
  varB = criadas[1]!.id;

  await saldo(varA, 10);
  await saldo(varB, 4);
}, T);

afterAll(async () => {
  // remove apenas o cenário sintético; movimentos são imutáveis e permanecem
  await admin(`/kit_balances?variant_id=in.(${varA},${varB})`, { method: "DELETE" });
  await limpar();
}, T);

async function novoCiclo(extra: Record<string, unknown> = {}) {
  const r = await rpc(tokenMaster, "kit_cycle_create", {
    _payload: { origin_location_id: deposito, consultora_party_id: consultoraParty, ...extra },
  });
  expect(r.status).toBe(200);
  return r.body as { cycle_id: string; code: string; qr_token: string };
}

describe("Maleta — ciclo operacional", () => {
  it(
    "1. montagem recusa quantidade acima do disponível",
    async () => {
      const c = await novoCiclo();
      const r = await rpc(tokenMaster, "kit_item_upsert", {
        _cycle: c.cycle_id,
        _variant: varB,
        _qty: 99,
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(r.body)).toMatch(/Disponível/i);
    },
    T,
  );

  it(
    "2. conferência reserva o estoque e congela a composição",
    async () => {
      const c = await novoCiclo();
      await rpc(tokenMaster, "kit_item_upsert", { _cycle: c.cycle_id, _variant: varA, _qty: 3 });
      const conf = await rpc(tokenMaster, "kit_conferir", { _cycle: c.cycle_id });
      expect(conf.status).toBe(200);
      expect((conf.body as { situacao: string }).situacao).toBe("conferida");

      const b = await admin(
        `/stock_balances?select=quantity,reserved&variant_id=eq.${varA}&location_id=eq.${deposito}`,
      );
      expect((b.body as { reserved: number }[])[0]!.reserved).toBeGreaterThanOrEqual(3);

      // composição não pode mais mudar por este caminho
      const alterar = await rpc(tokenMaster, "kit_item_upsert", {
        _cycle: c.cycle_id,
        _variant: varA,
        _qty: 5,
      });
      expect(alterar.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "3. expedição direta move o estoque para a maleta e não duplica se repetida",
    async () => {
      const c = await novoCiclo();
      await rpc(tokenMaster, "kit_item_upsert", { _cycle: c.cycle_id, _variant: varA, _qty: 2 });
      await rpc(tokenMaster, "kit_conferir", { _cycle: c.cycle_id });

      const e1 = await rpc(tokenMaster, "kit_expedir", { _cycle: c.cycle_id, _payload: { rota: "direta" } });
      expect(e1.status).toBe(200);
      expect((e1.body as { rota: string }).rota).toBe("direta");

      const e2 = await rpc(tokenMaster, "kit_expedir", { _cycle: c.cycle_id, _payload: { rota: "direta" } });
      expect((e2.body as { repetida?: boolean }).repetida).toBe(true);

      const loc = await admin(`/locations?select=id&code=eq.${c.code}`);
      const maletaLoc = (loc.body as { id: string }[])[0]!.id;
      const saldoMaleta = await admin(
        `/stock_balances?select=quantity&variant_id=eq.${varA}&location_id=eq.${maletaLoc}`,
      );
      expect((saldoMaleta.body as { quantity: number }[])[0]!.quantity).toBe(2);
    },
    T,
  );

  it(
    "4. entrega pelo representante mantém a cadeia de custódia",
    async () => {
      const c = await novoCiclo({ representante_party_id: repParty });
      await rpc(tokenMaster, "kit_item_upsert", { _cycle: c.cycle_id, _variant: varA, _qty: 1 });
      await rpc(tokenMaster, "kit_conferir", { _cycle: c.cycle_id });
      const exp = await rpc(tokenMaster, "kit_expedir", {
        _cycle: c.cycle_id,
        _payload: { rota: "representante", carrier: "Transportadora HOMOLOG" },
      });
      const transfer = (exp.body as { transfer_id: string }).transfer_id;

      // consultora ainda não pode aceitar: a maleta está com o representante
      const cedo = await rpc(tokenConsultora, "kit_aceitar", { _cycle: c.cycle_id, _itens: [] });
      expect(cedo.status).toBeGreaterThanOrEqual(400);

      const rec = await rpc(tokenRep, "kit_transfer_confirm", { _transfer: transfer, _payload: {} });
      expect(rec.status).toBe(200);

      const fwd = await rpc(tokenRep, "kit_transfer_forward", { _cycle: c.cycle_id, _payload: {} });
      expect(fwd.status).toBe(200);
      const t2 = (fwd.body as { transfer_id: string }).transfer_id;

      const rec2 = await rpc(tokenConsultora, "kit_transfer_confirm", { _transfer: t2, _payload: {} });
      expect(rec2.status).toBe(200);

      const ciclo = await admin(`/kit_cycles?select=status,custodian_party_id&id=eq.${c.cycle_id}`);
      const row = (ciclo.body as { status: string; custodian_party_id: string }[])[0]!;
      expect(row.status).toBe("recebida");
      expect(row.custodian_party_id).toBe(consultoraParty);

      const cadeia = await admin(`/kit_transfers?select=seq,status&cycle_id=eq.${c.cycle_id}&order=seq`);
      expect((cadeia.body as unknown[]).length).toBe(2);
    },
    T,
  );

  it(
    "5. aceite parcial libera só o que foi aceito e o aceite repetido não duplica",
    async () => {
      const c = await novoCiclo();
      await rpc(tokenMaster, "kit_item_upsert", { _cycle: c.cycle_id, _variant: varA, _qty: 3 });
      await rpc(tokenMaster, "kit_conferir", { _cycle: c.cycle_id });
      await rpc(tokenMaster, "kit_expedir", { _cycle: c.cycle_id, _payload: { rota: "direta" } });

      const aceite = await rpc(tokenConsultora, "kit_aceitar", {
        _cycle: c.cycle_id,
        _itens: [{ variant_id: varA, qty_accepted: 2, qty_divergent: 1, motivo: "faltou 1 peça" }],
        _idempotency_key: `homolog-aceite-${c.cycle_id}`,
      });
      expect(aceite.status).toBe(200);
      expect((aceite.body as { tipo: string }).tipo).toBe("parcial");

      const bal = await admin(
        `/kit_balances?select=qty_allocated,qty_accepted,qty_divergent,qty_available&cycle_id=eq.${c.cycle_id}`,
      );
      const b = (bal.body as { qty_allocated: number; qty_accepted: number; qty_divergent: number; qty_available: number }[])[0]!;
      expect(b.qty_allocated).toBe(3);
      expect(b.qty_accepted).toBe(2);
      expect(b.qty_divergent).toBe(1);
      expect(b.qty_available).toBe(2);

      const repetido = await rpc(tokenConsultora, "kit_aceitar", {
        _cycle: c.cycle_id,
        _itens: [{ variant_id: varA, qty_accepted: 2, qty_divergent: 1 }],
        _idempotency_key: `homolog-aceite-${c.cycle_id}`,
      });
      expect((repetido.body as { repetida?: boolean }).repetida).toBe(true);

      const bal2 = await admin(`/kit_balances?select=qty_accepted&cycle_id=eq.${c.cycle_id}`);
      expect((bal2.body as { qty_accepted: number }[])[0]!.qty_accepted).toBe(2);

      // novo aceite com outra chave também não pode reabrir o ciclo
      const outroAceite = await rpc(tokenConsultora, "kit_aceitar", {
        _cycle: c.cycle_id,
        _itens: [],
        _idempotency_key: `homolog-aceite-2-${c.cycle_id}`,
      });
      expect(outroAceite.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "6. consultora não enxerga nem aceita maleta de outra consultora",
    async () => {
      const c = await novoCiclo();
      await rpc(tokenMaster, "kit_item_upsert", { _cycle: c.cycle_id, _variant: varA, _qty: 1 });
      await rpc(tokenMaster, "kit_conferir", { _cycle: c.cycle_id });
      await rpc(tokenMaster, "kit_expedir", { _cycle: c.cycle_id, _payload: { rota: "direta" } });

      const tentativa = await rpc(tokenOutra, "kit_aceitar", { _cycle: c.cycle_id, _itens: [] });
      expect(tentativa.status).toBeGreaterThanOrEqual(400);

      const leitura = await fetch(`${URL}/rest/v1/kit_cycles?select=id&id=eq.${c.cycle_id}`, {
        headers: {
          apikey: process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!,
          Authorization: `Bearer ${tokenOutra}`,
        },
      });
      expect(await leitura.json()).toEqual([]);
      expect(outraParty).not.toBe(consultoraParty);
    },
    T,
  );
});

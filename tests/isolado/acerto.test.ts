/**
 * Bateria ISOLADA — acerto comercial da maleta e evidência de venda.
 *
 * Tudo é sintético e local. Nenhuma linha vem da base compartilhada, nenhuma
 * API é chamada e nenhuma regra comercial é inventada: o acerto é conferência
 * física e para antes de dívida, título, nota e cobrança.
 *
 *   bash tests/isolado/subir.sh && bun test tests/isolado
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { adm, Conta, criarConta, criarDeposito, criarVariante, porEstoque, rpc } from "./base";

let matriz: Conta, rep: Conta, cons: Conta, outra: Conta;
let dep = "";
let variante = "";
let ciclo = "";
let acerto = "";
let evidencia = "";

const execucao = Date.now().toString(36);
const chave = (s: string) => `acerto-${execucao}-${s}`;

async function primeiraTransferencia(c: string) {
  const r = (await adm.unsafe(`select id from public.kit_transfers where cycle_id = $1 order by seq asc limit 1`, [
    c,
  ])) as { id: string }[];
  return r[0]!.id;
}

beforeAll(async () => {
  matriz = await criarConta({ nome: "acerto-matriz", papeis: ["master"] });
  rep = await criarConta({ nome: "acerto-rep", papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: "acerto-cons", papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: "acerto-outra", papeis: ["consultora"], comParty: true });

  dep = await criarDeposito("acerto");
  await adm.unsafe(`update public.locations set responsible_user_id = $1 where id = $2`, [rep.uid, dep]);
  variante = await criarVariante("acerto");
  await porEstoque(variante, dep, 500);

  const c = await rpc<{ cycle_id: string }>(matriz, "kit_cycle_create", {
    _payload: {
      origin_location_id: dep,
      consultora_party_id: cons.partyId,
      representante_party_id: rep.partyId,
    },
  });
  if (!c.ok) throw new Error(`ciclo: ${c.erro}`);
  ciclo = c.dados.cycle_id;

  await rpc(matriz, "kit_item_upsert", { _cycle: ciclo, _variant: variante, _qty: 50 });
  await rpc(matriz, "kit_conferir", { _cycle: ciclo, _note: null });
  await rpc(matriz, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
  await rpc(cons, "kit_transfer_confirm", { _transfer: await primeiraTransferencia(ciclo), _payload: {} });
  await rpc(cons, "kit_aceitar", {
    _cycle: ciclo,
    _itens: [{ variant_id: variante, qty_accepted: 50, qty_divergent: 0 }],
    _idempotency_key: chave("aceite"),
  });

  // acréscimo de 5 confirmado
  const acr = await rpc<{ movement_id: string }>(matriz, "kit_acrescimo", {
    _cycle: ciclo,
    _payload: {
      origem_location_id: dep,
      itens: [{ variant_id: variante, quantity: 5 }],
      idempotency_key: chave("acr"),
    },
  });
  await rpc(cons, "kit_acrescimo_confirmar", { _movement: acr.dados.movement_id, _payload: {} });

  // retorno de 20 conferido na Matriz
  const ret = await rpc<{ movement_id: string }>(cons, "kit_retorno", {
    _cycle: ciclo,
    _payload: {
      itens: [{ variant_id: variante, quantity: 20, destino: "retorno" }],
      idempotency_key: chave("ret"),
    },
  });
  const itens = (await adm.unsafe(`select id from public.kit_movement_items where movement_id = $1`, [
    ret.dados.movement_id,
  ])) as { id: string }[];
  await rpc(matriz, "kit_retorno_confirmar", {
    _movement: ret.dados.movement_id,
    _payload: {
      destino_location_id: dep,
      itens: [{ item_id: itens[0]!.id, qty_recebida: 20, qty_aprovada: 20, qty_divergente: 0 }],
    },
  });
});

describe("Evidência de venda", () => {
  it("1. venda da vitrine sem item de pedido é recusada — nada é ligado por nome, preço ou data", async () => {
    const r = await rpc(cons, "venda_evidencia_registrar", {
      _cycle: ciclo,
      _variant: variante,
      _quantity: 2,
      _sold_at: new Date().toISOString().slice(0, 10),
      _origem: "vitrine",
    });
    expect(r.ok).toBe(false);
    expect(String(r.erro)).toContain("item do pedido");
  });

  it("2. evidência registrada não move estoque, título, parcela nem liquidação", async () => {
    const antes = (await adm.unsafe(
      `select (select count(*) from public.stock_movements) m,
              (select count(*) from public.financial_titles) t,
              (select count(*) from public.financial_installments) p,
              (select count(*) from public.financial_settlements) l`,
    )) as { m: string; t: string; p: string; l: string }[];

    const r = await rpc<{ id: string; status: string }>(cons, "venda_evidencia_registrar", {
      _cycle: ciclo,
      _variant: variante,
      _quantity: 3,
      _sold_at: new Date().toISOString().slice(0, 10),
      _origem: "consultora",
      _unit_price_cents: 900,
      _idempotency_key: chave("ev-1"),
    });
    expect(r.ok).toBe(true);
    expect(r.dados.status).toBe("registrada");
    evidencia = r.dados.id;

    const depois = (await adm.unsafe(
      `select (select count(*) from public.stock_movements) m,
              (select count(*) from public.financial_titles) t,
              (select count(*) from public.financial_installments) p,
              (select count(*) from public.financial_settlements) l`,
    )) as { m: string; t: string; p: string; l: string }[];
    expect(depois[0]).toEqual(antes[0]!);
  });

  it("3. a mesma chave repete sem duplicar e recusa conteúdo diferente", async () => {
    const igual = await rpc<{ repetida: boolean; id: string }>(cons, "venda_evidencia_registrar", {
      _cycle: ciclo,
      _variant: variante,
      _quantity: 3,
      _sold_at: new Date().toISOString().slice(0, 10),
      _origem: "consultora",
      _unit_price_cents: 900,
      _idempotency_key: chave("ev-1"),
    });
    expect(igual.ok).toBe(true);
    expect(igual.dados.repetida).toBe(true);
    expect(igual.dados.id).toBe(evidencia);

    const diferente = await rpc(cons, "venda_evidencia_registrar", {
      _cycle: ciclo,
      _variant: variante,
      _quantity: 9,
      _sold_at: new Date().toISOString().slice(0, 10),
      _origem: "consultora",
      _unit_price_cents: 900,
      _idempotency_key: chave("ev-1"),
    });
    expect(diferente.ok).toBe(false);
  });

  it("4. erro é corrigido por compensação, sem apagar o passado", async () => {
    const r = await rpc<{ compensacao: string; status: string }>(cons, "venda_evidencia_compensar", {
      _evidence: evidencia,
      _motivo: "cliente desistiu",
      _kind: "cancelada",
    });
    expect(r.ok).toBe(true);
    expect(r.dados.status).toBe("cancelada");

    const linhas = (await adm.unsafe(
      `select count(*)::int n from public.sales_evidences where cycle_id = $1`,
      [ciclo],
    )) as { n: number }[];
    expect(linhas[0]!.n).toBe(2); // original preservada + compensação

    const ev = (await adm.unsafe(
      `select count(*)::int n from public.sales_evidence_events where evidence_id = $1`,
      [evidencia],
    )) as { n: number }[];
    expect(ev[0]!.n).toBeGreaterThan(1);
  });

  it("5. outra consultora não registra venda na maleta alheia", async () => {
    const r = await rpc(outra, "venda_evidencia_registrar", {
      _cycle: ciclo,
      _variant: variante,
      _quantity: 1,
      _sold_at: new Date().toISOString().slice(0, 10),
      _origem: "consultora",
    });
    expect(r.ok).toBe(false);
  });

  it("6. escrita direta na evidência é recusada pelo banco", async () => {
    let recusado = false;
    try {
      await adm.unsafe(`update public.sales_evidences set quantity = 99 where id = $1`, [evidencia]);
    } catch {
      recusado = true;
    }
    expect(recusado).toBe(true);
  });
});

describe("Acerto comercial", () => {
  it("7. o acerto nasce rascunho, com motivo do bloqueio declarado", async () => {
    const r = await rpc<{ id: string; status: string }>(matriz, "kit_acerto_abrir", {
      _cycle: ciclo,
      _idempotency_key: chave("ac-1"),
    });
    expect(r.ok).toBe(true);
    expect(r.dados.status).toBe("rascunho");
    acerto = r.dados.id;

    const a = (await adm.unsafe(`select blocked_reason from public.kit_acertos where id = $1`, [acerto])) as {
      blocked_reason: string;
    }[];
    expect(a[0]!.blocked_reason).toContain("pendente");
  });

  it("8. abrir de novo devolve o mesmo acerto, sem segunda revisão", async () => {
    const r = await rpc<{ id: string; repetida: boolean }>(matriz, "kit_acerto_abrir", {
      _cycle: ciclo,
      _idempotency_key: chave("ac-1"),
    });
    expect(r.ok).toBe(true);
    expect(r.dados.repetida).toBe(true);
    expect(r.dados.id).toBe(acerto);

    const n = (await adm.unsafe(`select count(*)::int n from public.kit_acertos where cycle_id = $1`, [ciclo])) as {
      n: number;
    }[];
    expect(n[0]!.n).toBe(1);
  });

  it("9. o acerto repete a conta física 50 + 5 − 20 = 35 sob responsabilidade", async () => {
    const i = (await adm.unsafe(
      `select qty_remessa_inicial, qty_acrescimo_recebido, qty_devolucao_aprovada, qty_sob_responsabilidade,
              qty_venda_comprovada
         from public.kit_acerto_items where acerto_id = $1`,
      [acerto],
    )) as Record<string, number>[];
    const l = i[0]!;
    expect(l["qty_remessa_inicial"]).toBe(50);
    expect(l["qty_acrescimo_recebido"]).toBe(5);
    expect(l["qty_devolucao_aprovada"]).toBe(20);
    expect(l["qty_sob_responsabilidade"]).toBe(35);
    // a única evidência foi compensada: nenhuma venda comprovada permanece
    expect(l["qty_venda_comprovada"]).toBe(0);
  });

  it("10. conferir não cria título, parcela, liquidação, nota nem cobrança", async () => {
    const antes = (await adm.unsafe(
      `select (select count(*) from public.financial_titles) t,
              (select count(*) from public.financial_installments) p,
              (select count(*) from public.financial_settlements) l,
              (select count(*) from public.fiscal_documents) f,
              (select count(*) from public.asaas_charges) c`,
    )) as Record<string, string>[];

    const r = await rpc<{ status: string; sob_responsabilidade: number }>(matriz, "kit_acerto_conferir", {
      _acerto: acerto,
    });
    expect(r.ok).toBe(true);
    expect(r.dados.status).toBe("aguardando_comprovacao");
    expect(r.dados.sob_responsabilidade).toBe(35);

    const depois = (await adm.unsafe(
      `select (select count(*) from public.financial_titles) t,
              (select count(*) from public.financial_installments) p,
              (select count(*) from public.financial_settlements) l,
              (select count(*) from public.fiscal_documents) f,
              (select count(*) from public.asaas_charges) c`,
    )) as Record<string, string>[];
    expect(depois[0]).toEqual(antes[0]!);
  });

  it("11. aprovar o acerto é recusado enquanto a regra comercial não existir", async () => {
    const r = await rpc(matriz, "kit_acerto_aprovar", { _acerto: acerto });
    expect(r.ok).toBe(false);
    expect(String(r.erro)).toContain("bloqueada");
  });

  it("12. consultora não confere nem bloqueia o próprio acerto", async () => {
    expect((await rpc(cons, "kit_acerto_conferir", { _acerto: acerto })).ok).toBe(false);
    expect((await rpc(cons, "kit_acerto_bloquear", { _acerto: acerto, _motivo: "tentativa" })).ok).toBe(false);
  });

  it("13. consultora alheia não lê o acerto; escrita direta é recusada", async () => {
    expect((await rpc(outra, "kit_acerto_detalhe", { _acerto: acerto })).ok).toBe(false);

    let recusado = false;
    try {
      await adm.unsafe(`update public.kit_acertos set status = 'aprovado' where id = $1`, [acerto]);
    } catch {
      recusado = true;
    }
    expect(recusado).toBe(true);
  });

  it("14. o detalhe declara os bloqueios em aberto, sem inventar valor", async () => {
    const r = await rpc<{ bloqueios: string[]; acerto: Record<string, unknown> }>(matriz, "kit_acerto_detalhe", {
      _acerto: acerto,
    });
    expect(r.ok).toBe(true);
    expect(r.dados.bloqueios.length).toBeGreaterThan(0);
    expect(r.dados.bloqueios.join(" ")).toContain("um terço");
    expect(r.dados.acerto["approved_at"] ?? null).toBeNull();
  });
});

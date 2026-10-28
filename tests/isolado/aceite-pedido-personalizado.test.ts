import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, rpc, type Conta } from "./base";
import { referenciaEtiqueta } from "../../src/lib/aceite-maleta";

let master: Conta, cons: Conta, outra: Conta, montadora: Conta;
let ciclo = "", variante = "", transferencia = "";
const marca = Date.now().toString(36);
const referencia = `000${Date.now()}`;
beforeAll(async () => {
  master = await criarConta({ nome: `aceite-master-${marca}`, papeis: ["master"] });
  cons = await criarConta({ nome: `aceite-cons-${marca}`, papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: `aceite-outra-${marca}`, papeis: ["consultora"], comParty: true });
  montadora = await criarConta({ nome: `aceite-mont-${marca}`, papeis: ["montagem"], comParty: true });
  const dep = await criarDeposito(`aceite-${marca}`);
  variante = await criarVariante(`aceite-${marca}`, 10990);
  await adm.unsafe("update public.products set reference_code=$2 where id=(select product_id from public.product_variants where id=$1)", [variante, referencia]);
  await porEstoque(variante, dep, 10);
  const c = await rpc<{ cycle_id: string }>(master, "kit_cycle_create", { _payload: { origin_location_id: dep, consultora_party_id: cons.partyId } });
  expect(c.erro).toBeNull(); ciclo = c.dados.cycle_id;
  expect((await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: variante, _qty: 3 })).erro).toBeNull();
  expect((await rpc(master, "kit_conferir", { _cycle: ciclo })).erro).toBeNull();
  expect((await rpc(master, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } })).erro).toBeNull();
  const rows = await adm.unsafe("select id from public.kit_transfers where cycle_id=$1 order by seq", [ciclo]);
  transferencia = String(rows[0]?.id);
});

describe("referência e telefone por login", () => {
  test("referência vazia ou zero herda produto, mantendo zeros à esquerda", async () => {
    expect(referenciaEtiqueta(null, "000543")).toBe("000543");
    expect(referenciaEtiqueta("000", "000543")).toBe("000543");
    expect(referenciaEtiqueta("VAR-1", "000543")).toBe("VAR-1");
    expect(referenciaEtiqueta(null, null)).toBeNull();
    const d = await rpc<{ itens: { referencia: string }[] }>(master, "kit_pedido_dados", { _cycle: ciclo });
    expect(d.erro).toBeNull(); expect(d.dados.itens[0]?.referencia).toBe(referencia);
  });
  test("telefone acompanha conta autenticada sem mudar padrão nem representante", async () => {
    expect((await rpc(montadora, "pedido_colaboradora_telefone_salvar", { _user: master.uid, _telefone: "43999991111" })).ok).toBe(false);
    expect((await rpc(master, "pedido_colaboradora_telefone_salvar", { _user: master.uid, _telefone: "43999991111" })).erro).toBeNull();
    expect((await rpc(master, "pedido_colaboradora_telefone_salvar", { _user: montadora.uid, _telefone: "43999992222" })).erro).toBeNull();
    const a = await rpc<{ empresa: { pedidos_telefone: string } }>(master, "kit_pedido_dados", { _cycle: ciclo });
    const b = await rpc<{ empresa: { pedidos_telefone: string } }>(montadora, "kit_pedido_dados", { _cycle: ciclo });
    expect(a.dados.empresa.pedidos_telefone).toBe("43999991111"); expect(b.dados.empresa.pedidos_telefone).toBe("43999992222");
    expect((await rpc(master, "pedido_colaboradora_telefone_salvar", { _user: montadora.uid, _telefone: "" })).erro).toBeNull();
    const cfg = await rpc<{ pedidos_telefone: string }>(master, "pedido_config_ler");
    const fallback = await rpc<{ empresa: { pedidos_telefone: string } }>(montadora, "kit_pedido_dados", { _cycle: ciclo });
    expect(fallback.dados.empresa.pedidos_telefone).toBe(cfg.dados.pedidos_telefone);
  });
  test("valor informativo não é criado por padrão; Master salva 850 reais e não autorizado é recusado", async () => {
    const antes = await rpc<Record<string, unknown>>(master, "pedido_config_ler");
    expect((await rpc(montadora, "pedido_config_salvar", { _dados: { proxima_maleta_texto: "Próxima maleta", proxima_maleta_minimo_cents: 85000 } })).ok).toBe(false);
    const r = await rpc<Record<string, unknown>>(master, "pedido_config_salvar", { _dados: { proxima_maleta_texto: "Próxima maleta", proxima_maleta_minimo_cents: 85000 } });
    expect(r.erro).toBeNull(); expect(r.dados.proxima_maleta_minimo_cents).toBe(85000);
    const aviso = await rpc<{ minimo_cents: number }>(cons, "consultora_aviso_proxima_maleta"); expect(aviso.dados.minimo_cents).toBe(85000);
    await rpc(master, "pedido_config_salvar", { _dados: { proxima_maleta_texto: antes.dados.proxima_maleta_texto, proxima_maleta_minimo_cents: antes.dados.proxima_maleta_minimo_cents } });
  });
});
describe("aceite obrigatório oficial", () => {
  test("pendência e lista pertencem só à destinatária, sem mudar estoque ou aceitar antes da entrega", async () => {
    const p = await rpc<{ cycle_id: string }[]>(cons, "consultora_aceites_pendentes"); expect(p.dados.some((x) => x.cycle_id === ciclo)).toBe(true);
    expect((await rpc<{ cycle_id: string }[]>(outra, "consultora_aceites_pendentes")).dados.some((x) => x.cycle_id === ciclo)).toBe(false);
    expect((await rpc(outra, "consultora_aceite_dados", { _cycle: ciclo })).ok).toBe(false);
    const d = await rpc<{ composicao: { referencia: string; quantidade: number; valor_unitario: number }[] }>(cons, "consultora_aceite_dados", { _cycle: ciclo });
    expect(d.erro).toBeNull(); expect(d.dados.composicao[0]).toMatchObject({ referencia, quantidade: 3, valor_unitario: 10990 });
    expect((await rpc(cons, "kit_aceitar", { _cycle: ciclo, _itens: [{ variant_id: variante, qty_accepted: 3, qty_divergent: 0 }], _idempotency_key: `novo-${marca}` })).ok).toBe(false);
  });
  test("entrega + aceite remove pendência, persiste e repetição não duplica", async () => {
    expect((await rpc(cons, "kit_transfer_confirm", { _transfer: transferencia, _payload: {} })).erro).toBeNull();
    const args = { _cycle: ciclo, _itens: [{ variant_id: variante, qty_accepted: 3, qty_divergent: 0 }], _idempotency_key: `novo-${marca}` };
    expect((await rpc(cons, "kit_aceitar", args)).erro).toBeNull();
    expect((await rpc<{ repetida: boolean }>(cons, "kit_aceitar", args)).dados.repetida).toBe(true);
    expect((await rpc<{ cycle_id: string }[]>(cons, "consultora_aceites_pendentes")).dados.some((x) => x.cycle_id === ciclo)).toBe(false);
    const rows = await adm.unsafe("select count(*)::int n from public.kit_acceptances where cycle_id=$1", [ciclo]); expect(rows[0]?.n).toBe(1);
  });
});
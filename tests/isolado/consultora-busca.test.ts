import { beforeAll, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, rpc, type Conta } from "./base";
let eu: Conta, outra: Conta, variante: string;
beforeAll(async () => {
  eu = await criarConta({ nome: "busca-consultora", papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: "busca-outra", papeis: ["consultora"], comParty: true });
  variante = await criarVariante("busca", 7989);
  await adm.unsafe("update public.product_variants set barcode='ISO-LAN0189' where id=$1", [variante]);
  const kits = await adm.unsafe("insert into public.kits(code) values($1) returning id", [`ISO-BUSCA-${crypto.randomUUID()}`]);
  const ciclos = await adm.unsafe("insert into public.kit_cycles(kit_id,cycle_no,consultora_party_id,status) values($1,1,$2,'operacao') returning id", [kits[0].id, eu.partyId]);
  await adm.unsafe("insert into public.kit_balances(cycle_id,variant_id,qty_allocated,qty_accepted) values($1,$2,2,2)", [ciclos[0].id, variante]);
});
test("etiqueta e termo parcial encontram somente peças próprias disponíveis, preço atual intacto", async () => {
  const r = await rpc<{ variant_id: string; preco_cents: number; disponivel: number }[]>(eu, "consultora_pecas_buscar", { _busca: "LAN0189" });
  expect(r.ok).toBe(true); expect(r.dados).toHaveLength(1); expect(r.dados[0]?.variant_id).toBe(variante); expect(r.dados[0]?.disponivel).toBe(2);
  const price = await adm.unsafe("select price_cents from public.product_variants where id=$1", [variante]); expect(price[0].price_cents).toBe(7989);
  expect((await rpc<unknown[]>(outra, "consultora_pecas_buscar", { _busca: "LAN0189" })).dados).toHaveLength(0);
  expect((await rpc<unknown[]>(eu, "consultora_pecas_buscar", { _busca: "impossivel-lardan" })).dados).toHaveLength(0);
});
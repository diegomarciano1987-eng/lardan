/**
 * 0392 (Diego/Daniel, 25/11/2026) — duas variações com o mesmo banho (Cristal e Color)
 * salvam de primeira: o código interno automático ganha -2, -3. Banco ISOLADO.
 */
import { beforeAll, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const sorte = Math.floor(Math.random() * 90000);
let master: Conta, pid = "", plat = "";
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;

beforeAll(async () => {
  master = await criarConta({ nome: `v392-${sorte}`, papeis: ["master"], comParty: true });
  const p = await um<{ id: string }>(
    "insert into products(name,slug,status,price_cents,internal_code) values($1,$2,'rascunho',4990,$3) returning id",
    [`BR TRIO ISO ${sorte}`, `br-trio-iso-${sorte}`, `ISO-BRI-${sorte}`]);
  pid = String(p.id);
  plat = String((await um<{ id: string }>("select id from plating_types where sku_token is not null limit 1")).id);
});

test("Cristal, Color e terceira variação com mesmo banho salvam com códigos distintos", async () => {
  const skus: string[] = [];
  for (const label of ["Cristal", "Color", "Rosa"]) {
    const r = await rpc<{ sku: string }>(master, "variant_save", { _id: null, _payload: { product_id: pid, label, plating_type_id: plat } });
    expect(r.erro).toBeNull();
    skus.push(r.dados!.sku);
  }
  expect(skus[1]).toBe(`${skus[0]}-2`);
  expect(skus[2]).toBe(`${skus[0]}-3`);
});

test("editar variante sem informar código mantém o código dela", async () => {
  const v = await um<{ id: string; sku: string }>("select id, sku from product_variants where product_id=$1 and label='Color'", [pid]);
  const r = await rpc<{ sku: string }>(master, "variant_save", { _id: v.id, _payload: { label: "Color", plating_type_id: plat } });
  expect(r.erro).toBeNull();
  expect(r.dados!.sku).toBe(v.sku);
});

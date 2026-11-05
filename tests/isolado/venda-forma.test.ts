import { expect, test } from "bun:test";
import { adm } from "./base";

const casos: [string, Record<string, unknown>, string][] = [
  ["Pix cobrado pela Lardan tem prioridade", { pay_method: "pix", pay_installment_id: "00000000-0000-0000-0000-000000000001", combinado_forma: "credito" }, "pix"],
  ["Cartão cobrado pela Lardan tem prioridade", { pay_method: "cartao", pay_installment_id: "00000000-0000-0000-0000-000000000001", combinado_forma: "pix" }, "cartao"],
  ["Boleto cobrado pela Lardan tem prioridade", { pay_method: "depois", pay_installment_id: "00000000-0000-0000-0000-000000000001", combinado_forma: "pix" }, "boleto"],
  ["Pix combinado", { combinado_forma: "pix" }, "pix_combinado"],
  ["Crédito combinado", { combinado_forma: "credito" }, "cartao_combinado"],
  ["Débito combinado", { combinado_forma: "debito" }, "cartao_combinado"],
  ["Dinheiro combinado", { combinado_forma: "dinheiro" }, "dinheiro"],
  ["A prazo combinado", { combinado_forma: "a_prazo" }, "receber_depois"],
  ["Dinheiro registrado conserva classificação", { pay_method: "dinheiro", combinado_forma: "pix" }, "dinheiro"],
  ["Receber depois registrado conserva classificação", { pay_method: "depois", combinado_forma: "pix" }, "receber_depois"],
  ["Concluído sem forma", { status: "concluido" }, "marcada_feita"],
  ["Sem informação não inventa forma", {}, "sem_forma"],
];

for (const [nome, pedido, esperado] of casos) {
  test(`0213 — ${nome}`, async () => {
    const linhas = await adm.unsafe(
      "select public.venda_forma(jsonb_populate_record(null::public.sales_orders, $1::jsonb)) as forma",
      [JSON.stringify(pedido)],
    );
    expect(linhas[0]?.forma).toBe(esperado);
  });
}
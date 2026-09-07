import { expect, it } from "vitest";
import { comoUsuario, criarConta, limpar, rpc } from "./harness";
it("devolve o estoque de homologação ao estado anterior", async () => {
  const m = await criarConta({ nome: "master", papeis: ["master"] });
  const abertas = await rpc(m.token, "stock_reservations_list", { _status: "ativa", _page: 0, _size: 50 });
  console.log("LISTA", abertas.status, JSON.stringify(abertas.body).slice(0, 300));
  const rows = ((abertas.body as { rows?: { id: string }[] }).rows ?? []);
  for (const r of rows) await rpc(m.token, "release_stock_reservation", { _reservation_id: r.id, _cancelar: false });
  const l = await comoUsuario(m.token, "/locations?select=id&is_active=eq.true&order=code&limit=1");
  console.log("LOCAIS", l.status, JSON.stringify(l.body).slice(0,200));
  const local = (l.body as { id: string }[])[0]?.id;
  const v = await comoUsuario(m.token, "/product_variants?select=id&is_active=eq.true&order=created_at&limit=1");
  const variant = (v.body as { id: string }[])[0]?.id;
  const r = await rpc(m.token, "register_stock_movement", {
    _kind: "ajuste", _variant_id: variant, _quantity: -20, _to_location_id: local,
    _reason_code: "ajuste", _note: "HOMOLOG devolução das unidades usadas na bateria de reservas",
    _idempotency_key: `homolog-limpeza-${crypto.randomUUID()}`,
  });
  console.log("reservas liberadas:", rows.length, "ajuste:", r.status, JSON.stringify(r.body).slice(0,200));
  expect(r.status).toBe(200);
  await limpar();
}, 180000);

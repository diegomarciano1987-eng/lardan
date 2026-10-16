import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/maletas";
type Compra = { id: string; code: string; created_at: string; status: string; payment_status: string; subtotal_cents: number; itens: { id: string; nome: string; quantidade: number; preco_cents: number }[] };
export function ComprasCliente({ cliente }: { cliente: string }) {
  const q = useQuery({ queryKey: ["consultora", "compras", cliente], queryFn: async () => {
    const { data, error } = await supabase.rpc("consultora_cliente_compras", { _cliente: cliente });
    if (error) throw error; return data as unknown as Compra[];
  } });
  const pagas = (q.data ?? []).filter((p) => p.payment_status === "pago" && p.status !== "cancelado");
  return <section className="border-t border-border py-5"><h2 className="text-xl font-semibold">Compras e pedidos</h2>
    {q.isLoading && <p>Carregando compras…</p>}{q.isError && <p role="alert">Não foi possível carregar as compras.</p>}
    {!q.isLoading && !q.isError && <p className="mt-3">{pagas.length} compras pagas · {brl(pagas.reduce((s, p) => s + Number(p.subtotal_cents), 0))}</p>}
    <ul className="mt-4 divide-y divide-border">{q.data?.map((p) => <li key={p.id} className="py-4"><p className="font-semibold">{p.code} · {new Date(p.created_at).toLocaleDateString("pt-BR")}</p><p>{p.payment_status === "pago" ? "Pago" : p.status === "cancelado" ? "Cancelado" : "Pagamento não confirmado"} · {brl(Number(p.subtotal_cents))}</p><ul className="mt-2">{p.itens.map((i) => <li key={i.id}>{i.quantidade}× {i.nome}</li>)}</ul></li>)}</ul>
  </section>;
}
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FolhaA4, ModoDeUso } from "@/components/consultora/DocumentoLardan";
import { brl, detalhePedido, traduzir } from "@/lib/maletas";
import { GARANTIA_ANOS, TROCA_DIAS, fimGarantia } from "@/lib/consultora-regras";

export const Route = createFileRoute("/_authenticated/consultora-garantia/$id")({
  component: Comprovante,
  head: () => ({
    meta: [
      { title: "Comprovante e certificado de garantia — LARDAN" },
      { name: "description", content: "Comprovante do pedido com certificado de garantia LARDAN." },
      { property: "og:title", content: "Certificado de garantia — LARDAN" },
      { property: "og:description", content: "Peças, valores, data da compra e garantia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const br = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR");
const diaSP = (d: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(d));

function Comprovante() {
  const { id } = Route.useParams();
  const q = useQuery({ queryKey: ["consultora", "pedido", id], queryFn: () => detalhePedido(id) });
  if (q.isLoading) return <p className="p-8">Carregando pedido…</p>;
  if (q.isError || !q.data) return <p role="alert" className="p-8">{q.error ? traduzir(q.error) : "Pedido não encontrado."}</p>;
  const { pedido: p, itens, consultora } = q.data;
  const compra = diaSP(p.created_at);
  const troca = new Date(compra + "T12:00:00Z"); troca.setUTCDate(troca.getUTCDate() + TROCA_DIAS);
  const total = itens.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0);
  return (
    <FolhaA4 titulo="Comprovante e certificado de garantia">
      <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-2 text-[0.95rem]">
        <div><dt className="text-muted-foreground">Pedido</dt><dd className="font-semibold">{p.code}</dd></div>
        <div><dt className="text-muted-foreground">Data da compra</dt><dd className="font-semibold">{br(compra)}</dd></div>
        <div><dt className="text-muted-foreground">Cliente</dt><dd className="font-semibold">{p.customer_name}</dd></div>
        <div><dt className="text-muted-foreground">Consultora</dt><dd className="font-semibold">{consultora ?? "—"}</dd></div>
      </dl>
      <table className="mb-5 w-full border-collapse text-[0.92rem]">
        <thead><tr className="border-b border-border text-left"><th className="py-2">Peça</th><th className="py-2 text-center">Qtd.</th><th className="py-2 text-right">Unitário</th><th className="py-2 text-right">Total</th></tr></thead>
        <tbody>{itens.map((i) => (
          <tr key={i.id} className="border-b border-border/60"><td className="py-2">{i.product_name}{i.variant_label ? ` — ${i.variant_label}` : ""}</td><td className="py-2 text-center tabular-nums">{i.quantity}</td><td className="py-2 text-right tabular-nums">{brl(i.unit_price_cents)}</td><td className="py-2 text-right tabular-nums">{brl(i.unit_price_cents * i.quantity)}</td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={3} className="py-2 text-right font-semibold">Total</td><td className="py-2 text-right font-semibold tabular-nums">{brl(total)}</td></tr></tfoot>
      </table>
      <section className="mb-5 rounded-lg border-2 border-primary p-4">
        <h2 className="text-lg font-semibold">Certificado de garantia</h2>
        <p className="mt-1 text-[0.95rem]">As peças acima têm garantia de <strong>{GARANTIA_ANOS} anos</strong>, válida até <strong>{br(fimGarantia(compra))}</strong>, seguindo o modo de uso abaixo. Troca até <strong>{br(troca.toISOString())}</strong> ({TROCA_DIAS} dias). Guarde este comprovante.</p>
      </section>
      <ModoDeUso />
    </FolhaA4>
  );
}

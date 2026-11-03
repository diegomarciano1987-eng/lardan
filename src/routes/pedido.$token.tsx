import { createFileRoute, notFound } from "@tanstack/react-router";
import { lerPedidoPublico } from "@/lib/pedido-publico.functions";
import { fotoPedido } from "@/lib/pedido-publico";
import { brl } from "@/lib/maletas";
import { GARANTIA_ANOS, MANUAL_CUIDADOS_URL, fimGarantia } from "@/lib/consultora-regras";

const SITE = "https://www.lardan.com.br";

export const Route = createFileRoute("/pedido/$token")({
  loader: async ({ params }) => {
    const p = await lerPedidoPublico({ data: { token: params.token } }).catch(() => null);
    if (!p) throw notFound();
    return p;
  },
  head: ({ loaderData, params }) => {
    const capa = loaderData?.itens.find((i) => i.media_id)?.media_id;
    const titulo = loaderData ? `Pedido ${loaderData.codigo} — suas peças LARDAN` : "Pedido LARDAN";
    const desc = loaderData ? `${loaderData.itens.length} peça(s) com fotos, referências e garantia de ${GARANTIA_ANOS} anos.` : "Pedido LARDAN.";
    const img = capa ? `${SITE}${fotoPedido(params.token, capa)}` : null;
    return {
      meta: [
        { title: titulo },
        { name: "description", content: desc },
        { property: "og:title", content: titulo },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: img ? "summary_large_image" : "summary" },
        { name: "robots", content: "noindex, nofollow" },
        ...(img ? [{ property: "og:image", content: img }, { name: "twitter:image", content: img }] : []),
      ],
    };
  },
  notFoundComponent: () => (
    <main className="grid min-h-dvh place-items-center bg-background p-8 text-center">
      <div><p className="font-display text-3xl">Pedido não encontrado</p><p className="mt-2 text-muted-foreground">Confira o link com a sua consultora.</p></div>
    </main>
  ),
  component: PaginaPedido,
});

const diaSP = (d: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(d));
const br = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR");

function PaginaPedido() {
  const p = Route.useLoaderData();
  const { token } = Route.useParams();
  const compra = diaSP(p.criado_em);
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border px-6 py-10 text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">LARDAN · semijoias</p>
        <h1 className="mt-3 font-display text-4xl leading-tight">Olá, {p.cliente}!</h1>
        <p className="mt-2 text-muted-foreground">Estas são as peças do seu pedido <strong className="text-foreground">{p.codigo}</strong>{p.consultora ? <> com {p.consultora}</> : null}.</p>
      </header>
      <section className="mx-auto grid max-w-3xl gap-5 px-5 py-8 sm:grid-cols-2">
        {p.itens.map((i, n) => {
          const src = fotoPedido(token, i.media_id);
          return (
            <article key={n} className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
              <div className="aspect-square bg-muted">
                {src ? <img src={src} alt={i.nome} loading={n < 2 ? "eager" : "lazy"} className="size-full object-cover" />
                  : <div className="grid size-full place-items-center text-sm text-muted-foreground">Sem foto</div>}
              </div>
              <div className="space-y-1 p-5">
                <h2 className="font-display text-xl leading-snug">{i.nome}</h2>
                {i.variante && <p className="text-sm text-muted-foreground">{i.variante}</p>}
                {i.referencia && <p className="text-sm">Ref. <strong className="tabular-nums">{i.referencia}</strong></p>}
                <p className="pt-2 text-sm text-muted-foreground">{i.quantidade}x {brl(i.unitario_cents)}</p>
                <strong className="block text-lg tabular-nums">{brl(i.unitario_cents * i.quantidade)}</strong>
              </div>
            </article>
          );
        })}
      </section>
      <section className="mx-auto max-w-3xl px-5 pb-12">
        <div className="flex items-center justify-between rounded-3xl border border-border bg-card px-6 py-5">
          <span className="text-muted-foreground">Total do pedido</span>
          <strong className="block text-2xl tabular-nums">{brl(p.total_cents)}</strong>
        </div>
        <div className="mt-5 rounded-3xl border-2 border-primary px-6 py-5">
          <h2 className="font-display text-2xl">Garantia de {GARANTIA_ANOS} anos</h2>
          <p className="mt-1 text-muted-foreground">Compra em {br(compra)}, garantia até {br(fimGarantia(compra))}, seguindo o manual de cuidados.</p>
          <a href={MANUAL_CUIDADOS_URL} className="mt-3 inline-block font-semibold text-primary underline underline-offset-4">Ver manual de cuidados</a>
        </div>
      </section>
    </main>
  );
}

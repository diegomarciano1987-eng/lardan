import * as React from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Share2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import {
  brl,
  chaveIdempotencia,
  enviarPedido,
  imagem,
  traduzir,
  vitrinePublica,
  type VitrineItem,
} from "@/lib/maletas";

export const Route = createFileRoute("/$slug")({
  loader: async ({ params }) => {
    const dados = await vitrinePublica(params.slug);
    if (!dados) throw notFound();
    return dados;
  },
  component: VitrineConsultora,
  head: ({ loaderData }) => {
    const nome = loaderData?.nome ?? "Vitrine";
    const titulo = `${nome} · Semijoias LARDAN`;
    const descricao =
      loaderData?.headline ?? `Peças LARDAN disponíveis com ${nome}. Escolha e envie seu pedido direto.`;
    return {
      meta: [
        { title: titulo },
        { name: "description", content: descricao },
        { property: "og:title", content: titulo },
        { property: "og:description", content: descricao },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
});

function VitrineConsultora() {
  const dados = Route.useLoaderData();
  const { slug } = Route.useParams();
  const [sacola, setSacola] = React.useState<Record<string, number>>({});
  const [cliente, setCliente] = React.useState({ nome: "", telefone: "", observacao: "" });
  const [chave, setChave] = React.useState(chaveIdempotencia);
  const [enviado, setEnviado] = React.useState<{ codigo: string } | null>(null);
  const [categoria, setCategoria] = React.useState("todas");

  const vitrine = useQuery({
    queryKey: ["vitrine", slug],
    queryFn: () => vitrinePublica(slug),
    initialData: dados,
    refetchOnWindowFocus: true,
  });

  const itens = vitrine.data?.itens ?? [];
  const categorias = Array.from(new Set(itens.map((i) => i.categoria).filter(Boolean))) as string[];
  const visiveis = categoria === "todas" ? itens : itens.filter((i) => i.categoria === categoria);

  const chaveItem = (i: VitrineItem) => `${i.cycle_id}:${i.variant_id}`;
  const total = itens.reduce((acc, i) => acc + (sacola[chaveItem(i)] ?? 0) * i.preco_cents, 0);
  const pecas = Object.values(sacola).reduce((a, b) => a + b, 0);

  const enviar = useMutation({
    mutationFn: () => {
      const lista = itens
        .filter((i) => (sacola[chaveItem(i)] ?? 0) > 0)
        .map((i) => ({ cycle_id: i.cycle_id, variant_id: i.variant_id, quantidade: sacola[chaveItem(i)]! }));
      return enviarPedido(slug, { ...cliente, canal: "vitrine" }, lista, chave);
    },
    onSuccess: (r) => {
      setEnviado({ codigo: r.codigo });
      setSacola({});
      setChave(chaveIdempotencia());
      void vitrine.refetch();
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-32 pt-10">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Consultora LARDAN</p>
        <h1 className="mt-2 font-display text-4xl">{vitrine.data?.nome}</h1>
        {vitrine.data?.headline && <p className="mt-2 text-muted-foreground">{vitrine.data.headline}</p>}
        {vitrine.data?.bio && <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed">{vitrine.data.bio}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {vitrine.data?.whatsapp && (
            <a
              className="rounded-full border border-foreground/15 px-4 py-2 text-sm"
              href={`https://wa.me/55${vitrine.data.whatsapp}`}
              target="_blank"
              rel="noreferrer"
            >
              Falar no WhatsApp
            </a>
          )}
          <button
            type="button"
            className="rounded-full border border-foreground/15 px-4 py-2 text-sm"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href);
              toast.success("Endereço copiado.");
            }}
          >
            <Share2 aria-hidden className="mr-1 inline size-4" /> Compartilhar
          </button>
        </div>
      </header>

      {categorias.length > 1 && (
        <nav className="mt-8 flex flex-wrap justify-center gap-2">
          {["todas", ...categorias].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoria(c)}
              className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-widest ${
                categoria === c ? "border-foreground" : "border-foreground/15 text-muted-foreground"
              }`}
            >
              {c === "todas" ? "Todas" : c}
            </button>
          ))}
        </nav>
      )}

      {visiveis.length === 0 ? (
        <p className="mt-16 text-center text-muted-foreground">
          Nenhuma peça disponível nesta vitrine agora. Fale comigo pelo WhatsApp que eu te aviso assim que
          chegar novidade.
        </p>
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-5 md:grid-cols-3">
          {visiveis.map((i) => {
            const k = chaveItem(i);
            const q = sacola[k] ?? 0;
            return (
              <li key={k} className="flex flex-col">
                <div className="aspect-[4/5] overflow-hidden rounded-xl bg-muted">
                  {imagem(i.media_id) ? (
                    <img
                      src={imagem(i.media_id)!}
                      alt={i.produto}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>
                <p className="mt-3 text-sm font-medium">{i.produto}</p>
                <p className="text-xs text-muted-foreground">
                  {[i.variante, i.tamanho, i.cor].filter(Boolean).join(" · ") || "Peça única"}
                </p>
                <p className="mt-1 text-sm font-semibold">{brl(i.preco_cents)}</p>
                <p className="text-[0.7rem] text-muted-foreground">{i.disponivel} disponível(is)</p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    className="size-8 rounded-full border border-foreground/15"
                    onClick={() => setSacola((s) => ({ ...s, [k]: Math.max((s[k] ?? 0) - 1, 0) }))}
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm tabular-nums">{q}</span>
                  <button
                    type="button"
                    className="size-8 rounded-full border border-foreground/15"
                    onClick={() => setSacola((s) => ({ ...s, [k]: Math.min((s[k] ?? 0) + 1, i.disponivel) }))}
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {enviado && (
        <section className="mt-10 rounded-2xl border border-foreground/15 p-6 text-center">
          <p className="font-display text-2xl">Pedido enviado</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Protocolo {enviado.codigo}. As peças ficaram guardadas para você e a consultora vai confirmar o
            atendimento e a forma de pagamento.
          </p>
        </section>
      )}

      {pecas > 0 && (
        <section className="fixed inset-x-0 bottom-0 border-t border-foreground/10 bg-background/95 p-4 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl space-y-3">
            <p className="text-sm">
              <ShoppingBag aria-hidden className="mr-1 inline size-4" />
              {pecas} peça(s) · <strong>{brl(total)}</strong>
            </p>
            <div className="grid gap-2 md:grid-cols-3">
              <input
                className="rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm"
                placeholder="Seu nome"
                value={cliente.nome}
                onChange={(e) => setCliente((c) => ({ ...c, nome: e.target.value }))}
              />
              <input
                className="rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm"
                placeholder="Seu WhatsApp"
                value={cliente.telefone}
                onChange={(e) => setCliente((c) => ({ ...c, telefone: e.target.value }))}
              />
              <button
                type="button"
                className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
                disabled={enviar.isPending || cliente.nome.trim().length < 2}
                onClick={() => enviar.mutate()}
              >
                {enviar.isPending ? "Enviando…" : "Enviar pedido"}
              </button>
            </div>
            <p className="text-[0.7rem] text-muted-foreground">
              O envio reserva as peças por 48 horas. O pagamento é combinado direto com a consultora.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

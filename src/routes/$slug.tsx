import * as React from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Share2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import {
  brl,
  imagem,
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
      loaderData?.headline ?? `Peças LARDAN disponíveis com ${nome}. Escolha suas peças e fale direto com a consultora.`;
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

  const zap = whatsappLink(vitrine.data?.whatsapp);
  const primeiroNome = (vitrine.data?.nome ?? "").split(" ")[0] || "a consultora";
  const mensagem = (lista: VitrineItem[]) => {
    const linhas = lista.map((i) => {
      const q = sacola[chaveItem(i)] ?? 1;
      const det = [i.variante, i.tamanho, i.cor].filter(Boolean).join(" · ");
      return `• ${q}x ${i.produto}${det ? ` (${det})` : ""} — ${brl(i.preco_cents)}`;
    });
    const url = typeof window === "undefined" ? "" : window.location.href;
    return `Olá, ${primeiroNome}! Vi sua vitrine Lardan e tenho interesse:\n${linhas.join("\n")}\n\nAinda está disponível?\n${url}`;
  };
  const abrirZap = (lista: VitrineItem[]) => {
    if (!zap) return;
    window.open(`${zap}?text=${encodeURIComponent(mensagem(lista))}`, "_blank", "noopener,noreferrer");
  };
  const selecionados = itens.filter((i) => (sacola[chaveItem(i)] ?? 0) > 0);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-32 pt-10">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Consultora LARDAN</p>
        <h1 className="mt-2 font-display text-4xl">{vitrine.data?.nome}</h1>
        {vitrine.data?.headline && <p className="mt-2 text-muted-foreground">{vitrine.data.headline}</p>}
        {vitrine.data?.bio && <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed">{vitrine.data.bio}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {zap && (
            <a
              className="rounded-full border border-foreground/15 px-4 py-2 text-sm"
              href={zap ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              Falar com {primeiroNome}
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

      {pecas > 0 && (
        <section className="fixed inset-x-0 bottom-0 border-t border-foreground/10 bg-background/95 p-4 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl space-y-3">
            <p className="text-sm">
              <ShoppingBag aria-hidden className="mr-1 inline size-4" />
              {pecas} peça(s) · <strong>{brl(total)}</strong>
            </p>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-3 text-sm text-background disabled:opacity-50"
              disabled={!zap}
              onClick={() => abrirZap(selecionados)}
            >
              <MessageCircle aria-hidden className="size-4" /> Enviar interesse para {primeiroNome}
            </button>
            <p className="text-[0.7rem] text-muted-foreground">
              Sua seleção fica só neste aparelho e não reserva peças. A disponibilidade é confirmada no atendimento.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

/** Monta o endereço do WhatsApp sem duplicar o 55 quando o número já vem com DDI. */
function whatsappLink(numero?: string | null) {
  let d = (numero ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length < 10) return null;
  if (!(d.startsWith("55") && d.length >= 12)) d = `55${d}`;
  return `https://wa.me/${d}`;
}

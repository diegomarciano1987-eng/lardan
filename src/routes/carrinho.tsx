import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Minus, Plus, ShoppingBag, Sparkles, Truck, X } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { formatPreco, mediaUrl } from "@/lib/storefront";
import {
import { ogImageMeta } from "@/lib/seo";
  alterarQuantidade,
  removerDoCarrinho,
  subtotalCents,
  totalItens,
  useCarrinho,
} from "@/lib/carrinho";

export const Route = createFileRoute("/carrinho")({
  component: CarrinhoPage,
  head: () => ({
    meta: [
      { title: "Sua sacola — LARDAN" },
      {
        name: "description",
        content: "Revise as peças escolhidas, simule o frete e finalize com a sua consultora Lardan.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Sua sacola — LARDAN" },
      { property: "og:description", content: "Revise as peças escolhidas e simule o frete." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      ...ogImageMeta(),
    ],
  }),
});

function CarrinhoPage() {
  const itens = useCarrinho();
  const qtd = totalItens(itens);
  const subtotal = subtotalCents(itens);

  return (
    <SiteLayout brandedHeader>
      <div className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 top-10 h-[32rem] w-[32rem] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 bottom-0 h-[26rem] w-[26rem] rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--foreground) 10%, transparent), transparent 70%)" }}
        />

        <div className="relative mx-auto max-w-6xl px-6 pb-28 pt-36 md:pt-48">
          <header className="mb-14 max-w-xl">
            <p className="text-[0.625rem] tracking-[0.32em] uppercase text-muted-foreground">Curadoria Lardan</p>
            <h1 className="mt-4 font-display text-5xl leading-[1.05] text-foreground md:text-6xl">Sua sacola</h1>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              {qtd > 0
                ? `${qtd} peça${qtd > 1 ? "s" : ""} escolhida${qtd > 1 ? "s" : ""} com cuidado. Revise, simule o frete e siga com a sua consultora.`
                : "Nenhuma peça guardada ainda. Escolha uma joia e ela aparece aqui."}
            </p>
            <span aria-hidden className="mt-8 block h-px w-24 bg-foreground/20" />
          </header>

          {itens.length === 0 ? (
            <div className="rounded-3xl border border-foreground/10 bg-background/60 px-8 py-16 text-center backdrop-blur-xl">
              <ShoppingBag className="mx-auto h-7 w-7 text-muted-foreground" strokeWidth={1.2} />
              <p className="mt-6 text-sm text-muted-foreground">Sua sacola está vazia.</p>
              <Link to="/semijoias" className="btn-premium mt-8">
                Ver as semijoias
              </Link>
            </div>
          ) : (
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
              <ul className="min-w-0 space-y-6">
                {itens.map((i) => {
                  const url = i.mediaId ? mediaUrl(i.mediaId) : null;
                  return (
                    <li
                      key={`${i.slug}-${i.variante ?? ""}`}
                      className="group grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-5 rounded-3xl border border-foreground/10 bg-background/60 p-5 shadow-[0_30px_70px_-60px_color-mix(in_oklab,var(--foreground)_60%,transparent)] backdrop-blur-xl transition-colors duration-300 hover:border-foreground/20 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-7 sm:p-6"
                    >
                      <div className="overflow-hidden rounded-2xl bg-muted">
                        {url ? (
                          <img
                            src={url}
                            alt={i.nome}
                            loading="lazy"
                            width={1024}
                            height={1024}
                            className="aspect-square w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                          />
                        ) : (
                          <div className="aspect-square w-full" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <Link
                              to="/produto/$slug"
                              params={{ slug: i.slug }}
                              className="font-display text-xl text-foreground transition-opacity hover:opacity-70 md:text-2xl"
                            >
                              {i.nome}
                            </Link>
                            {i.variante ? (
                              <p className="mt-1 text-xs tracking-[0.18em] uppercase text-muted-foreground">
                                Tamanho {i.variante}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            aria-label={`Retirar ${i.nome} da sacola`}
                            onClick={() => removerDoCarrinho(i.slug, i.variante)}
                            className="shrink-0 rounded-full border border-transparent p-2 text-muted-foreground transition-colors hover:border-foreground/15 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                          >
                            <X className="h-4 w-4" strokeWidth={1.4} />
                          </button>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                          <div className="inline-flex items-center rounded-full border border-foreground/15">
                            <button
                              type="button"
                              aria-label="Diminuir quantidade"
                              onClick={() => alterarQuantidade(i.slug, i.variante, i.quantidade - 1)}
                              className="grid h-9 w-9 place-items-center rounded-full text-foreground/70 transition-colors hover:text-foreground"
                            >
                              <Minus className="h-3.5 w-3.5" strokeWidth={1.6} />
                            </button>
                            <span className="min-w-8 text-center text-sm text-foreground">{i.quantidade}</span>
                            <button
                              type="button"
                              aria-label="Aumentar quantidade"
                              onClick={() => alterarQuantidade(i.slug, i.variante, i.quantidade + 1)}
                              className="grid h-9 w-9 place-items-center rounded-full text-foreground/70 transition-colors hover:text-foreground"
                            >
                              <Plus className="h-3.5 w-3.5" strokeWidth={1.6} />
                            </button>
                          </div>
                          <p className="text-lg text-foreground">
                            {formatPreco((i.precoCents ?? 0) * i.quantidade) ?? "Consulte sua consultora"}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <aside className="min-w-0 space-y-6 lg:sticky lg:top-32">
                <SimuladorFrete />

                <div className="rounded-3xl border border-foreground/10 bg-background/70 p-7 backdrop-blur-xl">
                  <p className="text-[0.625rem] tracking-[0.28em] uppercase text-muted-foreground">Resumo</p>
                  <dl className="mt-6 space-y-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Peças</dt>
                      <dd className="text-foreground">{qtd}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Subtotal</dt>
                      <dd className="text-foreground">{formatPreco(subtotal) ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Frete</dt>
                      <dd className="text-muted-foreground">a simular</dd>
                    </div>
                  </dl>
                  <span aria-hidden className="mt-6 block h-px w-full bg-foreground/10" />
                  <div className="mt-6 flex items-end justify-between">
                    <span className="text-xs tracking-[0.22em] uppercase text-muted-foreground">Total</span>
                    <span className="font-display text-3xl text-foreground">{formatPreco(subtotal) ?? "—"}</span>
                  </div>
                  <button type="button" className="btn-premium mt-7 w-full">
                    <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                    Finalizar compra
                  </button>
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    O pagamento online ainda não está ativo. A sua consultora conclui o pedido com você.
                  </p>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </SiteLayout>
  );
}

/** Simulador de frete — visual pronto, cálculo real ainda não conectado. */
function SimuladorFrete() {
  const [cep, setCep] = useState("");
  const [simulado, setSimulado] = useState(false);

  const digitos = cep.replace(/\D/g, "").slice(0, 8);
  const formatado = digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
  const valido = digitos.length === 8;

  return (
    <section className="rounded-3xl border border-foreground/10 bg-background/70 p-7 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <Truck className="h-4 w-4 text-foreground/70" strokeWidth={1.4} />
        <p className="text-[0.625rem] tracking-[0.28em] uppercase text-muted-foreground">Simular frete</p>
      </div>

      <div className="mt-5 flex gap-2">
        <input
          value={formatado}
          onChange={(e) => {
            setCep(e.target.value);
            setSimulado(false);
          }}
          inputMode="numeric"
          placeholder="00000-000"
          aria-label="CEP de entrega"
          className="min-w-0 flex-1 rounded-full border border-foreground/15 bg-transparent px-5 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:outline-none"
        />
        <button
          type="button"
          disabled={!valido}
          onClick={() => setSimulado(true)}
          className="shrink-0 rounded-full border border-foreground/25 px-5 text-[0.625rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:border-foreground/60 disabled:opacity-40"
        >
          Calcular
        </button>
      </div>

      {simulado ? (
        <ul className="mt-6 space-y-3 text-sm">
          {[
            { nome: "Entrega padrão", prazo: "5 a 8 dias úteis" },
            { nome: "Entrega expressa", prazo: "2 a 3 dias úteis" },
            { nome: "Retirar com a consultora", prazo: "a combinar" },
          ].map((o) => (
            <li key={o.nome} className="flex items-center justify-between border-b border-foreground/10 pb-3">
              <span className="text-foreground">{o.nome}</span>
              <span className="text-xs text-muted-foreground">{o.prazo} · valor a confirmar</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          Informe o CEP para ver as opções de entrega. Os valores reais entram quando a entrega for ativada.
        </p>
      )}
    </section>
  );
}

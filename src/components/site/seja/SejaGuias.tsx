/**
 * Cards editoriais no /seja-lardan: quem ainda tem dúvidas encontra os guias
 * antes de decidir. Não substitui a candidatura, apenas informa.
 */
import { Link } from "@tanstack/react-router";
import { GUIAS_RESUMO } from "@/lib/editorial";
import { registrarCliqueCta } from "@/lib/crm/tracking";
import { CinematicTitle } from "./CinematicTitle";

export function SejaGuias() {
  return (
    <section aria-labelledby="guias-titulo" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-28">
        <div className="max-w-2xl">
          <p className="brand-eyebrow mb-4">Conteúdo Lardan</p>
          <CinematicTitle
            id="guias-titulo"
            className="text-3xl leading-tight text-foreground md:text-4xl"
          >
            Quer entender melhor antes de se candidatar?
          </CinematicTitle>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground">
            A Lardan não quer apenas o seu cadastro. Quer que você entenda o modelo antes de
            decidir.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {GUIAS_RESUMO.map((g) => (
            <Link
              key={g.path}
              to={g.path}
              className="rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary/40"
              data-cta-id={`seja_to_${g.path.slice(1)}`}
              onClick={() => registrarCliqueCta(`seja_to_${g.path.slice(1)}`, g.path)}
            >
              <span className="block font-display text-lg leading-snug text-foreground">
                {g.rotulo}
              </span>
              <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">
                {g.description}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

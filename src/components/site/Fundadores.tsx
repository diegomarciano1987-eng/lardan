import { Link } from "@tanstack/react-router";

/**
 * Seção institucional "Por trás da Lardan" (Daniel + Larissa).
 *
 * TODO — CONTEÚDO REAL PENDENTE DO CLIENTE. Nada aqui pode ser inventado.
 * Substituir quando a marca enviar:
 *   1. foto oficial do casal (src/assets/lardan-daniel-larissa.jpg)
 *   2. história de Daniel
 *   3. história de Larissa
 *   4. como nasceu a Lardan
 *   5. princípios e visão
 *   6. assinatura/frase do casal
 * O texto abaixo é institucional e intencionalmente sem datas, cidades,
 * formação, números ou qualquer fato biográfico.
 */
export function Fundadores() {
  return (
    <section
      aria-labelledby="por-tras-da-lardan"
      className="border-t border-border bg-background"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 md:grid-cols-2 md:gap-16 md:py-32">
        {/* Espaço reservado para a fotografia oficial do casal. */}
        <div
          aria-hidden
          className="aspect-[4/5] w-full rounded-sm bg-[linear-gradient(140deg,color-mix(in_oklab,var(--secondary)_90%,transparent),color-mix(in_oklab,var(--muted)_80%,transparent))]"
        />

        <div>
          <p className="brand-eyebrow mb-4">Por trás da Lardan</p>
          <h2 id="por-tras-da-lardan" className="text-3xl leading-tight text-foreground md:text-5xl">
            Uma marca construída por pessoas, para pessoas.
          </h2>
          <div className="rose-rule mt-8 w-20" />
          <div className="mt-8 space-y-5 text-base leading-relaxed text-muted-foreground">
            <p>
              Por trás de cada peça, de cada consultora e de cada história que encontra a Lardan,
              existe uma empresa construída com proximidade, cuidado e vontade de crescer junto.
            </p>
            <p>
              Daniel e Larissa conduzem a Lardan acreditando que uma semijoia pode representar muito
              mais do que beleza. Para quem usa, ela pode marcar um momento. Para quem vende, pode
              abrir caminhos, criar relacionamentos e fazer parte de novas conquistas.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link to="/a-lardan" className="btn-premium">
              Conheça a Lardan
            </Link>
            <Link
              to="/seja-lardan"
              className="text-[0.6875rem] tracking-[0.22em] uppercase text-foreground/70 underline-offset-8 transition-colors hover:text-foreground hover:underline"
            >
              Quero ser uma consultora
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

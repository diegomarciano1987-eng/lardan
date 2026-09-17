import { Link } from "@tanstack/react-router";
import fotoCasal from "@/assets/lardan-daniel-larissa.webp.asset.json";

/**
 * Seção institucional "Por trás da Lardan" (Daniel + Larissa).
 *
 * Foto oficial do casal já aplicada.
 * TODO — CONTEÚDO REAL AINDA PENDENTE DO CLIENTE. Nada pode ser inventado.
 * Substituir quando a marca enviar:
 *   1. história de Daniel
 *   2. história de Larissa
 *   3. como nasceu a Lardan
 *   4. princípios e visão
 *   5. assinatura/frase do casal
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
        {/* Fotografia oficial do casal. */}
        <div className="overflow-hidden rounded-sm bg-muted">
          <img
            src={fotoCasal.url}
            alt="Daniel e Larissa, fundadores da Lardan, com a filha"
            width={1200}
            height={1292}
            loading="lazy"
            decoding="async"
            className="aspect-[4/5] w-full object-cover"
          />
        </div>

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

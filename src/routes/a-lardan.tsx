import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero } from "@/components/site/PageHero";
import { RetratoOficial } from "@/components/site/RetratoOficial";
import {
  danielLarissaPortrait,
  danielPortraitInstitucional,
  larissaPortraitSeja,
} from "@/components/site/retratos";
import editorialAsset from "@/assets/lardan-editorial-mulher.jpg.asset.json";
import {
  DANIEL,
  EMPRESA,
  ENDERECO_LINHAS,
  LARISSA,
  MAPA_URL,
  VALORES,
} from "@/lib/institucional";
import {
  breadcrumbLd,
  canonical,
  foundersLd,
  jsonLdScript,
  pageMeta,
  webPageLd,
} from "@/lib/seo";

const TITLE = "A Lardan | Semijoias, história e fundadores";
const DESCRIPTION =
  "Conheça a Lardan: marca de semijoias fundada em 2021 em Ibiporã, no Paraná, por Daniel de Freitas Maciel e Larissa Persinato Dias Maciel.";

export const Route = createFileRoute("/a-lardan")({
  component: ALardanPage,
  head: () => ({
    meta: pageMeta({ title: TITLE, description: DESCRIPTION, path: "/a-lardan" }),
    links: canonical("/a-lardan"),
    scripts: [
      jsonLdScript([
        webPageLd({ path: "/a-lardan", name: TITLE, description: DESCRIPTION }),
        breadcrumbLd([
          { name: "Início", path: "/" },
          { name: "A Lardan", path: "/a-lardan" },
        ]),
        ...foundersLd(),
      ]),
    ],
  }),
});

function ALardanPage() {
  return (
    <SiteLayout>
      <PageHero eyebrow="A marca" title="A Lardan">
        <p>{EMPRESA.fundacao}</p>
      </PageHero>

      <section className="mx-auto max-w-4xl px-6 pb-16">
        <img
          src={editorialAsset.url}
          alt="Editorial Lardan com semijoias em ambiente de vidro e luz marfim"
          loading="lazy"
          width={1664}
          height={928}
          className="aspect-[16/9] w-full rounded-2xl object-cover"
          style={{ boxShadow: "var(--shadow-soft)" }}
        />
      </section>

      {/* Texto institucional oficial da empresa. */}
      <section aria-labelledby="empresa-titulo" className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <p className="brand-eyebrow mb-4">A empresa</p>
          <h2 id="empresa-titulo" className="text-3xl leading-tight text-foreground md:text-4xl">
            Semijoias que transformam vidas.
          </h2>
          <div className="rose-rule mt-8 w-20" />
          <div className="mt-8 space-y-5 text-base leading-relaxed text-muted-foreground">
            {EMPRESA.paragrafos.map((p) => (
              <p key={p.slice(0, 32)}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      {/* Fundadores, texto oficial integral. */}
      <section aria-labelledby="fundadores-titulo" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <header className="max-w-3xl">
            <p className="brand-eyebrow mb-4">Fundadores</p>
            <h2
              id="fundadores-titulo"
              className="text-3xl leading-tight text-foreground md:text-4xl"
            >
              Uma história que começou pela família e se transformou em propósito.
            </h2>
            <div className="rose-rule mt-8 w-20" />
          </header>

          <div className="mt-14 grid gap-14 md:grid-cols-2 md:gap-16">
            <article aria-labelledby="a-lardan-daniel">
              <RetratoOficial retrato={danielPortrait} rotulo="Foto oficial de Daniel" />
              <h3 id="a-lardan-daniel" className="mt-8 text-2xl text-foreground">
                {DANIEL.nome}
              </h3>
              <p className="brand-eyebrow mt-3 text-muted-foreground">{DANIEL.cargoCurto}</p>
              <div className="mt-6 space-y-5 text-base leading-relaxed text-muted-foreground">
                {DANIEL.paragrafos.map((p) => (
                  <p key={p.slice(0, 32)}>{p}</p>
                ))}
              </div>
              <blockquote className="mt-8 border-l border-primary/50 pl-6 text-lg leading-snug text-foreground">
                “{DANIEL.citacao}”
              </blockquote>
            </article>

            <article aria-labelledby="a-lardan-larissa">
              <RetratoOficial retrato={larissaPortrait} rotulo="Foto oficial de Larissa" />
              <h3 id="a-lardan-larissa" className="mt-8 text-2xl text-foreground">
                {LARISSA.nome}
              </h3>
              <p className="brand-eyebrow mt-3 text-muted-foreground">{LARISSA.cargoCurto}</p>
              <div className="mt-6 space-y-5 text-base leading-relaxed text-muted-foreground">
                {LARISSA.paragrafos.map((p) => (
                  <p key={p.slice(0, 32)}>{p}</p>
                ))}
              </div>
              <blockquote className="mt-8 border-l border-primary/50 pl-6 text-lg leading-snug text-foreground">
                “{LARISSA.citacao}”
              </blockquote>
            </article>
          </div>

          <div className="mt-16 max-w-3xl">
            <RetratoOficial
              retrato={danielLarissaPortrait}
              rotulo="Foto oficial de Daniel e Larissa"
              aspect="aspect-[4/5] md:aspect-[16/10]"
            />
          </div>
        </div>
      </section>

      {/* Cultura: apenas os valores oficiais, sem explicação inventada. */}
      <section aria-labelledby="valores-titulo" className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
          <p className="brand-eyebrow mb-4">Cultura</p>
          <h2 id="valores-titulo" className="text-3xl leading-tight text-foreground md:text-4xl">
            Nossos valores
          </h2>
          <div className="rose-rule mt-8 w-20" />
          <ul className="mt-10 grid gap-x-12 gap-y-4 md:grid-cols-2">
            {VALORES.map((valor) => (
              <li
                key={valor}
                className="border-b border-border pb-4 text-base leading-relaxed text-muted-foreground"
              >
                {valor}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Histórias reais: estrutura preparada, sem depoimento inventado. */}
      <section aria-labelledby="historias-titulo" className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center md:py-28">
          <p className="brand-eyebrow mb-4">Em breve</p>
          <h2 id="historias-titulo" className="text-3xl leading-tight text-foreground md:text-4xl">
            Histórias reais de quem é Lardan
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
            Esta área foi preparada para receber os vídeos e as histórias reais de consultoras
            Lardan. Nada é publicado aqui antes de ser gravado e autorizado por elas.
          </p>
        </div>
      </section>

      {/* Endereço oficial. */}
      <section aria-labelledby="endereco-titulo" className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-20 md:py-24">
          <p className="brand-eyebrow mb-4">Onde estamos</p>
          <h2 id="endereco-titulo" className="text-2xl text-foreground md:text-3xl">
            Lardan
          </h2>
          <address className="mt-6 text-base not-italic leading-relaxed text-muted-foreground">
            {ENDERECO_LINHAS.map((linha) => (
              <span key={linha} className="block">
                {linha}
              </span>
            ))}
          </address>
          <a
            href={MAPA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-block text-[0.6875rem] tracking-[0.22em] uppercase text-foreground/70 underline-offset-8 transition-colors hover:text-foreground hover:underline"
          >
            Ver localização
          </a>
          <p className="mt-10 text-sm text-muted-foreground">
            Quer fazer parte da rede?{" "}
            <Link to="/seja-lardan" className="underline underline-offset-4 hover:text-foreground">
              Conheça a oportunidade de ser Consultora Lardan
            </Link>
            .
          </p>
        </div>
      </section>
    </SiteLayout>
  );
}

import { createFileRoute } from "@tanstack/react-router";
...
import {
  DANIEL,
  EMPRESA,
  LARISSA,
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
      {/* Abertura institucional: sem título de marca, com a fundação em destaque. */}
      <section className="mx-auto max-w-4xl px-6 pb-12 pt-36 text-center md:pt-44">
        <p className="brand-eyebrow mb-8">A marca</p>
        <h1 className="font-display whitespace-nowrap text-[clamp(1.05rem,2.4vw,1.875rem)] leading-[1.1] tracking-tight text-foreground">
          {EMPRESA.fundacao}
        </h1>
        <div className="rose-rule mx-auto mt-6 w-16" />
      </section>


      <section aria-label="Lardan e seus fundadores" className="mx-auto max-w-6xl px-6 pb-20 md:pb-24">
        <div className="grid items-stretch overflow-hidden rounded-md border border-border bg-card md:grid-cols-[0.92fr_1.08fr]">
          <div className="relative flex min-h-72 items-center justify-center overflow-hidden px-8 py-16 sm:px-14 md:min-h-[34rem] md:px-16">
            <div aria-hidden="true" className="absolute inset-0 bg-secondary/45" />
            
            <img
              src={logoInstitucional.url}
              alt="Lardan"
              width={1190}
              height={205}
              className="relative z-10 h-auto w-full max-w-[31rem]"
            />
          </div>
          <figure className="relative min-h-[28rem] overflow-hidden md:min-h-[34rem]">
            <img
              src={casalOficial.url}
              alt="Larissa Persinato Dias Maciel e Daniel de Freitas Maciel, fundadores da Lardan"
              loading="eager"
              decoding="async"
              width={1122}
              height={1402}
              className="absolute inset-0 h-full w-full object-cover object-[center_34%]"
            />
            <div aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-16 bg-gradient-to-r from-card/35 to-transparent md:block" />
            <figcaption className="sr-only">Larissa e Daniel, fundadores da Lardan.</figcaption>
          </figure>
        </div>
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
              <RetratoOficial
                retrato={danielPortraitInstitucional}
                rotulo="Foto oficial de Daniel"
              />
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
              <RetratoOficial retrato={larissaPortraitSeja} rotulo="Foto oficial de Larissa" />
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
    </SiteLayout>
  );
}

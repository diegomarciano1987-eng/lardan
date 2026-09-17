/**
 * LARDAN — página de guia editorial.
 *
 * Tudo é renderizado no servidor (sem depender de JS): H1, autoria, resposta
 * direta, índice com âncoras reais, seções, FAQ visível, fontes e links. O
 * JSON-LD de FAQ usa exatamente esta mesma fonte de dados.
 */
import { Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { DANIEL } from "@/lib/institucional";
import { fontesDe } from "@/lib/editorial/fontes";
import { IMAGENS_EDITORIAIS, RETRATO_AUTOR } from "@/lib/editorial/imagens";
import { dataExtenso, tempoDeLeitura, type Bloco, type Guia } from "@/lib/editorial/tipos";
import { registrarCliqueCta } from "@/lib/crm/tracking";

const BIO_AUTOR =
  "Engenheiro civil de formação, Daniel de Freitas Maciel atua há 15 anos com redes de venda consignada e é fundador e CEO da Lardan.";

function LinkCta({
  to,
  ctaId,
  className,
  children,
}: {
  to: string;
  ctaId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={className}
      data-cta-id={ctaId}
      onClick={() => registrarCliqueCta(ctaId, to)}
    >
      {children}
    </Link>
  );
}

function BlocoView({ bloco }: { bloco: Bloco }) {
  switch (bloco.tipo) {
    case "paragrafo":
      return <p className="mt-5 text-[0.98rem] leading-[1.75] text-foreground/85">{bloco.texto}</p>;
    case "subtitulo":
      return (
        <h3 className="mt-9 font-display text-xl leading-snug text-foreground">{bloco.texto}</h3>
      );
    case "lista":
      return bloco.ordenada ? (
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-[0.98rem] leading-[1.7] text-foreground/85 marker:text-primary">
          {bloco.itens.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ol>
      ) : (
        <ul className="mt-5 space-y-2 pl-5 text-[0.98rem] leading-[1.7] text-foreground/85">
          {bloco.itens.map((i) => (
            <li key={i} className="list-disc marker:text-primary">
              {i}
            </li>
          ))}
        </ul>
      );
    case "citacao":
      return (
        <blockquote className="mt-8 border-l-2 border-primary/50 pl-5">
          <p className="font-display text-lg leading-relaxed text-foreground">{bloco.texto}</p>
          {bloco.autor ? (
            <cite className="brand-eyebrow mt-3 block not-italic text-muted-foreground">
              {bloco.autor}
            </cite>
          ) : null}
        </blockquote>
      );
    case "destaque":
      return (
        <aside className="mt-8 rounded-lg border border-border bg-secondary/40 p-6">
          {bloco.titulo ? (
            <p className="brand-eyebrow text-muted-foreground">{bloco.titulo}</p>
          ) : null}
          <p className="mt-2 whitespace-pre-line text-[0.98rem] leading-[1.7] text-foreground/90">
            {bloco.texto}
          </p>
        </aside>
      );
    case "tabela":
      return (
        <figure className="mt-8">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
              <thead className="bg-secondary/60">
                <tr>
                  {bloco.colunas.map((c) => (
                    <th key={c} scope="col" className="px-4 py-3 font-medium text-foreground">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bloco.linhas.map((l, i) => (
                  <tr key={i} className="border-t border-border/70">
                    {l.map((celula, j) => (
                      <td key={j} className="px-4 py-3 align-top text-foreground/85">
                        {celula}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bloco.legenda ? (
            <figcaption className="mt-2 text-xs text-muted-foreground">{bloco.legenda}</figcaption>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground md:hidden">
            Arraste a tabela para o lado para ver todas as colunas.
          </p>
        </figure>
      );
  }
}

export function ArtigoEditorial({ guia }: { guia: Guia }) {
  const imagem = IMAGENS_EDITORIAIS[guia.imagem];
  const minutos = tempoDeLeitura(guia);
  const fontes = fontesDe(guia.fontes);

  return (
    <SiteLayout>
      <article className="pb-24">
        {/* Hero editorial */}
        <header className="mx-auto max-w-6xl px-6 pt-28 md:pt-36">
          <nav aria-label="Você está em" className="text-xs text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link to="/" className="underline-offset-4 hover:underline">
                  Lardan
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-foreground/80">
                {guia.eyebrow === "GUIA LARDAN" ? "Guia" : guia.eyebrow}
              </li>
            </ol>
          </nav>

          <div className="mt-8 grid gap-10 md:grid-cols-[1.15fr_0.85fr] md:items-center">
            <div>
              <p className="brand-eyebrow text-muted-foreground">{guia.eyebrow}</p>
              <h1 className="mt-4 font-display text-[clamp(1.9rem,4.4vw,3.2rem)] leading-[1.12] tracking-tight text-foreground">
                {guia.h1}
              </h1>
              <p className="mt-6 max-w-2xl text-[1.02rem] leading-relaxed text-foreground/80">
                {guia.subheadline}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-border pt-6">
                <img
                  src={RETRATO_AUTOR.url}
                  alt={RETRATO_AUTOR.alt}
                  width={RETRATO_AUTOR.width}
                  height={RETRATO_AUTOR.height}
                  loading="eager"
                  className="h-12 w-12 rounded-full object-cover object-top"
                />
                <div className="text-sm">
                  <p className="font-medium text-foreground">{DANIEL.nome}</p>
                  <p className="text-muted-foreground">{DANIEL.cargo}</p>
                </div>
                <p className="text-xs text-muted-foreground md:ml-auto">
                  Publicado em <time dateTime={guia.publicadoEm}>{dataExtenso(guia.publicadoEm)}</time>
                  {guia.atualizadoEm !== guia.publicadoEm ? (
                    <>
                      {" · Atualizado em "}
                      <time dateTime={guia.atualizadoEm}>{dataExtenso(guia.atualizadoEm)}</time>
                    </>
                  ) : null}
                  {` · ${minutos} min de leitura`}
                </p>
              </div>
            </div>

            {imagem ? (
              <figure className="overflow-hidden rounded-xl">
                <img
                  src={imagem.url}
                  alt={imagem.alt}
                  width={imagem.width}
                  height={imagem.height}
                  loading="eager"
                  className="h-full w-full object-cover"
                />
              </figure>
            ) : null}
          </div>
        </header>

        <div className="mx-auto mt-14 grid max-w-6xl gap-12 px-6 lg:grid-cols-[0.28fr_0.72fr]">
          {/* Índice */}
          <nav aria-label="Índice do conteúdo" className="lg:sticky lg:top-28 lg:self-start">
            <details className="rounded-lg border border-border bg-secondary/30 p-5 lg:open" open>
              <summary className="brand-eyebrow cursor-pointer text-muted-foreground lg:cursor-default">
                Índice do conteúdo
              </summary>
              <ol className="mt-4 space-y-2 text-sm">
                {guia.secoes.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-foreground/75 underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {s.rotulo ?? s.titulo}
                    </a>
                  </li>
                ))}
                <li>
                  <a
                    href="#perguntas-frequentes"
                    className="text-foreground/75 underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Perguntas frequentes
                  </a>
                </li>
              </ol>
            </details>
          </nav>

          <div className="min-w-0 max-w-[46rem]">
            {/* Abertura / resposta direta */}
            <section aria-label="Abertura">
              {guia.abertura.map((p, i) => (
                <p
                  key={i}
                  className={
                    i === 0
                      ? "font-display text-[1.15rem] leading-[1.6] text-foreground"
                      : "mt-5 text-[0.98rem] leading-[1.75] text-foreground/85"
                  }
                >
                  {p}
                </p>
              ))}
            </section>

            {guia.secoes.map((s, indice) => (
              <section key={s.id} id={s.id} className="mt-14 scroll-mt-28">
                <h2 className="font-display text-[clamp(1.35rem,2.6vw,1.9rem)] leading-snug text-foreground">
                  {s.titulo}
                </h2>
                {s.blocos.map((b, i) => (
                  <BlocoView key={i} bloco={b} />
                ))}

                {/* CTA editorial leve no meio do conteúdo */}
                {indice === Math.floor(guia.secoes.length / 2) && guia.relacionados[0] ? (
                  <aside className="mt-10 rounded-lg border border-border bg-card p-6">
                    <p className="brand-eyebrow text-muted-foreground">Continue lendo</p>
                    <h3 className="mt-2 font-display text-lg text-foreground">
                      {guia.relacionados[0].titulo}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {guia.relacionados[0].descricao}
                    </p>
                    <LinkCta
                      to={guia.relacionados[0].to}
                      ctaId={guia.relacionados[0].ctaId}
                      className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Ler o guia
                    </LinkCta>
                  </aside>
                ) : null}
              </section>
            ))}

            {/* CTA comercial forte */}
            <aside className="mt-16 rounded-xl border border-primary/30 bg-secondary/50 p-8">
              <h2 className="font-display text-2xl leading-snug text-foreground">
                {guia.ctaFinal.titulo}
              </h2>
              <p className="mt-3 text-[0.98rem] leading-relaxed text-foreground/85">
                {guia.ctaFinal.texto}
              </p>
              <LinkCta
                to="/seja-lardan"
                ctaId={guia.ctaFinal.ctaId}
                className="btn-premium mt-6 inline-flex"
              >
                {guia.ctaFinal.rotulo}
              </LinkCta>
              <p className="mt-3 text-xs text-muted-foreground">
                Cadastro sujeito à análise. A Lardan não promete renda: resultado depende de
                vendas, rotina, clientes e execução.
              </p>
            </aside>

            {/* FAQ visível */}
            <section id="perguntas-frequentes" className="mt-16 scroll-mt-28">
              <h2 className="font-display text-[clamp(1.35rem,2.6vw,1.9rem)] leading-snug text-foreground">
                {guia.faqTitulo}
              </h2>
              <dl className="mt-6 divide-y divide-border border-y border-border">
                {guia.faq.map((f) => (
                  <div key={f.pergunta} className="py-6">
                    <dt className="font-medium text-foreground">{f.pergunta}</dt>
                    <dd className="mt-2 text-[0.95rem] leading-[1.7] text-foreground/80">
                      {f.resposta}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* Fontes */}
            {fontes.length > 0 ? (
              <section className="mt-16">
                <h2 className="font-display text-xl text-foreground">Fontes e referências</h2>
                <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                  {fontes.map((f) => (
                    <li key={f.chave}>
                      <span className="text-foreground/80">{f.instituicao}</span>
                      {". "}
                      {f.url.startsWith("http") ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-4"
                        >
                          {f.titulo}
                        </a>
                      ) : (
                        <Link to={f.url} className="underline underline-offset-4">
                          {f.titulo}
                        </Link>
                      )}
                      {` (${f.ano}).`}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Autor */}
            <section className="mt-16 rounded-xl border border-border bg-card p-6">
              <h2 className="font-display text-xl text-foreground">Sobre o autor</h2>
              <div className="mt-4 flex flex-wrap items-start gap-5">
                <img
                  src={RETRATO_AUTOR.url}
                  alt={RETRATO_AUTOR.alt}
                  width={RETRATO_AUTOR.width}
                  height={RETRATO_AUTOR.height}
                  loading="lazy"
                  className="h-20 w-20 rounded-full object-cover object-top"
                />
                <div className="min-w-[14rem] flex-1">
                  <p className="font-medium text-foreground">{DANIEL.nome}</p>
                  <p className="text-sm text-muted-foreground">{DANIEL.cargo}</p>
                  <p className="mt-3 text-sm leading-relaxed text-foreground/80">{BIO_AUTOR}</p>
                  <Link
                    to="/a-lardan"
                    className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Conheça a história de Daniel e da Lardan
                  </Link>
                </div>
              </div>
            </section>

            {/* Próximos guias */}
            <section className="mt-16">
              <h2 className="font-display text-xl text-foreground">Continue pelo próximo guia</h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {guia.relacionados.map((r) => (
                  <LinkCta
                    key={r.to}
                    to={r.to}
                    ctaId={r.ctaId}
                    className="group rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
                  >
                    <span className="block font-display text-base text-foreground">{r.titulo}</span>
                    <span className="mt-2 block text-sm text-muted-foreground">{r.descricao}</span>
                  </LinkCta>
                ))}
              </div>
            </section>
          </div>
        </div>
      </article>
    </SiteLayout>
  );
}

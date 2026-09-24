import { Link } from "@tanstack/react-router";
import heroAsset from "@/assets/lardan-consultora-hero.webp.asset.json";
import vidaRealAsset from "@/assets/lardan-consultora-vida-real.webp.asset.json";
import ferramentasAsset from "@/assets/lardan-consultora-ferramentas.webp.asset.json";

const heroImg = heroAsset.url;
const vidaRealImg = vidaRealAsset.url;
const ferramentasImg = ferramentasAsset.url;
import cinematicVideo from "@/assets/lardan-seja-cinematico.mp4.asset.json";
import cinematicVideoWebm from "@/assets/lardan-seja-cinematico.webm.asset.json";
import { VideoFundo } from "./VideoFundo";
import cinematicPoster from "@/assets/lardan-seja-cinematico-poster.webp.asset.json";
import perfilVideo from "@/assets/lardan-perfil-cinematico.mp4.asset.json";
import perfilVideoWebm from "@/assets/lardan-perfil-cinematico.webm.asset.json";
import perfilPoster from "@/assets/lardan-perfil-cinematico-poster.webp.asset.json";
import { ATRIBUTOS, FAQ, FERRAMENTAS, PROCESSO, TREINAMENTOS } from "@/lib/seja-lardan-conteudo";
import { CinematicTitle } from "./CinematicTitle";

/* ---------------------------------- Hero --------------------------------- */

export function SejaHero() {
  return (
    <section
      id="inicio"
      aria-labelledby="seja-lardan-titulo"
      className="mx-auto grid max-w-6xl items-center gap-10 px-6 pt-28 pb-16 md:grid-cols-2 md:pt-36 md:gap-16 md:pb-24"
    >
      <div>
        <p className="brand-eyebrow mb-4">Seja Lardan</p>
        <CinematicTitle
          as="h1"
          id="seja-lardan-titulo"
          className="text-4xl leading-[1.05] text-foreground md:text-6xl"
        >
          Todo brilho começa em um lar.
        </CinematicTitle>
        <div className="rose-rule mt-8 w-20" />
        <p className="seja-promise mt-7 font-display text-[clamp(1.375rem,2.6vw,2rem)] leading-[1.25] tracking-tight">
          Aumente sua renda familiar!
        </p>
        <p className="seja-garantia mt-5 inline-flex items-center gap-2.5">
          <span aria-hidden className="seja-garantia-dot" />
          Semijoias com dois anos de garantia
        </p>
        <p className="seja-proof mt-6 flex max-w-lg flex-wrap items-baseline gap-x-3 gap-y-1 text-base leading-snug text-muted-foreground">
          <span>Mais de</span>
          <strong className="seja-proof-number">2.500</strong>
          <span>consultoras já brilharam com a Lardan.</span>
        </p>
        <p className="mt-7 max-w-lg text-base leading-relaxed text-muted-foreground">
          Seja Consultora Lardan e tenha produto, tecnologia, treinamento e ferramentas para
          transformar relacionamento em negócio.
        </p>
        <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
          Você não precisa fazer tudo sozinha. A Lardan coloca uma estrutura inteira ao seu lado
          para ajudar você a vender, organizar e crescer.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-5">
          <a href="#candidatura" className="btn-premium">
            Quero ser Lardan
          </a>
          <a
            href="#ferramentas"
            className="text-[0.6875rem] tracking-[0.22em] uppercase text-foreground/70 underline-offset-8 transition-colors hover:text-foreground hover:underline"
          >
            Conhecer minhas ferramentas
          </a>
        </div>
        <p className="mt-6 text-xs tracking-wide text-muted-foreground">
          Cadastro sujeito à análise.
        </p>
      </div>

      <img
        src={heroImg}
        alt="Mulher usando semijoias Lardan, sorrindo em ambiente iluminado por luz natural"
        width={1280}
        height={1600}
        fetchPriority="high"
        decoding="async"
        className="aspect-[4/5] w-full rounded-sm object-cover"
      />
    </section>
  );
}

/* ------------------------------- Emocional -------------------------------- */

export function SejaEmocional() {
  return (
    <section
      aria-labelledby="nao-e-so-vender"
      className="seja-cinematic-band relative isolate overflow-hidden border-t border-border"
    >
      <VideoFundo
        poster={cinematicPoster.url}
        webm={cinematicVideoWebm.url}
        mp4={cinematicVideo.url}
        className="absolute inset-0 -z-30 h-full w-full object-cover"
      />
      <div aria-hidden="true" className="seja-cinematic-band__veil absolute inset-0 -z-20" />
      <div aria-hidden="true" className="seja-cinematic-band__light absolute inset-0 -z-10" />
      <div className="mx-auto max-w-3xl px-6 py-24 md:py-36">
        <CinematicTitle id="nao-e-so-vender" className="text-3xl leading-tight text-ivory md:text-5xl">
          Não é apenas sobre vender semijoias.
        </CinematicTitle>
        <p className="mt-7 max-w-2xl font-display text-[clamp(1.125rem,2.4vw,1.625rem)] leading-[1.42] tracking-tight text-ivory">
          Por trás de cada maleta, existe uma história sendo transformada:{" "}
          <span className="text-ivory/78">
            consultoras que conquistaram sua moto, sua geladeira, suas viagens — sonhos pagos com o
            fruto do próprio trabalho
          </span>
        </p>
        <div className="rose-rule mt-8 w-20" />
        <div className="mt-8 space-y-5 text-base leading-relaxed text-ivory/72">
          <p>
            É sobre ter liberdade para criar novas possibilidades com aquilo que você sabe fazer de
            melhor: se conectar com pessoas.
          </p>
          <p>
            Pode ser para complementar a renda. Pode ser para conquistar algo que ficou para
            depois. Pode ser para contribuir ainda mais com a sua família. Ou pode ser o começo de
            um negócio que você ainda nem imaginou construir.
          </p>
          <p className="text-ivory">
            A sua motivação é sua. A estrutura para começar pode ser Lardan.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ----------------------- Resposta direta (SEO/IA) ------------------------- */

export function SejaDefinicao() {
  return (
    <section aria-labelledby="o-que-e-consultora" className="border-t border-border">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <CinematicTitle id="o-que-e-consultora" className="text-2xl text-foreground md:text-4xl">
          O que é uma Consultora Lardan?
        </CinematicTitle>
        <p className="mt-6 text-base leading-relaxed text-foreground">
          Uma Consultora Lardan comercializa semijoias da marca e utiliza a estrutura comercial e
          tecnológica disponibilizada pela Lardan para organizar produtos, clientes, vendas e seu
          desenvolvimento dentro da rede.
        </p>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Não é emprego com carteira assinada nem vaga de trabalho: é uma parceria comercial. A
          consultora vende com o próprio relacionamento — presencialmente, pelo WhatsApp ou pelas
          redes — e conta com o catálogo, a garantia e as ferramentas da marca para atender melhor.
          Conheça também{" "}
          <Link to="/a-lardan" className="underline underline-offset-4 hover:text-foreground">
            a história da Lardan
          </Link>{" "}
          e{" "}
          <Link to="/semijoias" className="underline underline-offset-4 hover:text-foreground">
            as peças que você vai apresentar
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

/* ------------------------------ Ferramentas -------------------------------- */

export function SejaFerramentas() {
  return (
    <section
      id="ferramentas"
      aria-labelledby="estrutura-para-vender"
      className="scroll-mt-24 border-t border-border bg-background"
    >
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="brand-eyebrow mb-4">Estrutura Lardan</p>
          <CinematicTitle
            id="estrutura-para-vender"
            className="text-3xl leading-tight text-foreground md:text-5xl"
          >
            Você não recebe apenas produtos. Recebe uma estrutura para vender.
          </CinematicTitle>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground">
            Tecnologia por trás. Simplicidade na sua mão. Abaixo, o que o ecossistema Lardan
            coloca na mão da consultora.
          </p>
        </div>

        <div className="mt-16 grid gap-12 md:grid-cols-[1fr_1.1fr] md:items-start md:gap-16">
          <img
            src={ferramentasImg}
            alt="Consultora Lardan organizando suas vendas pelo celular, com peças em uma bandeja ao lado"
            width={1408}
            height={1008}
            loading="lazy"
            decoding="async"
            className="w-full rounded-sm object-cover md:sticky md:top-28"
          />

          <ul className="space-y-10">
            {FERRAMENTAS.map((f) => (
              <li key={f.chave} className="border-b border-border pb-10 last:border-b-0">
                <p className="brand-eyebrow mb-3">{f.eyebrow}</p>
                <CinematicTitle as="h3" className="text-xl leading-snug text-foreground md:text-2xl">{f.titulo}</CinematicTitle>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.texto}</p>
                <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs tracking-wide text-muted-foreground">
                  {f.itens.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="mt-4 text-[0.6875rem] tracking-[0.14em] uppercase text-muted-foreground/80">
                  Ecossistema Lardan
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- Academy -------------------------------- */

export function SejaAcademy() {
  return (
    <section aria-labelledby="lardan-academy" className="border-t border-border bg-secondary/40">
      <div className="mx-auto max-w-4xl px-6 py-24 text-center md:py-32">
        <p className="brand-eyebrow mb-4">Lardan Academy</p>
        <CinematicTitle id="lardan-academy" className="text-3xl leading-tight text-foreground md:text-5xl">
          Quem cresce precisa continuar aprendendo.
        </CinematicTitle>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
          Produto é apenas uma parte da venda. Atendimento, relacionamento, imagem, organização e
          conhecimento também fazem diferença.
        </p>
        <ul className="mx-auto mt-10 flex max-w-2xl flex-wrap justify-center gap-x-8 gap-y-3 text-[0.6875rem] tracking-[0.2em] uppercase text-foreground/70">
          {TREINAMENTOS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <a href="#candidatura" className="btn-premium mt-12">
          Quero crescer com a Lardan
        </a>
      </div>
    </section>
  );
}

/* --------------------------------- Produto -------------------------------- */

export function SejaProduto() {
  return (
    <section aria-labelledby="produto-que-vende" className="border-t border-border">
      <div className="mx-auto max-w-4xl px-6 py-24 text-center md:py-32">
        <p className="brand-eyebrow mb-4">Produto Lardan</p>
        <CinematicTitle id="produto-que-vende" className="text-3xl leading-tight text-foreground md:text-5xl">
          Tecnologia ajuda. Mas tudo começa com um produto que dá orgulho de apresentar.
        </CinematicTitle>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
          Design autoral, acabamento cuidadoso, variedade de peças e coleções pensadas para
          acompanhar momentos reais — com <strong className="text-foreground">2 anos de
          garantia</strong>, conforme as condições oficiais informadas pela marca.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-5">
          <Link to="/semijoias" className="btn-premium">
            Conheça nossas peças
          </Link>
          <Link
            to="/colecoes"
            className="text-[0.6875rem] tracking-[0.22em] uppercase text-foreground/70 underline-offset-8 transition-colors hover:text-foreground hover:underline"
          >
            Ver coleções
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- Vida real ------------------------------- */

export function SejaVidaReal() {
  return (
    <section aria-labelledby="vida-real" className="border-t border-border bg-background">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 md:grid-cols-2 md:gap-16 md:py-32">
        <img
          src={vidaRealImg}
          alt="Consultora Lardan apresentando semijoias a uma cliente em casa"
          width={1600}
          height={1104}
          loading="lazy"
          decoding="async"
          className="w-full rounded-sm object-cover"
        />
        <div>
          <CinematicTitle id="vida-real" className="text-3xl leading-tight text-foreground md:text-5xl">
            Seu negócio precisa caber na sua vida — e não o contrário.
          </CinematicTitle>
          <div className="rose-rule mt-8 w-20" />
          <div className="mt-8 space-y-5 text-base leading-relaxed text-muted-foreground">
            <p>Cada consultora tem uma história, uma rotina e um motivo para começar.</p>
            <p>
              A Lardan quer colocar produto, informação e tecnologia na sua mão para que você
              consiga desenvolver seu negócio com mais organização e clareza.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Perfil / corte --------------------------- */

export function SejaPerfil() {
  return (
    <section
      aria-labelledby="nao-e-para-qualquer-um"
      className="seja-perfil-band relative isolate overflow-hidden border-t border-border text-ivory"
    >
      <VideoFundo
        poster={perfilPoster.url}
        webm={perfilVideoWebm.url}
        mp4={perfilVideo.url}
        className="absolute inset-0 -z-30 h-full w-full object-cover"
      />
      <div aria-hidden="true" className="seja-perfil-band__veil absolute inset-0 -z-20" />
      <div aria-hidden="true" className="seja-perfil-band__light absolute inset-0 -z-10" />
      <div className="mx-auto max-w-4xl px-6 py-24 text-center md:py-36">
        <CinematicTitle
          id="nao-e-para-qualquer-um"
          className="text-3xl leading-tight md:text-5xl"
        >
          Ser Lardan não é para qualquer pessoa.
        </CinematicTitle>
        <p className="mt-4 text-lg opacity-80">É para quem quer construir.</p>
        <div className="mx-auto mt-8 max-w-xl space-y-4 text-base leading-relaxed opacity-75">
          <p>
            Procuramos pessoas que entendam que resultado nasce de relacionamento, consistência,
            atendimento e vontade de evoluir.
          </p>
          <p>
            Você não precisa chegar sabendo tudo. Mas precisa chegar querendo fazer acontecer.
          </p>
        </div>
        <ul className="mx-auto mt-12 flex max-w-2xl flex-wrap justify-center gap-x-8 gap-y-3 text-[0.6875rem] tracking-[0.24em] uppercase opacity-70">
          {ATRIBUTOS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <a
          href="#candidatura"
          className="mt-12 inline-flex h-12 items-center rounded-full bg-background px-8 text-[0.6875rem] tracking-[0.22em] uppercase text-foreground transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-background"
        >
          Quero me candidatar
        </a>
      </div>
    </section>
  );
}

/* -------------------------------- Processo -------------------------------- */

export function SejaProcesso() {
  return (
    <section aria-labelledby="como-funciona" className="border-t border-border">
      <div className="mx-auto max-w-5xl px-6 py-24 md:py-32">
        <CinematicTitle id="como-funciona" className="max-w-2xl text-3xl leading-tight text-foreground md:text-5xl">
          Como funciona para se tornar Consultora Lardan?
        </CinematicTitle>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
          Queremos construir uma rede forte. Por isso, cada candidatura passa por uma análise —
          feita por pessoas, sem decisão automática.
        </p>
        <ol className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {PROCESSO.map((p, i) => (
            <li key={p.passo} className="border-t border-border pt-5">
              <span className="brand-eyebrow">{String(i + 1).padStart(2, "0")}</span>
              <CinematicTitle as="h3" className="mt-2 text-lg text-foreground">{p.passo}</CinematicTitle>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{p.texto}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ----------------------------------- FAQ ---------------------------------- */

export function SejaFaq() {
  return (
    <section aria-labelledby="faq" className="border-t border-border bg-secondary/40">
      <div className="mx-auto max-w-3xl px-6 py-24 md:py-32">
        <p className="brand-eyebrow mb-4">Perguntas frequentes</p>
        <CinematicTitle id="faq" className="text-3xl leading-tight text-foreground md:text-5xl">
          Dúvidas sobre ser Consultora Lardan
        </CinematicTitle>
        <dl className="mt-12 divide-y divide-border border-t border-border">
          {FAQ.map((item) => (
            <div key={item.pergunta} className="py-6">
              <dt className="text-base text-foreground md:text-lg">{item.pergunta}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.resposta}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

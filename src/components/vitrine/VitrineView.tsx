import * as React from "react";
import { Clock, Facebook, Instagram, MapPin, MessageCircle, Music2, Share2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { brl, imagem, type VitrineItem } from "@/lib/maletas";
import { CAPAS, designPadrao, whatsappLink, type DesignVitrine } from "@/lib/vitrine-design";

type Item = VitrineItem & { midias?: string[] };

export interface VitrineViewProps {
  design: Partial<DesignVitrine> | null | undefined;
  nome: string;
  itens: Item[];
  /** converte caminho guardado em endereço de imagem */
  img: (path?: string | null) => string | null;
  previa?: boolean;
  urlCompartilhar?: string;
}

/** Página da vitrine: a mesma peça é usada na página pública e na prévia do estúdio. */
export function VitrineView({ design, nome, itens, img, previa = false, urlCompartilhar }: VitrineViewProps) {
  const d = designPadrao(design ?? undefined);
  const a = d.aparencia;
  const o = d.organizacao;
  const nomePublico = d.perfil.nome || nome;
  const primeiroNome = nomePublico.split(" ")[0] || "a consultora";
  const zap = whatsappLink(d.contato.whatsapp);
  const [sacola, setSacola] = React.useState<Record<string, number>>({});
  const [categoria, setCategoria] = React.useState("todas");

  const visiveis = itens.filter((i) => !o.ocultas.includes(i.variant_id));
  const porId = new Map(visiveis.map((i) => [i.variant_id, i]));
  const destaques = o.destaques.map((id) => porId.get(id)).filter(Boolean) as Item[];
  const categorias = Array.from(new Set(visiveis.map((i) => i.categoria).filter(Boolean))) as string[];
  const catalogo = categoria === "todas" ? visiveis : visiveis.filter((i) => i.categoria === categoria);

  const foto = (i: Item) => { const f = o.fotos[i.variant_id]; return imagem(f && i.midias?.includes(f) ? f : i.media_id); };
  const pecas = Object.values(sacola).reduce((x, y) => x + y, 0);
  const total = visiveis.reduce((s, i) => s + (sacola[i.variant_id] ?? 0) * i.preco_cents, 0);

  const enviar = () => {
    if (!zap || previa) return;
    const linhas = visiveis
      .filter((i) => sacola[i.variant_id])
      .map((i) => {
        const det = [i.variante, i.tamanho, i.cor].filter(Boolean).join(" · ");
        return `• ${sacola[i.variant_id]}x ${i.produto}${det ? ` (${det})` : ""} — ${brl(i.preco_cents)}`;
      });
    const abertura = d.perfil.mensagem || `Olá, ${primeiroNome}! Vi sua vitrine Lardan e tenho interesse:`;
    const texto = `${abertura}\n${linhas.join("\n")}\n\nAinda está disponível?\n${window.location.href}`;
    window.open(`${zap}?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  };

  // capa
  const oficial = CAPAS.find((c) => c.id === d.imagens.capa?.preset);
  const capaD = oficial?.desktop ?? img(d.imagens.capa?.path);
  const capaM = oficial?.mobile ?? img(d.imagens.capa?.path_m ?? d.imagens.capa?.path);
  const fD = d.imagens.capa?.foco_desktop ?? { x: 50, y: 50 };
  const fM = d.imagens.capa?.foco_mobile ?? { x: 50, y: 50 };
  const retrato = img(d.imagens.avatar?.path);
  const retrato2x = img(d.imagens.avatar?.path2x);
  const iniciais = nomePublico.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

  const Capa = ({ alto }: { alto: string }) => (
    <div className={`relative w-full overflow-hidden ${alto}`} aria-hidden>
      {capaD || capaM ? (
        <>
          <img src={capaM ?? capaD!} alt="" className="absolute inset-0 size-full object-cover @3xl:hidden" style={{ objectPosition: `${fM.x}% ${fM.y}%` }} />
          <img src={capaD ?? capaM!} alt="" className="absolute inset-0 hidden size-full object-cover @3xl:block" style={{ objectPosition: `${fD.x}% ${fD.y}%` }} />
        </>
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,var(--v-surface),var(--v-bg)_60%),linear-gradient(135deg,var(--v-line),var(--v-bg))]">
          <div className="absolute inset-x-0 bottom-6 text-center text-[0.65rem] uppercase tracking-[0.5em] text-[var(--v-muted)]">Lardan</div>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--v-bg)]/50 to-transparent" />
    </div>
  );

  const Retrato = ({ tam }: { tam: string }) => (
    <div className={`${tam} shrink-0 overflow-hidden rounded-full border-4 border-[var(--v-bg)] bg-[var(--v-surface)] shadow-lg ring-1 ring-[var(--v-line)]`}>
      {retrato ? (
        <img src={retrato} srcSet={retrato2x ? `${retrato} 1x, ${retrato2x} 2x` : undefined} alt={`Foto de ${nomePublico}`} className="size-full object-cover" />
      ) : (
        <div className="v-titulo grid size-full place-items-center text-3xl text-[var(--v-accent)]">{iniciais || "L"}</div>
      )}
    </div>
  );

  const Info = ({ alinhar }: { alinhar: "centro" | "esquerda" }) => (
    <div className={alinhar === "centro" ? "text-center" : "text-left"}>
      <p className="text-[0.65rem] uppercase tracking-[0.35em] text-[var(--v-accent)]">Consultora Lardan</p>
      <h1 className={`v-titulo mt-2 break-words leading-tight ${a.tema === "editorial" ? "text-4xl @3xl:text-6xl" : "text-3xl @3xl:text-5xl"}`}>{nomePublico}</h1>
      {d.perfil.frase && <p className="mt-2 text-[var(--v-muted)]">{d.perfil.frase}</p>}
      {d.perfil.bio && <p className={`mt-4 max-w-xl whitespace-pre-line text-sm leading-relaxed ${alinhar === "centro" ? "mx-auto" : ""}`}>{d.perfil.bio}</p>}
      <ul className={`mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--v-muted)] ${alinhar === "centro" ? "justify-center" : ""}`}>
        {(d.perfil.cidade || d.perfil.regiao) && (
          <li className="flex items-center gap-1"><MapPin aria-hidden className="size-3.5" />{[d.perfil.cidade, d.perfil.regiao].filter(Boolean).join(" · ")}</li>
        )}
        {d.perfil.horarios && <li className="flex items-center gap-1"><Clock aria-hidden className="size-3.5" />{d.perfil.horarios}</li>}
      </ul>
      <div className={`mt-5 flex flex-wrap gap-2 ${alinhar === "centro" ? "justify-center" : ""}`}>
        {zap && (
          <a href={previa ? undefined : zap} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[var(--v-accent)] px-5 py-2.5 text-sm text-[var(--v-accent-ink)]">
            <MessageCircle aria-hidden className="size-4" /> Falar com {primeiroNome}
          </a>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--v-line)] px-4 py-2.5 text-sm"
          onClick={() => {
            if (previa) return;
            const url = urlCompartilhar ?? window.location.href;
            if (navigator.share) void navigator.share({ title: nomePublico, url }).catch(() => undefined);
            else { void navigator.clipboard.writeText(url); toast.success("Endereço copiado."); }
          }}
        >
          <Share2 aria-hidden className="size-4" /> Compartilhar
        </button>
        {d.contato.instagram && <Social href={`https://instagram.com/${d.contato.instagram}`} rotulo="Instagram" previa={previa}><Instagram className="size-4" /></Social>}
        {d.contato.facebook && <Social href={`https://facebook.com/${d.contato.facebook}`} rotulo="Facebook" previa={previa}><Facebook className="size-4" /></Social>}
        {d.contato.tiktok && <Social href={`https://tiktok.com/@${d.contato.tiktok}`} rotulo="TikTok" previa={previa}><Music2 className="size-4" /></Social>}
      </div>
    </div>
  );

  const cartao = a.cartao === "suave" ? "rounded-2xl bg-[var(--v-surface)] p-2 shadow-sm" : a.cartao === "moldura" ? "border border-[var(--v-line)] p-2" : "";
  const grade = a.grade === "lista" ? "grid grid-cols-1 gap-3" : a.grade === "2" ? "grid grid-cols-2 gap-4 @3xl:gap-6" : "grid grid-cols-2 gap-4 @3xl:grid-cols-3 @3xl:gap-6";

  const Grade = ({ lista }: { lista: Item[] }) => (
    <ul className={grade}>
      {lista.map((i) => {
        const q = sacola[i.variant_id] ?? 0;
        const src = foto(i);
        return (
          <li key={i.variant_id} className={`${cartao} ${a.grade === "lista" ? "flex gap-3" : "flex flex-col"}`}>
            <div className={`overflow-hidden bg-[var(--v-line)] ${a.cartao === "suave" ? "rounded-xl" : ""} ${a.grade === "lista" ? "size-24 shrink-0" : a.tema === "editorial" ? "aspect-[3/4]" : "aspect-square"}`}>
              {src && <img src={src} alt={i.produto} loading="lazy" className="size-full object-cover" />}
            </div>
            <div className={a.grade === "lista" ? "flex-1 py-1" : "px-1 pb-1 pt-3"}>
              <p className="text-sm font-medium leading-snug">{i.produto}</p>
              <p className="text-xs text-[var(--v-muted)]">{[i.variante, i.tamanho, i.cor].filter(Boolean).join(" · ") || "Peça única"}</p>
              <p className="mt-1 text-sm font-semibold">{brl(i.preco_cents)}</p>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" aria-label="Tirar uma" className="size-8 rounded-full border border-[var(--v-line)]" onClick={() => setSacola((s) => ({ ...s, [i.variant_id]: Math.max(q - 1, 0) }))}>−</button>
                <span className="w-6 text-center text-sm tabular-nums">{q}</span>
                <button type="button" aria-label="Adicionar uma" className="size-8 rounded-full border border-[var(--v-line)]" onClick={() => setSacola((s) => ({ ...s, [i.variant_id]: Math.min(q + 1, i.disponivel) }))}>+</button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );

  const Titulo = ({ children }: { children: React.ReactNode }) => (
    <h2 className={`v-titulo mb-5 ${a.tema === "minimalista" ? "text-center text-sm uppercase tracking-[0.3em]" : "text-2xl"}`}>{children}</h2>
  );

  const secoes = o.secoes.map((s) => {
    if (s === "destaques") {
      if (!destaques.length) return previa ? <Vazio key={s} texto="Peças em destaque: escolha peças em “Organização”. Vazia, esta parte não aparece para clientes." /> : null;
      return <section key={s} className="mt-14"><Titulo>Destaques de {primeiroNome}</Titulo><Grade lista={destaques} /></section>;
    }
    if (s === "selecoes") {
      return o.selecoes.map((sel, idx) => {
        const lista = sel.itens.map((id) => porId.get(id)).filter(Boolean) as Item[];
        if (!lista.length) return previa ? <Vazio key={`${s}${idx}`} texto={`“${sel.titulo}” está vazia ou sem peças disponíveis agora. Vazia, ela não aparece para clientes.`} /> : null;
        return <section key={`${s}${idx}`} className="mt-14"><Titulo>{sel.titulo}</Titulo><Grade lista={lista} /></section>;
      });
    }
    return (
      <section key={s} className="mt-14">
        <Titulo>Todas as peças</Titulo>
        {categorias.length > 1 && (
          <nav className={`mb-6 flex flex-wrap gap-2 ${a.tema === "minimalista" ? "justify-center" : ""}`}>
            {["todas", ...categorias].map((c) => (
              <button key={c} type="button" onClick={() => setCategoria(c)} className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-widest ${categoria === c ? "border-[var(--v-ink)]" : "border-[var(--v-line)] text-[var(--v-muted)]"}`}>
                {c === "todas" ? "Todas" : c}
              </button>
            ))}
          </nav>
        )}
        {catalogo.length ? <Grade lista={catalogo} /> : (
          <p className="py-10 text-center text-sm text-[var(--v-muted)]">Nenhuma peça disponível nesta vitrine agora. Fale comigo pelo WhatsApp que eu te aviso quando chegar novidade.</p>
        )}
      </section>
    );
  });

  return (
    <div className={`vitrine-raiz @container vp-${a.paleta} vf-${a.fonte} min-h-full`}>
      {a.tema === "classica" && (
        <header>
          <Capa alto="h-44 @3xl:h-72" />
          <div className="mx-auto -mt-14 max-w-4xl px-5 @3xl:-mt-20">
            <div className="flex justify-center"><Retrato tam="size-28 @3xl:size-36" /></div>
            <div className="mt-4"><Info alinhar="centro" /></div>
          </div>
        </header>
      )}
      {a.tema === "editorial" && (
        <header className="@3xl:grid @3xl:grid-cols-[1.15fr_1fr] @3xl:items-center">
          <Capa alto="h-72 @3xl:h-[34rem]" />
          <div className="px-5 py-8 @3xl:px-12">
            <Retrato tam="size-20 @3xl:size-24" />
            <div className="mt-5"><Info alinhar="esquerda" /></div>
          </div>
        </header>
      )}
      {a.tema === "minimalista" && (
        <header className="mx-auto max-w-2xl px-5 pt-14 @3xl:pt-24">
          <div className="flex justify-center"><Retrato tam="size-24" /></div>
          <div className="mt-6"><Info alinhar="centro" /></div>
          {(capaD || capaM) && <div className="mt-10 overflow-hidden rounded-sm"><Capa alto="h-40 @3xl:h-56" /></div>}
        </header>
      )}

      <main className={`mx-auto px-5 pb-36 ${a.tema === "minimalista" ? "max-w-3xl" : "max-w-5xl"}`}>{secoes}</main>

      {pecas > 0 && (
        <section className={`${previa ? "sticky" : "fixed inset-x-0"} bottom-0 border-t border-[var(--v-line)] bg-[var(--v-bg)]/95 p-4 backdrop-blur`}>
          <div className="mx-auto w-full max-w-3xl space-y-3">
            <p className="text-sm"><ShoppingBag aria-hidden className="mr-1 inline size-4" />{pecas} peça(s) · <strong>{brl(total)}</strong></p>
            <button type="button" disabled={!zap} onClick={enviar} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--v-accent)] px-4 py-3 text-sm text-[var(--v-accent-ink)] disabled:opacity-50">
              <MessageCircle aria-hidden className="size-4" /> Enviar interesse para {primeiroNome}
            </button>
            <p className="text-[0.7rem] text-[var(--v-muted)]">Sua seleção fica só neste aparelho e não reserva peças. A disponibilidade é confirmada no atendimento.</p>
          </div>
        </section>
      )}
    </div>
  );
}

function Social({ href, rotulo, previa, children }: { href: string; rotulo: string; previa: boolean; children: React.ReactNode }) {
  return (
    <a href={previa ? undefined : href} target="_blank" rel="noreferrer" aria-label={rotulo} className="grid size-10 place-items-center rounded-full border border-[var(--v-line)]">
      {children}
    </a>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="mt-10 rounded-xl border border-dashed border-[var(--v-line)] p-5 text-center text-xs text-[var(--v-muted)]">{texto}</p>;
}

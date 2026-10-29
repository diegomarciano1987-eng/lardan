import * as React from "react";
import { Button } from "@/components/ui/button";
import { MANUAL_CUIDADOS_URL } from "@/lib/consultora-regras";
import { Check, Clock, Gem, Instagram, MessageCircle, Share2, ShieldCheck, ShoppingBag, User } from "lucide-react";
import { toast } from "sonner";
import { brl, imagem, type VitrineItem } from "@/lib/maletas";

import { designPadrao, whatsappLink, type DesignVitrine } from "@/lib/vitrine-design";

type Item = VitrineItem & { midias?: string[]; ilustracao?: string | null };

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
  const [noCorpo, setNoCorpo] = React.useState<Record<string, boolean>>({});

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

  // capa padrão LARDAN: fixa; só foto, nome, frase, horário e contatos vêm da consultora
  const retrato = img(d.imagens.avatar?.path);
  const retrato2x = img(d.imagens.avatar?.path2x);
  const iniciais = nomePublico.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();


  const cartao = a.cartao === "suave" ? "rounded-2xl bg-[var(--v-surface)] p-2 shadow-sm" : a.cartao === "moldura" ? "border border-[var(--v-line)] p-2" : "";
  const grade = a.grade === "lista" ? "grid grid-cols-1 gap-3" : a.grade === "2" ? "grid grid-cols-2 gap-4 @3xl:gap-6" : "grid grid-cols-2 gap-4 @3xl:grid-cols-3 @3xl:gap-6";

  const Grade = ({ lista }: { lista: Item[] }) => (
    <ul className={grade}>
      {lista.map((i) => {
        const q = sacola[i.variant_id] ?? 0;
        const principal = foto(i);
        const midias = i.midias ?? [];
        const corpoId = midias.length > 1 ? (midias.find((m) => m !== (principal ? principal.split("/").pop() : "")) ?? null) : null;
        const verCorpo = !!corpoId && !!noCorpo[i.variant_id];
        const real = verCorpo ? imagem(corpoId) : principal;
        const src = real ?? i.ilustracao ?? null;
        return (
          <li id={`peca-${i.variant_id}`} key={i.variant_id} className={`${cartao} ${a.grade === "lista" ? "flex gap-3" : "flex flex-col"}`}>
            <div className={`relative overflow-hidden bg-[var(--v-line)] ${a.cartao === "suave" ? "rounded-xl" : ""} ${a.grade === "lista" ? "size-24 shrink-0" : a.tema === "editorial" ? "aspect-[3/4]" : "aspect-square"}`}>
              {src && <img src={src} alt={verCorpo ? `${i.produto} no corpo` : i.produto} loading="lazy" width={800} height={800} className="size-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
              {corpoId && a.grade !== "lista" && (
                <div role="group" aria-label="Escolher foto" className="absolute bottom-2 left-1/2 flex -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--v-bg)]/90 p-0.5 text-[0.68rem] font-semibold shadow-sm backdrop-blur">
                  {([["Peça", false], ["No corpo", true]] as const).map(([rot, val]) => (
                    <button key={rot} type="button" aria-pressed={verCorpo === val}
                      onClick={() => setNoCorpo((s) => ({ ...s, [i.variant_id]: val }))}
                      className={`min-h-7 whitespace-nowrap rounded-full px-2.5 ${verCorpo === val ? "bg-[var(--v-ink)] text-[var(--v-bg)]" : "text-[var(--v-ink)]"}`}>
                      {rot}
                    </button>
                  ))}
                </div>
              )}
              {!real && i.ilustracao && (
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-[var(--v-bg)]/85 px-2 py-0.5 text-[0.6rem] font-medium tracking-wide text-[var(--v-muted)]">
                  Imagem ilustrativa
                </span>
              )}
            </div>
            <div className={a.grade === "lista" ? "flex-1 py-1" : "px-1 pb-1 pt-3"}>
              <p className="text-sm font-medium leading-snug">{i.produto}</p>
              <p className="text-xs text-[var(--v-muted)]">{[i.variante, i.tamanho, i.cor].filter(Boolean).join(" · ") || "Peça única"}</p>
              <p className="mt-1 text-sm font-semibold">{brl(i.preco_cents)}</p>
              <a href={MANUAL_CUIDADOS_URL} target="_blank" rel="noreferrer" className="mt-2 block text-sm underline underline-offset-4">Garantia de dois anos e cuidados</a>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="outline" className="h-auto min-h-12 whitespace-normal"><a href={zap ? `${zap}${zap.includes("?") ? "&" : "?"}text=${encodeURIComponent(`Olá! Quero esta peça: ${i.produto}${i.variante ? ` (${i.variante})` : ""}, ${brl(i.preco_cents)}. Você confirma a disponibilidade?`)}` : undefined} aria-disabled={!zap} target="_blank" rel="noreferrer"><MessageCircle /> Quero esta</a></Button>
                <Button asChild variant="outline" className="h-auto min-h-12 whitespace-normal"><a href={`https://wa.me/?text=${encodeURIComponent(`${i.produto}${i.variante ? ` · ${i.variante}` : ""}\n${brl(i.preco_cents)}${real ? `\nFoto: ${real}` : ""}\n${urlCompartilhar ? `${urlCompartilhar.split("#")[0]}#peca-${i.variant_id}` : ""}`)}`} target="_blank" rel="noreferrer"><Share2 /> Enviar esta peça</a></Button>
              </div>
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
        {!catalogo.length ? (
          <p className="py-10 text-center text-sm text-[var(--v-muted)]">Nenhuma peça disponível nesta vitrine agora. Fale comigo pelo WhatsApp que eu te aviso quando chegar novidade.</p>
        ) : categoria === "todas" && categorias.length > 1 ? (
          <div className="space-y-12">
            {[...categorias, ...(visiveis.some((i) => !i.categoria) ? [""] : [])].map((c) => {
              const lista = visiveis.filter((i) => (i.categoria || "") === c);
              if (!lista.length) return null;
              return (
                <div key={c || "outras"}>
                  <div className={`mb-5 flex items-center gap-4 ${a.tema === "minimalista" ? "justify-center" : ""}`}>
                    <h3 className="text-sm uppercase tracking-[0.3em]">{c || "Outras peças"}</h3>
                    <span className="h-px flex-1 bg-[var(--v-line)]" />
                    <span className="text-xs text-[var(--v-muted)]">{lista.length} {lista.length === 1 ? "peça" : "peças"}</span>
                  </div>
                  <Grade lista={lista} />
                </div>
              );
            })}
          </div>
        ) : <Grade lista={catalogo} />}
      </section>
    );
  });

  return (
    <div className={`vitrine-raiz @container vp-${a.paleta} vf-${a.fonte} ${previa ? "min-h-full" : "min-h-screen"}`}>
      <CapaPadrao
        nome={nomePublico} primeiroNome={primeiroNome} frase={d.perfil.frase} horarios={d.perfil.horarios}
        retrato={retrato} retrato2x={retrato2x} iniciais={iniciais || "L"} zap={zap} previa={previa}
        instagram={d.contato.instagram ? `https://instagram.com/${d.contato.instagram}` : null}
        onCompartilhar={() => {
          if (previa) return;
          const url = urlCompartilhar ?? window.location.href;
          if (navigator.share) void navigator.share({ title: nomePublico, url }).catch(() => undefined);
          else { void navigator.clipboard.writeText(url); toast.success("Endereço copiado."); }
        }}
      />

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


function Vazio({ texto }: { texto: string }) {
  return <p className="mt-10 rounded-xl border border-dashed border-[var(--v-line)] p-5 text-center text-xs text-[var(--v-muted)]">{texto}</p>;
}

const DIAMANTE = "M1630.77 2206.02 L3234.59 571.13 L2745.19 39.33 C2689.54 0.00 2680.73 8.47 2611.25 6.59 L623.91 0.00 C529.40 3.58 518.74 14.66 456.27 77.71 L0.00 569.57 L1630.77 2206.02 Z M3088.46 508.52 L1055.74 524.95 L628.81 80.37 L2673.13 80.37 L3088.46 508.52 Z M1632.59 2095.46 L96.18 573.14 L540.26 111.16 L2081.74 1635.60 L1632.59 2095.46 Z M1147.10 590.34 L2091.57 590.34 L1619.35 1082.59 L1147.10 590.34 Z M1672.92 1130.71 L2184.21 590.34 L3130.64 590.34 L2126.41 1605.41 L1672.92 1130.71 Z";

/** Capa oficial LARDAN — igual para todas as vitrines; nada aqui é configurável pela consultora. */
function CapaPadrao(p: {
  nome: string; primeiroNome: string; frase?: string | null; horarios?: string | null;
  retrato: string | null; retrato2x: string | null; iniciais: string;
  zap: string | null; instagram: string | null; previa: boolean; onCompartilhar: () => void;
}) {
  return (
    <header className="capa-lardan">
      <div className="cl-faixa">
        <svg className="cl-marca" viewBox="0 0 3234.59 2206.02" aria-hidden="true"><path fillRule="evenodd" fill="currentColor" d={DIAMANTE} /></svg>
        <div className="relative flex h-full flex-col items-center pt-10 @3xl:pt-11">
          <p className="cl-serif cl-logo" aria-label="Lardan">LARDAN</p>
          <p className="cl-semi mt-4 uppercase">Semijoias</p>
          <p className="cl-oficial mt-7 flex items-center gap-3 uppercase"><span className="cl-traco" aria-hidden />Vitrine oficial<span className="cl-traco" aria-hidden /></p>
        </div>
      </div>
      <div className="mx-auto flex max-w-2xl flex-col items-center px-6 pb-2 text-center">
        <div className="cl-foto">
          <div className="cl-foto-in">
            {p.retrato ? (
              <img src={p.retrato} srcSet={p.retrato2x ? `${p.retrato} 1x, ${p.retrato2x} 2x` : undefined} alt={`Foto de ${p.nome}`} width={152} height={152} className="size-full object-cover" />
            ) : (
              <span className="cl-serif grid size-full place-items-center text-4xl text-[var(--c-caramelo)]">{p.iniciais}</span>
            )}
          </div>
          <span className="cl-selo" title="Consultora verificada"><Check aria-hidden className="size-4" strokeWidth={3} /><span className="sr-only">Consultora verificada</span></span>
        </div>
        <p className="cl-rotulo mt-6">Consultora oficial Lardan</p>
        <h1 className="cl-serif cl-nome mt-2 break-words">{p.nome}</h1>
        {p.frase && <p className="cl-frase mt-3 max-w-md">{p.frase}</p>}
        {p.horarios && <p className="cl-pilula mt-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5"><Clock aria-hidden className="size-4" />{p.horarios}</p>}
        <div className="mt-6 w-full space-y-3 @3xl:flex @3xl:items-center @3xl:justify-center @3xl:gap-3 @3xl:space-y-0">
          {p.zap && (
            <a href={p.previa ? undefined : p.zap} target="_blank" rel="noreferrer" className="cl-zap flex w-full items-center justify-center gap-2.5 rounded-full px-6 @3xl:w-auto">
              <MessageCircle aria-hidden className="size-5" /> Falar com {p.primeiroNome} no WhatsApp
            </a>
          )}
          <div className={`grid gap-3 ${p.instagram ? "grid-cols-2" : "grid-cols-1"} @3xl:flex`}>
            <button type="button" onClick={p.onCompartilhar} className="cl-sec inline-flex items-center justify-center gap-2 rounded-full px-6"><Share2 aria-hidden className="size-4" /> Compartilhar</button>
            {p.instagram && <a href={p.previa ? undefined : p.instagram} target="_blank" rel="noreferrer" className="cl-sec inline-flex items-center justify-center gap-2 rounded-full px-6"><Instagram aria-hidden className="size-4" /> Instagram</a>}
          </div>
        </div>
        <ul className="cl-confianca mt-7 grid w-full grid-cols-3 gap-2 py-4 text-[12px] leading-snug @3xl:text-[13px]">
          <li className="flex flex-col items-center gap-1.5"><ShieldCheck aria-hidden className="size-5" strokeWidth={1.5} />Garantia<br />Lardan</li>
          <li className="flex flex-col items-center gap-1.5"><Gem aria-hidden className="size-5" strokeWidth={1.5} />Peças com<br />banho de qualidade</li>
          <li className="flex flex-col items-center gap-1.5"><User aria-hidden className="size-5" strokeWidth={1.5} />Atendimento<br />pessoal</li>
        </ul>
      </div>
    </header>
  );
}

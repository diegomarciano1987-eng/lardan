import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  ArrowDown, ArrowUp, Camera, Check, CloudOff, Copy, Download, Eye, EyeOff, GripVertical, History, ImagePlus,
  Laptop, Loader2, Palette, Plus, Share2, Smartphone, Sparkles, Star, Store, Trash2, User, LayoutGrid, MessageCircle, Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VitrineView } from "@/components/vitrine/VitrineView";
import { RecorteFoto } from "@/components/vitrine/RecorteFoto";
import { brl, imagem, traduzir } from "@/lib/maletas";
import {
  CAPAS, CARTOES, FONTES, GRADES, LIMITES, PALETAS, SECOES_NOME, TEMAS, designPadrao, enviarArquivo, estudioCarregar,
  estudioDescartar, estudioNoAr, estudioPublicar, estudioRestaurar, estudioSalvar, linksPrevia,
  type DesignVitrine, type Recorte, type Secao,
} from "@/lib/vitrine-design";
import { abrirImagem, gerarImagemCompartilhar, gerarTamanhos, originalLimpo } from "@/lib/vitrine-imagem";

type Painel = "perfil" | "foto" | "aparencia" | "organizacao" | "contato" | "compartilhar";
const PAINEIS: { id: Painel; nome: string; icone: typeof User }[] = [
  { id: "perfil", nome: "Meu perfil", icone: User },
  { id: "foto", nome: "Foto e capa", icone: Camera },
  { id: "aparencia", nome: "Aparência", icone: Palette },
  { id: "organizacao", nome: "Organização", icone: LayoutGrid },
  { id: "contato", nome: "Contato", icone: MessageCircle },
  { id: "compartilhar", nome: "Compartilhar", icone: Share2 },
];
type Estado = "salvo" | "salvando" | "falhou" | "conflito";

export function Estudio() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["consultora", "estudio"], queryFn: estudioCarregar, refetchOnWindowFocus: false });
  const [d, setD] = React.useState<DesignVitrine | null>(null);
  const [rev, setRev] = React.useState(0);
  const [estado, setEstado] = React.useState<Estado>("salvo");
  const [painel, setPainel] = React.useState<Painel>("perfil");
  const [modo, setModo] = React.useState<"editar" | "ver">("editar");
  const [aparelho, setAparelho] = React.useState<"celular" | "computador">("celular");
  const [comparar, setComparar] = React.useState(false);
  const [links, setLinks] = React.useState<Record<string, string>>({});
  const [ocupado, setOcupado] = React.useState(false);
  const pendente = React.useRef(false);
  const revRef = React.useRef(0);

  React.useEffect(() => {
    if (q.data && d === null) {
      // Regra: o que já existe no cadastro vem preenchido (só onde está vazio).
      const base = designPadrao(q.data.rascunho);
      const c = q.data.cadastro;
      if (c) {
        if (!base.perfil.nome) base.perfil.nome = c.nome;
        if (!base.perfil.cidade && c.cidade) base.perfil.cidade = c.uf ? `${c.cidade} - ${c.uf}` : c.cidade;
        if (!base.contato.whatsapp) base.contato.whatsapp = c.whatsapp;
      }
      setD(base);
      setRev(q.data.revisao);
      revRef.current = q.data.revisao;
    }
  }, [q.data, d]);

  // salvamento automático
  React.useEffect(() => {
    if (!d || !pendente.current) return;
    setEstado("salvando");
    const t = setTimeout(async () => {
      try {
        const r = await estudioSalvar(d, revRef.current);
        revRef.current = r.revisao;
        setRev(r.revisao);
        pendente.current = false;
        setEstado("salvo");
      } catch (e) {
        setEstado((e as { code?: string })?.code === "40001" ? "conflito" : "falhou");
      }
    }, 900);
    return () => clearTimeout(t);
  }, [d]);

  // links temporários das imagens do rascunho
  const caminhos = d ? [d.imagens.avatar?.path, d.imagens.avatar?.path2x, d.imagens.capa?.path, d.imagens.capa?.path_m, d.compartilhar.imagem,
    q.data?.publicado?.imagens.avatar?.path, q.data?.publicado?.imagens.capa?.path].filter(Boolean) as string[] : [];
  const chave = caminhos.join("|");
  React.useEffect(() => {
    const faltam = caminhos.filter((c) => !links[c]);
    if (faltam.length) void linksPrevia(faltam).then((m) => setLinks((l) => ({ ...l, ...m })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  if (q.isError) return <div className="rounded-2xl border border-line-soft bg-surface p-5">{traduzir(q.error)}</div>;
  if (q.isLoading || !d || !q.data) return <div className="rounded-2xl border border-line-soft bg-surface p-5">Abrindo seu estúdio…</div>;

  const dados = q.data;
  const muda = (f: (x: DesignVitrine) => DesignVitrine) => { pendente.current = true; setD((x) => (x ? f(structuredClone(x)) : x)); };
  const img = (p?: string | null) => (p ? links[p] ?? null : null);
  const recarregar = async () => {
    const novo = await qc.fetchQuery({ queryKey: ["consultora", "estudio"], queryFn: estudioCarregar });
    pendente.current = false;
    setD(designPadrao(novo.rascunho));
    revRef.current = novo.revisao;
    setRev(novo.revisao);
    setEstado("salvo");
  };
  const alterado = JSON.stringify(dados.publicado ?? null) !== JSON.stringify(d) || !dados.publicado;

  const publicar = async () => {
    if (estado === "salvando" || pendente.current) { toast.message("Aguarde terminar de salvar."); return; }
    setOcupado(true);
    try {
      const r = await estudioPublicar(revRef.current);
      toast.success(r.repetido ? "Nada mudou desde a última publicação." : "Vitrine publicada! Clientes já veem a nova versão.");
      await recarregar();
    } catch (e) { toast.error(traduzir(e)); } finally { setOcupado(false); }
  };

  const origem = typeof window === "undefined" ? "https://www.lardan.com.br" : window.location.origin;

  const Controles = (
    <div className="space-y-5">
      <nav aria-label="Partes do estúdio" className="grid grid-cols-2 gap-1 rounded-xl border border-line-soft bg-surface p-1 min-[480px]:grid-cols-3">
        {PAINEIS.map((p) => (
          <button key={p.id} type="button" onClick={() => setPainel(p.id)} aria-current={painel === p.id ? "true" : undefined}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-lg px-2 py-2 text-[0.95rem] font-medium ${painel === p.id ? "bg-primary text-primary-foreground" : "text-ledger-text hover:bg-muted"}`}>
            <p.icone className="size-5 shrink-0" aria-hidden /> {p.nome}
          </button>
        ))}
      </nav>
      <div className="rounded-2xl border border-line-soft bg-surface p-5">
        {painel === "perfil" && <PainelPerfil d={d} muda={muda} nomeCadastro={dados.nome_cadastro} />}
        {painel === "contato" && <PainelContato d={d} muda={muda} />}
        {painel === "foto" && <PainelFoto d={d} muda={muda} party={dados.party_id} img={img} onLinks={(m) => setLinks((l) => ({ ...l, ...m }))} />}
        {painel === "aparencia" && <PainelAparencia d={d} muda={muda} />}
        {painel === "organizacao" && <PainelOrganizacao d={d} muda={muda} itens={dados.itens} />}
        {painel === "compartilhar" && (
          <PainelCompartilhar d={d} muda={muda} party={dados.party_id} img={img} origem={origem} publicadoSlug={dados.no_ar ? dados.slug : null}
            onLinks={(m) => setLinks((l) => ({ ...l, ...m }))} nome={dados.nome_cadastro} />
        )}
      </div>
      <Historico versoes={dados.versoes} onRestaurar={async (id) => {
        if (pendente.current) { toast.message("Aguarde terminar de salvar."); return; }
        try { await estudioRestaurar(id); await recarregar(); toast.success("Visual restaurado no rascunho. Peças, preços e estoque continuam os atuais. Publique para valer."); }
        catch (e) { toast.error(traduzir(e)); }
      }} />
    </div>
  );

  const Previa = (
    <div className="space-y-3 lg:sticky lg:top-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-full border border-line-soft bg-surface p-1">
          <button type="button" onClick={() => setAparelho("celular")} className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs ${aparelho === "celular" ? "bg-muted" : ""}`}><Smartphone className="size-3.5" /> Celular</button>
          <button type="button" onClick={() => setAparelho("computador")} className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs ${aparelho === "computador" ? "bg-muted" : ""}`}><Laptop className="size-3.5" /> Computador</button>
        </div>
        {dados.publicado && (
          <div className="flex rounded-full border border-line-soft bg-surface p-1">
            <button type="button" onClick={() => setComparar(false)} className={`rounded-full px-3 py-1 text-xs ${!comparar ? "bg-muted" : ""}`}>Minhas alterações</button>
            <button type="button" onClick={() => setComparar(true)} className={`rounded-full px-3 py-1 text-xs ${comparar ? "bg-muted" : ""}`}>Versão no ar</button>
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl border border-line-soft bg-muted p-3">
        <div className={`mx-auto h-[70vh] overflow-y-auto rounded-xl bg-background shadow-lg ${aparelho === "celular" ? "max-w-[390px]" : "w-full"}`}>
          <VitrineView design={comparar && dados.publicado ? dados.publicado : d} nome={dados.nome_cadastro} itens={dados.itens} img={img} previa />
        </div>
      </div>
      <p className="text-center text-[0.7rem] text-ledger-muted">Prévia fiel: é assim que a cliente verá depois de publicar. Os botões ficam desativados aqui.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line-soft bg-surface p-4">
        <div>
          <p className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" /> Estúdio da minha vitrine</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ledger-muted">
            {estado === "salvando" && <><Loader2 className="size-3 animate-spin" /> Salvando…</>}
            {estado === "salvo" && <><Check className="size-3" /> Salvo como rascunho {alterado && dados.publicado ? "· há alterações não publicadas" : ""}</>}
            {estado === "falhou" && <><CloudOff className="size-3" /> Não salvou. Verifique sua internet — tentaremos de novo na próxima alteração.</>}
            {estado === "conflito" && <>Sua vitrine foi alterada em outra aba. <button type="button" className="underline" onClick={() => void recarregar()}>Carregar a versão mais nova</button></>}
          </p>
          <p className="mt-0.5 text-xs text-ledger-muted">
            {dados.no_ar && dados.slug ? <>No ar em <a className="underline" href={`/${dados.slug}`} target="_blank" rel="noreferrer">{origem.replace(/^https?:\/\//, "")}/{dados.slug}</a></> : "Sua vitrine ainda não está no ar."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dados.publicado && alterado && (
            <button type="button" className="admin-btn" disabled={ocupado} onClick={async () => {
              if (!confirm("Descartar tudo o que não foi publicado?")) return;
              try { await estudioDescartar(); await recarregar(); toast.success("Alterações descartadas."); } catch (e) { toast.error(traduzir(e)); }
            }}>Descartar alterações</button>
          )}
          {dados.publicado && (
            <button type="button" className="admin-btn" onClick={async () => {
              try { await estudioNoAr(!dados.no_ar); await recarregar(); toast.success(dados.no_ar ? "Vitrine fora do ar." : "Vitrine no ar."); } catch (e) { toast.error(traduzir(e)); }
            }}>{dados.no_ar ? "Tirar do ar" : "Colocar no ar"}</button>
          )}
          <button type="button" className="admin-btn admin-btn-primary" disabled={ocupado || estado === "conflito" || (!alterado && dados.no_ar)} onClick={() => void publicar()}>
            <Store className="size-4" /> {ocupado ? "Publicando…" : "Publicar alterações"}
          </button>
        </div>
      </div>
      <span className="hidden" data-revisao={rev} />

      <div className="flex rounded-full border border-line-soft bg-surface p-1 lg:hidden">
        <button type="button" onClick={() => setModo("editar")} className={`flex-1 rounded-full py-2 text-sm ${modo === "editar" ? "bg-primary text-primary-foreground" : ""}`}>Editar</button>
        <button type="button" onClick={() => setModo("ver")} className={`flex-1 rounded-full py-2 text-sm ${modo === "ver" ? "bg-primary text-primary-foreground" : ""}`}>Visualizar</button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <div className={modo === "ver" ? "hidden lg:block" : ""}>{Controles}</div>
        <div className={modo === "editar" ? "hidden lg:block" : ""}>{Previa}</div>
      </div>
    </div>
  );
}

/* ---------- peças auxiliares ---------- */
type Muda = (f: (x: DesignVitrine) => DesignVitrine) => void;

function Campo({ rotulo, dica, limite, valor, children }: { rotulo: string; dica?: string; limite?: number; valor?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-widest text-ledger-muted">{rotulo}</span>
        {limite != null && <span className="text-[0.65rem] tabular-nums text-ledger-muted">{(valor ?? "").length}/{limite}</span>}
      </span>
      {children}
      {dica && <span className="text-[0.7rem] text-ledger-muted">{dica}</span>}
    </label>
  );
}
function Exemplo({ texto, onUsar }: { texto: string; onUsar: () => void }) {
  return (
    <button type="button" onClick={onUsar} className="w-full rounded-lg border border-dashed border-line-soft p-2 text-left text-[0.72rem] text-ledger-muted hover:bg-muted">
      <span className="font-medium">Usar exemplo (você pode editar):</span> {texto}
    </button>
  );
}
function Publico() {
  return <p className="rounded-lg bg-muted px-3 py-2 text-[0.72rem] text-ledger-muted">Tudo nesta seção é <strong>público</strong> e aparece na sua vitrine. Seu CPF, endereço e e-mail do cadastro nunca são publicados.</p>;
}

function PainelPerfil({ d, muda, nomeCadastro }: { d: DesignVitrine; muda: Muda; nomeCadastro: string }) {
  const p = d.perfil;
  const set = (k: keyof DesignVitrine["perfil"], v: string) => muda((x) => { x.perfil[k] = v.slice(0, LIMITES[k as keyof typeof LIMITES] ?? 400); return x; });
  return (
    <div className="space-y-4">
      <Publico />
      <Campo rotulo="Nome público" limite={LIMITES.nome} valor={p.nome} dica={`Deixe vazio para usar "${nomeCadastro}".`}>
        <input className="admin-input" value={p.nome} placeholder={nomeCadastro} onChange={(e) => set("nome", e.target.value)} />
      </Campo>
      <Campo rotulo="Frase de apresentação" limite={LIMITES.frase} valor={p.frase}>
        <input className="admin-input" value={p.frase} onChange={(e) => set("frase", e.target.value)} />
      </Campo>
      {!p.frase && <Exemplo texto="Semijoias Lardan para o seu dia a dia e para presentear." onUsar={() => set("frase", "Semijoias Lardan para o seu dia a dia e para presentear.")} />}
      <Campo rotulo="Sobre você" limite={LIMITES.bio} valor={p.bio} dica="Ideal: 2 a 4 frases curtas. Conte como você atende.">
        <textarea className="admin-input min-h-28" value={p.bio} onChange={(e) => set("bio", e.target.value)} />
      </Campo>
      {!p.bio && <Exemplo texto="Sou consultora Lardan e adoro ajudar a escolher a peça certa. Me chame no WhatsApp para ver as peças de perto." onUsar={() => set("bio", "Sou consultora Lardan e adoro ajudar a escolher a peça certa. Me chame no WhatsApp para ver as peças de perto.")} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Cidade" limite={LIMITES.cidade} valor={p.cidade}><input className="admin-input" value={p.cidade} onChange={(e) => set("cidade", e.target.value)} /></Campo>
        <Campo rotulo="Região de atendimento" limite={LIMITES.regiao} valor={p.regiao}><input className="admin-input" value={p.regiao} placeholder="Ex.: Zona Sul e Centro" onChange={(e) => set("regiao", e.target.value)} /></Campo>
      </div>
    </div>
  );
}

function PainelContato({ d, muda }: { d: DesignVitrine; muda: Muda }) {
  const c = d.contato;
  const set = (k: keyof DesignVitrine["contato"], v: string) => muda((x) => { x.contato[k] = v; return x; });
  const msg = d.perfil.mensagem;
  return (
    <div className="space-y-4">
      <Publico />
      <Campo rotulo="WhatsApp com DDD" dica="Obrigatório para publicar. É por ele que as clientes enviam o interesse.">
        <input className="admin-input" inputMode="tel" value={c.whatsapp} placeholder="43 99999-9999" onChange={(e) => set("whatsapp", e.target.value.replace(/[^0-9 ()+-]/g, ""))} />
      </Campo>
      <Campo rotulo="Horários de atendimento" limite={LIMITES.horarios} valor={d.perfil.horarios}>
        <input className="admin-input" value={d.perfil.horarios} placeholder="Ex.: seg. a sáb., das 9h às 19h" onChange={(e) => muda((x) => { x.perfil.horarios = e.target.value.slice(0, LIMITES.horarios); return x; })} />
      </Campo>
      <Campo rotulo="Mensagem inicial no WhatsApp" limite={LIMITES.mensagem} valor={msg} dica="Texto que abre a conversa quando a cliente envia as peças escolhidas.">
        <textarea className="admin-input min-h-20" value={msg} onChange={(e) => muda((x) => { x.perfil.mensagem = e.target.value.slice(0, LIMITES.mensagem); return x; })} />
      </Campo>
      {!msg && <Exemplo texto="Olá! Vi sua vitrine Lardan e gostei destas peças:" onUsar={() => muda((x) => { x.perfil.mensagem = "Olá! Vi sua vitrine Lardan e gostei destas peças:"; return x; })} />}
      <p className="pt-2 text-xs uppercase tracking-widest text-ledger-muted">Redes sociais (só o nome de usuário)</p>
      {(["instagram", "facebook", "tiktok"] as const).map((k) => (
        <Campo key={k} rotulo={k === "tiktok" ? "TikTok" : k === "instagram" ? "Instagram" : "Facebook"}>
          <input className="admin-input" value={c[k]} placeholder="seuusuario" onChange={(e) => set(k, e.target.value.replace(/^@/, "").replace(/.*\.com\//, ""))} />
        </Campo>
      ))}
    </div>
  );
}

function Escolha<T extends string>({ itens, valor, onEscolher, render }: { itens: { id: T; nome: string }[]; valor: T; onEscolher: (v: T) => void; render?: (id: T) => React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {itens.map((i) => (
        <button key={i.id} type="button" onClick={() => onEscolher(i.id)} aria-pressed={valor === i.id}
          className={`rounded-xl border p-2 text-left text-xs transition ${valor === i.id ? "border-primary ring-2 ring-primary/30" : "border-line-soft hover:bg-muted"}`}>
          {render?.(i.id)}
          <span className="mt-1.5 block font-medium">{i.nome}</span>
        </button>
      ))}
    </div>
  );
}

function MiniTema({ tema, paleta }: { tema: string; paleta: string }) {
  return (
    <div className={`vp-${paleta} h-20 overflow-hidden rounded-lg bg-[var(--v-bg)] p-1.5`}>
      {tema === "classica" && <><div className="h-6 rounded bg-[var(--v-line)]" /><div className="mx-auto -mt-2 size-5 rounded-full border-2 border-[var(--v-bg)] bg-[var(--v-accent)]" /><div className="mx-auto mt-1 h-1 w-10 rounded bg-[var(--v-ink)]" /><div className="mt-1.5 grid grid-cols-3 gap-1">{[0, 1, 2].map((i) => <div key={i} className="h-4 rounded-sm bg-[var(--v-surface)]" />)}</div></>}
      {tema === "editorial" && <div className="grid h-full grid-cols-2 gap-1"><div className="rounded bg-[var(--v-line)]" /><div className="space-y-1 pt-2"><div className="size-4 rounded-full bg-[var(--v-accent)]" /><div className="h-2 w-12 rounded bg-[var(--v-ink)]" /><div className="h-1 w-10 rounded bg-[var(--v-muted)]" /></div></div>}
      {tema === "minimalista" && <div className="flex h-full flex-col items-center justify-center gap-1"><div className="size-4 rounded-full bg-[var(--v-accent)]" /><div className="h-1 w-10 rounded bg-[var(--v-ink)]" /><div className="mt-2 grid w-3/4 grid-cols-2 gap-1">{[0, 1].map((i) => <div key={i} className="h-3 rounded-sm bg-[var(--v-line)]" />)}</div></div>}
    </div>
  );
}

function PainelAparencia({ d, muda }: { d: DesignVitrine; muda: Muda }) {
  const a = d.aparencia;
  const set = <K extends keyof DesignVitrine["aparencia"]>(k: K, v: DesignVitrine["aparencia"][K]) => muda((x) => { x.aparencia[k] = v; return x; });
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-ledger-muted">Tema</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {TEMAS.map((t) => (
            <button key={t.id} type="button" onClick={() => set("tema", t.id)} aria-pressed={a.tema === t.id}
              className={`rounded-xl border p-2 text-left text-xs ${a.tema === t.id ? "border-primary ring-2 ring-primary/30" : "border-line-soft hover:bg-muted"}`}>
              <MiniTema tema={t.id} paleta={a.paleta} />
              <span className="mt-1.5 block font-medium">{t.nome}</span>
              <span className="block text-[0.68rem] text-ledger-muted">{t.texto}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-ledger-muted">Cores</p>
        <Escolha itens={PALETAS} valor={a.paleta} onEscolher={(v) => set("paleta", v)} render={(id) => (
          <div className={`vp-${id} flex h-8 overflow-hidden rounded-md border border-line-soft`}>
            <span className="flex-1 bg-[var(--v-bg)]" /><span className="flex-1 bg-[var(--v-surface)]" /><span className="flex-1 bg-[var(--v-accent)]" /><span className="flex-1 bg-[var(--v-ink)]" />
          </div>
        )} />
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-ledger-muted">Letras</p>
        <Escolha itens={FONTES} valor={a.fonte} onEscolher={(v) => set("fonte", v)} render={(id) => (
          <span className={`vf-${id} vitrine-raiz vp-perola block rounded-md px-2 py-1.5`}><span className="v-titulo text-lg">Aa Lardan</span></span>
        )} />
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-ledger-muted">Cartão das peças</p>
        <Escolha itens={CARTOES} valor={a.cartao} onEscolher={(v) => set("cartao", v)} />
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-ledger-muted">Disposição das peças</p>
        <Escolha itens={GRADES} valor={a.grade} onEscolher={(v) => set("grade", v)} />
      </div>
    </div>
  );
}

/* ---------- foto e capa ---------- */
function PainelFoto({ d, muda, party, img, onLinks }: { d: DesignVitrine; muda: Muda; party: string; img: (p?: string | null) => string | null; onLinks: (m: Record<string, string>) => void }) {
  const [editando, setEditando] = React.useState<{ tipo: "avatar" | "capa"; bmp: ImageBitmap; original?: string | null | undefined; crop?: Recorte | null | undefined } | null>(null);
  const [preparando, setPreparando] = React.useState(false);
  const galeria = React.useRef<HTMLInputElement>(null);
  const camera = React.useRef<HTMLInputElement>(null);
  const capaInput = React.useRef<HTMLInputElement>(null);
  const [focoFormato, setFocoFormato] = React.useState<"desktop" | "mobile">("desktop");

  const abrir = async (tipo: "avatar" | "capa", f?: File) => {
    if (!f) return;
    try { setEditando({ tipo, bmp: await abrirImagem(f) }); } catch (e) { toast.error((e as Error).message); }
  };
  const reenquadrar = async () => {
    const o = d.imagens.avatar?.original; if (!o) return;
    try {
      const m = await linksPrevia([o]);
      const u = m[o]; if (!u) throw new Error("x");
      const blob = await (await fetch(u)).blob();
      setEditando({ tipo: "avatar", bmp: await createImageBitmap(blob), original: o, crop: d.imagens.avatar?.crop });
    } catch { toast.error("Não foi possível abrir a foto original."); }
  };
  const confirmar = async (r: Recorte) => {
    if (!editando) return;
    setPreparando(true);
    try {
      if (editando.tipo === "avatar") {
        const [p1, p2] = (await gerarTamanhos(editando.bmp, r, [{ w: 400, h: 400 }, { w: 800, h: 800 }])) as [Blob, Blob];
        const original = editando.original ?? await enviarArquivo(party, "orig", await originalLimpo(editando.bmp));
        const [a1, a2] = await Promise.all([enviarArquivo(party, "pub", p1, "-400"), enviarArquivo(party, "pub", p2, "-800")]);
        const m = await linksPrevia([a1, a2]); onLinks(m);
        muda((x) => { x.imagens.avatar = { path: a1, path2x: a2, original, crop: r }; return x; });
      } else {
        const [desk, mob] = (await gerarTamanhos(editando.bmp, r, [{ w: 1920, h: 720 }, { w: 1080, h: 810 }])) as [Blob, Blob];
        const original = await enviarArquivo(party, "orig", await originalLimpo(editando.bmp));
        const [c1, c2] = await Promise.all([enviarArquivo(party, "pub", desk, "-1920"), enviarArquivo(party, "pub", mob, "-1080")]);
        const m = await linksPrevia([c1, c2]); onLinks(m);
        muda((x) => { x.imagens.capa = { path: c1, path_m: c2, original, foco_desktop: { x: 50, y: 50 }, foco_mobile: { x: 50, y: 50 } }; return x; });
      }
      setEditando(null);
      toast.success("Imagem pronta no rascunho.");
    } catch (e) {
      toast.error(`Falha ao enviar: ${traduzir(e)}. Sua vitrine não mudou; tente de novo.`);
    } finally { setPreparando(false); }
  };

  const retrato = img(d.imagens.avatar?.path);
  const capa = d.imagens.capa;
  const oficial = CAPAS.find((c) => c.id === capa?.preset);
  const capaSrc = focoFormato === "desktop" ? (oficial?.desktop ?? img(capa?.path)) : (oficial?.mobile ?? img(capa?.path_m ?? capa?.path));
  const foco = (focoFormato === "desktop" ? capa?.foco_desktop : capa?.foco_mobile) ?? { x: 50, y: 50 };

  return (
    <div className="space-y-6">
      <section>
        <p className="mb-3 text-xs uppercase tracking-widest text-ledger-muted">Sua foto</p>
        <div className="flex items-center gap-4">
          <div className="size-24 shrink-0 overflow-hidden rounded-full border border-line-soft bg-muted">
            {retrato ? <img src={retrato} alt="Sua foto" className="size-full object-cover" /> : <User className="m-auto mt-7 size-10 text-ledger-muted" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="admin-btn" onClick={() => camera.current?.click()}><Camera className="size-4" /> Tirar foto</button>
            <button type="button" className="admin-btn" onClick={() => galeria.current?.click()}><ImagePlus className="size-4" /> Galeria</button>
            {d.imagens.avatar?.original && <button type="button" className="admin-btn" onClick={() => void reenquadrar()}>Reenquadrar</button>}
            {d.imagens.avatar && <button type="button" className="admin-btn" onClick={() => muda((x) => { delete x.imagens.avatar; return x; })}><Trash2 className="size-4" /> Remover</button>}
          </div>
        </div>
        <p className="mt-2 text-[0.72rem] text-ledger-muted">Dica: luz natural de frente, rosto e ombros à mostra. Não aplicamos filtros nem retoques.</p>
        <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={(e) => { void abrir("avatar", e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={galeria} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void abrir("avatar", e.target.files?.[0]); e.target.value = ""; }} />
      </section>

      <section>
        <p className="mb-3 text-xs uppercase tracking-widest text-ledger-muted">Capa</p>
        <div className="grid grid-cols-3 gap-2">
          {CAPAS.map((c) => (
            <button key={c.id} type="button" aria-pressed={capa?.preset === c.id} onClick={() => muda((x) => { x.imagens.capa = { preset: c.id }; return x; })}
              className={`overflow-hidden rounded-lg border text-[0.68rem] ${capa?.preset === c.id ? "border-primary ring-2 ring-primary/30" : "border-line-soft"}`}>
              <img src={c.desktop} alt="" className="h-14 w-full object-cover" loading="lazy" />
              <span className="block py-1">{c.nome}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="admin-btn" onClick={() => capaInput.current?.click()}><ImageIcon className="size-4" /> Usar minha própria capa</button>
          {capa && <button type="button" className="admin-btn" onClick={() => muda((x) => { delete x.imagens.capa; return x; })}>Sem capa</button>}
        </div>
        <input ref={capaInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void abrir("capa", e.target.files?.[0]); e.target.value = ""; }} />

        {capa && capaSrc && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-ledger-muted">Toque no ponto mais importante da imagem</p>
              <div className="flex rounded-full border border-line-soft p-0.5 text-[0.68rem]">
                <button type="button" onClick={() => setFocoFormato("desktop")} className={`rounded-full px-2 py-0.5 ${focoFormato === "desktop" ? "bg-muted" : ""}`}>Computador</button>
                <button type="button" onClick={() => setFocoFormato("mobile")} className={`rounded-full px-2 py-0.5 ${focoFormato === "mobile" ? "bg-muted" : ""}`}>Celular</button>
              </div>
            </div>
            <div className="relative cursor-crosshair overflow-hidden rounded-lg" onClick={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              const f = { x: Math.round(((e.clientX - b.left) / b.width) * 100), y: Math.round(((e.clientY - b.top) / b.height) * 100) };
              muda((x) => { if (x.imagens.capa) { if (focoFormato === "desktop") x.imagens.capa.foco_desktop = f; else x.imagens.capa.foco_mobile = f; } return x; });
            }}>
              <img src={capaSrc} alt="" className="w-full" />
              <span className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow" style={{ left: `${foco.x}%`, top: `${foco.y}%` }} />
            </div>
            <div className="grid grid-cols-[2fr_1fr] gap-2">
              <figure><img src={oficial?.desktop ?? img(capa.path) ?? ""} alt="" className="h-16 w-full rounded object-cover" style={{ objectPosition: `${capa.foco_desktop?.x ?? 50}% ${capa.foco_desktop?.y ?? 50}%` }} /><figcaption className="text-[0.65rem] text-ledger-muted">Corte no computador</figcaption></figure>
              <figure><img src={oficial?.mobile ?? img(capa.path_m ?? capa.path) ?? ""} alt="" className="h-16 w-full rounded object-cover" style={{ objectPosition: `${capa.foco_mobile?.x ?? 50}% ${capa.foco_mobile?.y ?? 50}%` }} /><figcaption className="text-[0.65rem] text-ledger-muted">Corte no celular</figcaption></figure>
            </div>
            <p className="text-[0.7rem] text-ledger-muted">Evite capas com textos escritos: seu nome e contato já aparecem na página, sempre legíveis.</p>
          </div>
        )}
      </section>

      <Dialog open={!!editando} onOpenChange={(o) => { if (!o && !preparando) setEditando(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editando?.tipo === "avatar" ? "Ajuste sua foto" : "Ajuste sua capa"}</DialogTitle></DialogHeader>
          {editando && (
            <RecorteFoto img={editando.bmp} inicial={editando.crop ?? null} proporcao={editando.tipo === "avatar" ? 1 : 1920 / 720} redondo={editando.tipo === "avatar"}
              minimo={editando.tipo === "avatar" ? 400 : 1000} confirmando={preparando} onCancelar={() => setEditando(null)} onConfirmar={(r) => void confirmar(r)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- organização ---------- */
function PainelOrganizacao({ d, muda, itens }: { d: DesignVitrine; muda: Muda; itens: { variant_id: string; produto: string; variante: string | null; preco_cents: number; media_id: string | null; midias: string[] }[] }) {
  const o = d.organizacao;
  const pos = (id: string) => { const i = o.ordem.indexOf(id); return i < 0 ? 1e6 : i; };
  const lista = [...itens].sort((a, b) => pos(a.variant_id) - pos(b.variant_id));
  const [arrastando, setArrastando] = React.useState<string | null>(null);
  const [fotoDe, setFotoDe] = React.useState<string | null>(null);

  const mover = (id: string, para: number) => muda((x) => {
    const ids = lista.map((i) => i.variant_id).filter((v) => v !== id);
    ids.splice(Math.max(0, Math.min(para, ids.length)), 0, id);
    x.organizacao.ordem = ids; return x;
  });
  const alterna = (campo: "destaques" | "ocultas", id: string) => muda((x) => {
    const s = x.organizacao[campo];
    x.organizacao[campo] = s.includes(id) ? s.filter((v) => v !== id) : campo === "destaques" && s.length >= 12 ? s : [...s, id];
    return x;
  });

  return (
    <div className="space-y-6">
      <section>
        <p className="mb-2 text-xs uppercase tracking-widest text-ledger-muted">Ordem das partes da página</p>
        <ul className="space-y-1.5">
          {(["destaques", "selecoes", "catalogo"] as Secao[]).map((s) => {
            const ativa = o.secoes.includes(s); const i = o.secoes.indexOf(s);
            return (
              <li key={s} className="flex items-center gap-2 rounded-lg border border-line-soft px-3 py-2 text-sm">
                <span className="flex-1">{SECOES_NOME[s]}</span>
                {ativa && <><button type="button" aria-label="Subir" className="admin-btn px-2" disabled={i === 0} onClick={() => muda((x) => { const a = x.organizacao.secoes; const t = a[i]!; a[i] = a[i - 1]!; a[i - 1] = t; return x; })}><ArrowUp className="size-3.5" /></button>
                  <button type="button" aria-label="Descer" className="admin-btn px-2" disabled={i === o.secoes.length - 1} onClick={() => muda((x) => { const a = x.organizacao.secoes; const t = a[i]!; a[i] = a[i + 1]!; a[i + 1] = t; return x; })}><ArrowDown className="size-3.5" /></button></>}
                <button type="button" className="admin-btn px-2" aria-label={ativa ? "Esconder parte" : "Mostrar parte"} onClick={() => muda((x) => { x.organizacao.secoes = ativa ? x.organizacao.secoes.filter((v) => v !== s) : [...x.organizacao.secoes, s]; return x; })}>
                  {ativa ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs uppercase tracking-widest text-ledger-muted">Seleções</p>
          {o.selecoes.length < 4 && (
            <button type="button" className="admin-btn text-xs" onClick={() => muda((x) => { x.organizacao.selecoes.push({ titulo: ["Meus favoritos", "Para presentear", "Escolhas da semana", "Nova seleção"][x.organizacao.selecoes.length] ?? "Nova seleção", itens: [] }); return x; })}>
              <Plus className="size-3.5" /> Nova seleção
            </button>
          )}
        </div>
        {o.selecoes.length === 0 && <p className="text-xs text-ledger-muted">Crie listas como “Meus favoritos”, “Para presentear” ou “Escolhas da semana”.</p>}
        <div className="space-y-3">
          {o.selecoes.map((sel, si) => (
            <div key={si} className="rounded-xl border border-line-soft p-3">
              <div className="flex gap-2">
                <input className="admin-input flex-1" value={sel.titulo} maxLength={40} onChange={(e) => muda((x) => { x.organizacao.selecoes[si]!.titulo = e.target.value; return x; })} />
                <button type="button" className="admin-btn px-2" aria-label="Apagar seleção" onClick={() => muda((x) => { x.organizacao.selecoes.splice(si, 1); return x; })}><Trash2 className="size-3.5" /></button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {itens.map((i) => {
                  const dentro = sel.itens.includes(i.variant_id);
                  return (
                    <button key={i.variant_id} type="button" aria-pressed={dentro} onClick={() => muda((x) => { const s = x.organizacao.selecoes[si]!; s.itens = dentro ? s.itens.filter((v) => v !== i.variant_id) : [...s.itens, i.variant_id]; return x; })}
                      className={`rounded-full border px-2.5 py-1 text-[0.7rem] ${dentro ? "border-primary bg-primary/10" : "border-line-soft text-ledger-muted"}`}>
                      {i.produto}
                    </button>
                  );
                })}
                {itens.length === 0 && <span className="text-[0.7rem] text-ledger-muted">Sem peças disponíveis agora. A seleção fica guardada e aparece quando houver peças.</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="mb-1 text-xs uppercase tracking-widest text-ledger-muted">Suas peças</p>
        <p className="mb-2 text-[0.7rem] text-ledger-muted">Arraste para ordenar (ou use as setas). <Star className="inline size-3" /> destaca, <EyeOff className="inline size-3" /> esconde da vitrine sem mexer no seu estoque. Peças só aparecem enquanto estiverem disponíveis na sua maleta.</p>
        {lista.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-soft p-4 text-center text-xs text-ledger-muted">Você ainda não tem peças disponíveis. Elas aparecem aqui depois do aceite da maleta e de publicar as peças em “Minha maleta”.</p>
        ) : (
          <ul className="space-y-1.5">
            {lista.map((i, idx) => {
              const destaque = o.destaques.includes(i.variant_id); const oculta = o.ocultas.includes(i.variant_id);
              const fEsc = o.fotos[i.variant_id]; const fotoId = fEsc && i.midias.includes(fEsc) ? fEsc : i.media_id;
              return (
                <li key={i.variant_id} draggable onDragStart={() => setArrastando(i.variant_id)} onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (arrastando && arrastando !== i.variant_id) mover(arrastando, idx); setArrastando(null); }}
                  className={`rounded-lg border border-line-soft bg-surface p-2 ${oculta ? "opacity-50" : ""}`}>
                  <div className="flex items-center gap-2">
                    <GripVertical className="size-4 shrink-0 cursor-grab text-ledger-muted" aria-hidden />
                    <button type="button" onClick={() => setFotoDe(fotoDe === i.variant_id ? null : i.variant_id)} className="size-11 shrink-0 overflow-hidden rounded bg-muted" aria-label="Escolher foto principal">
                      {fotoId && <img src={imagem(fotoId)!} alt="" className="size-full object-cover" loading="lazy" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{i.produto}</p>
                      <p className="text-[0.7rem] text-ledger-muted">{brl(i.preco_cents)}</p>
                    </div>
                    <button type="button" aria-label="Subir" className="admin-btn px-1.5" disabled={idx === 0} onClick={() => mover(i.variant_id, idx - 1)}><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label="Descer" className="admin-btn px-1.5" disabled={idx === lista.length - 1} onClick={() => mover(i.variant_id, idx + 1)}><ArrowDown className="size-3.5" /></button>
                    <button type="button" aria-pressed={destaque} aria-label="Destacar" className={`admin-btn px-1.5 ${destaque ? "text-primary" : ""}`} onClick={() => alterna("destaques", i.variant_id)}><Star className={`size-3.5 ${destaque ? "fill-current" : ""}`} /></button>
                    <button type="button" aria-pressed={oculta} aria-label={oculta ? "Mostrar na vitrine" : "Esconder da vitrine"} className="admin-btn px-1.5" onClick={() => alterna("ocultas", i.variant_id)}>{oculta ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
                  </div>
                  {fotoDe === i.variant_id && (
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                      {i.midias.length <= 1 && <span className="text-[0.7rem] text-ledger-muted">Esta peça tem só uma foto aprovada.</span>}
                      {i.midias.length > 1 && i.midias.map((m) => (
                        <button key={m} type="button" aria-pressed={fotoId === m} onClick={() => muda((x) => { x.organizacao.fotos[i.variant_id] = m; return x; })}
                          className={`size-14 overflow-hidden rounded border-2 ${fotoId === m ? "border-primary" : "border-transparent"}`}>
                          <img src={imagem(m)!} alt="" className="size-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------- compartilhar ---------- */
function PainelCompartilhar({ d, muda, party, img, origem, publicadoSlug, onLinks, nome }: {
  d: DesignVitrine; muda: Muda; party: string; img: (p?: string | null) => string | null; origem: string; publicadoSlug: string | null;
  onLinks: (m: Record<string, string>) => void; nome: string;
}) {
  const [qr, setQr] = React.useState<string | null>(null);
  const [gerando, setGerando] = React.useState(false);
  const url = `${origem}/${d.slug || publicadoSlug || ""}`;
  React.useEffect(() => { if (d.slug) void QRCode.toDataURL(url, { margin: 1, width: 600 }).then(setQr); else setQr(null); }, [url, d.slug]);
  const nomePub = d.perfil.nome || nome;

  const gerar = async () => {
    setGerando(true);
    try {
      const oficial = CAPAS.find((c) => c.id === d.imagens.capa?.preset);
      const blob = await gerarImagemCompartilhar({
        capa: oficial?.desktop ?? img(d.imagens.capa?.path), retrato: img(d.imagens.avatar?.path2x ?? d.imagens.avatar?.path),
        nome: nomePub, frase: d.perfil.frase || "Semijoias Lardan",
      });
      const p = await enviarArquivo(party, "pub", blob, "-1200");
      onLinks(await linksPrevia([p]));
      muda((x) => { x.compartilhar.imagem = p; return x; });
    } catch (e) { toast.error(`Não foi possível gerar a imagem: ${traduzir(e)}`); } finally { setGerando(false); }
  };
  const titulo = d.compartilhar.titulo || `${nomePub} · Semijoias LARDAN`;
  const descricao = d.compartilhar.descricao || d.perfil.frase || `Peças LARDAN disponíveis com ${nomePub}.`;

  return (
    <div className="space-y-4">
      <Campo rotulo="Endereço da vitrine" dica="Só letras, números e hífen. Ex.: maria-joias">
        <div className="flex items-center gap-1"><span className="text-xs text-ledger-muted">{origem.replace(/^https?:\/\//, "")}/</span>
          <input className="admin-input flex-1" value={d.slug} onChange={(e) => muda((x) => { x.slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40); return x; })} placeholder="seunome" /></div>
      </Campo>
      <Campo rotulo="Título ao compartilhar" limite={LIMITES.titulo} valor={d.compartilhar.titulo}>
        <input className="admin-input" value={d.compartilhar.titulo} placeholder={titulo} onChange={(e) => muda((x) => { x.compartilhar.titulo = e.target.value.slice(0, LIMITES.titulo); return x; })} />
      </Campo>
      <Campo rotulo="Descrição curta" limite={LIMITES.descricao} valor={d.compartilhar.descricao}>
        <textarea className="admin-input min-h-16" value={d.compartilhar.descricao} placeholder={descricao} onChange={(e) => muda((x) => { x.compartilhar.descricao = e.target.value.slice(0, LIMITES.descricao); return x; })} />
      </Campo>

      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-ledger-muted">Como o link aparece</p>
        <div className="overflow-hidden rounded-xl border border-line-soft bg-muted">
          {img(d.compartilhar.imagem) ? <img src={img(d.compartilhar.imagem)!} alt="" className="aspect-[1200/630] w-full object-cover" /> : <div className="grid aspect-[1200/630] place-items-center text-xs text-ledger-muted">Sem imagem de apresentação</div>}
          <div className="bg-surface p-3"><p className="text-[0.65rem] uppercase text-ledger-muted">lardan.com.br</p><p className="text-sm font-semibold">{titulo}</p><p className="line-clamp-2 text-xs text-ledger-muted">{descricao}</p></div>
        </div>
        <button type="button" className="admin-btn mt-2" disabled={gerando} onClick={() => void gerar()}><Sparkles className="size-4" /> {gerando ? "Gerando…" : d.compartilhar.imagem ? "Gerar de novo com minha foto e capa" : "Gerar imagem no modelo Lardan"}</button>
        <p className="mt-2 text-[0.7rem] text-ledger-muted">WhatsApp, Instagram e Facebook guardam a prévia antiga por um tempo. Depois de publicar, a nova imagem pode demorar algumas horas para aparecer lá.</p>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {qr && <img src={qr} alt="QR Code da vitrine" className="size-28 rounded-lg border border-line-soft bg-background p-1" />}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="admin-btn" disabled={!d.slug} onClick={() => { void navigator.clipboard.writeText(url); toast.success("Link copiado."); }}><Copy className="size-4" /> Copiar link</button>
          {typeof navigator !== "undefined" && "share" in navigator && <button type="button" className="admin-btn" disabled={!d.slug} onClick={() => void navigator.share({ title: titulo, text: descricao, url }).catch(() => undefined)}><Share2 className="size-4" /> Compartilhar</button>}
          {qr && <a className="admin-btn" href={qr} download={`vitrine-${d.slug}-qrcode.png`}><Download className="size-4" /> Baixar QR Code</a>}
        </div>
      </div>
      {publicadoSlug !== d.slug && d.slug && <p className="text-[0.7rem] text-ledger-muted">O novo endereço passa a valer quando você publicar.</p>}
    </div>
  );
}

function Historico({ versoes, onRestaurar }: { versoes: { id: string; numero: number; em: string }[]; onRestaurar: (id: string) => void }) {
  if (!versoes.length) return null;
  return (
    <details className="rounded-2xl border border-line-soft bg-surface p-4">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><History className="size-4" /> Versões publicadas</summary>
      <ul className="mt-3 space-y-1.5">
        {versoes.map((v, i) => (
          <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
            <span>Versão {v.numero} · {new Date(v.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}{i === 0 ? " · atual" : ""}</span>
            {i > 0 && <button type="button" className="admin-btn text-xs" onClick={() => onRestaurar(v.id)}>Restaurar visual</button>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.7rem] text-ledger-muted">Restaurar volta apenas o visual e os textos. Peças, preços e disponibilidade continuam sempre os atuais.</p>
    </details>
  );
}

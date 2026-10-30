import * as React from "react";
import { FotoPeca } from "@/components/FotoPeca";
import { EtiquetasImprimir } from "@/components/admin/EtiquetasImprimir";
import { EtiquetaMaleta } from "./EtiquetaMaleta";
import { BotaoTelaCheia } from "@/components/admin/TelaCheia";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Minus, Plus, ScanBarcode, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { metasMontagem, type MetasMontagem } from "@/lib/historico-jflex";
import { brl, operarMontagem, traduzir, type ItemComposicao } from "@/lib/maletas";
import {
  PARAMETROS_PADRAO,
  TIPO_PECA_LABEL,
  metasPorTipo,
  type ParametrosRemessa,
  type TipoPeca,
} from "@/lib/remessa";
import { useTiposPeca } from "@/lib/tipo-peca";
import { ConferenciaMaleta } from "./ConferenciaMaleta";
import { DocumentosMaleta } from "./DocumentosMaleta";

type Leitura = { id: string; codigo: string; ok: boolean; texto: string; detalhe?: string; hora: string; variantId?: string };
type Res = {
  encontrado: boolean;
  precisa_criar?: boolean;
  variant_id?: string;
  produto?: string;
  variante?: string;
  tamanho?: string | null;
  unidade?: boolean;
  forma?: string;
  variante_criada?: boolean;
  preco_cents?: number | null;
};
type Etapa = "montagem" | "conferencia" | "documentos";
type InfoConsultora = {
  party_id: string;
  nome: string;
  praca: string | null;
  cidade: string | null;
  whatsapp: string | null;
} | null;

let audioCtx: AudioContext | null = null;
function apito(ok: boolean) {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = ok ? "sine" : "square";
    o.frequency.value = ok ? 1320 : 220;
    g.gain.value = 0.15;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + (ok ? 0.08 : 0.45));
  } catch {
    /* sem som */
  }
}

async function resolver(cod: string, criar: boolean) {
  const { data, error } = await supabase.rpc("barcode_resolver" as never, { _code: cod, _criar: criar } as never);
  if (error) throw error;
  return data as unknown as Res;
}

type Sugestao = { codigo: string; nome: string };

/** Busca inteligente por nome, código interno ou código de barras — para digitar além de bipar. */
async function buscarPecas(termo: string): Promise<Sugestao[]> {
  const t = termo.trim().replace(/[%,()]/g, " ");
  if (t.length < 3) return [];
  const partes = t.split(/\s+/).filter(Boolean);
  let q = supabase
    .from("products")
    .select("id, name, internal_code, product_variants(id, label, barcode, sku, is_active)")
    .limit(12);
  if (/^\d+$/.test(t)) {
    q = q.or(`internal_code.ilike.%${t}%,barcode.ilike.%${t}%,name.ilike.%${t}%`);
  } else {
    for (const p of partes) q = q.ilike("name", `%${p}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  const out: Sugestao[] = [];
  type V = { id: string; label: string | null; barcode: string | null; sku: string | null; is_active: boolean };
  for (const p of (data ?? []) as unknown as { id: string; name: string; internal_code: string | null; product_variants: V[] }[]) {
    for (const v of p.product_variants ?? []) {
      if (!v.is_active) continue;
      const codigo = v.barcode || v.sku || p.internal_code;
      if (!codigo) continue;
      out.push({ codigo, nome: [p.name, v.label].filter(Boolean).join(" · ") });
    }
  }
  return out.slice(0, 12);
}

const ORDEM_TIPOS: TipoPeca[] = ["brinco", "anel", "colar", "pulseira", "tornozeleira"];

type ModoMetas = "historico" | "padrao";
const CONFIANCA_LABEL: Record<MetasMontagem["confianca"], string> = {
  alta: "histórico forte",
  media: "histórico médio",
  baixa: "pouco histórico",
};
const nomeCategoria = (c: string) => (c ? c.charAt(0) + c.slice(1).toLowerCase() : "Sem categoria");

/**
 * Faixa acima dos cartões de meta: de onde vêm as metas desta maleta.
 * Só leitura (montagem_metas_ciclo, 0113): não reserva nem adiciona peça.
 * Sem input de texto: o leitor devolve o foco ao campo de bipagem a cada 400 ms.
 */
function FaixaHistorico({
  dados,
  carregando,
  modo,
  somaPadrao,
  aoModo,
  aoTotal,
}: {
  dados: MetasMontagem | undefined;
  carregando: boolean;
  modo: ModoMetas;
  somaPadrao: number;
  aoModo: (m: ModoMetas) => void;
  aoTotal: (n: number | null) => void;
}) {
  if (carregando && !dados) {
    return <p className="ledger-panel px-5 py-3 text-sm text-ledger-muted">Lendo o histórico de venda da consultora…</p>;
  }
  if (!dados) return null; // sem permissão ou sem histórico importado: segue o padrão, sem alarde
  const temHistorico = dados.metas_historico !== null && dados.vinculada;
  const origem =
    dados.total_origem === "historico"
      ? "o tamanho das últimas maletas dela"
      : dados.total_origem === "informado"
        ? "ajustado aqui"
        : "padrão de cliente nova";
  return (
    <div className="ledger-panel space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden className="size-5 text-ledger-text" />
          <p className="ledger-eyebrow">Metas desta maleta</p>
          <div role="group" aria-label="Origem das metas" className="ml-2 inline-flex overflow-hidden rounded-full border border-line">
            <button
              type="button"
              disabled={!temHistorico}
              aria-pressed={modo === "historico"}
              className={`px-3 py-1 text-sm ${modo === "historico" ? "bg-ink text-background" : "text-ledger-text hover:bg-surface-muted"} disabled:opacity-40`}
              onClick={() => aoModo("historico")}
            >
              Pelo histórico dela
            </button>
            <button
              type="button"
              aria-pressed={modo === "padrao"}
              className={`px-3 py-1 text-sm ${modo === "padrao" ? "bg-ink text-background" : "text-ledger-text hover:bg-surface-muted"}`}
              onClick={() => aoModo("padrao")}
            >
              Padrão Lardan
            </button>
          </div>
        </div>
        {modo === "historico" ? (
          <div className="flex items-center gap-2 text-sm">
            <button type="button" aria-label="Menos 5 peças" className="rounded-md border border-line p-1 hover:bg-surface-muted"
              onClick={() => aoTotal(Math.max(5, dados.total_pecas - 5))}>
              <Minus className="size-3" />
            </button>
            <span className="font-display text-xl font-bold tabular-nums text-ledger-text">{dados.total_pecas}</span>
            <button type="button" aria-label="Mais 5 peças" className="rounded-md border border-line p-1 hover:bg-surface-muted"
              onClick={() => aoTotal(Math.min(1000, dados.total_pecas + 5))}>
              <Plus className="size-3" />
            </button>
            <span className="text-ledger-muted">peças · {origem}</span>
            {dados.total_origem === "informado" && (
              <button type="button" className="text-ledger-muted underline" onClick={() => aoTotal(null)}>voltar ao sugerido</button>
            )}
          </div>
        ) : (
          <p className="text-sm text-ledger-muted">{somaPadrao} peças · parâmetros de remessa</p>
        )}
      </div>

      {temHistorico ? (
        <p className="text-sm text-ledger-muted">
          <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${dados.confianca === "alta" ? "bg-success/15 text-success" : dados.confianca === "media" ? "bg-warning/15 text-warning" : "bg-surface-muted text-ledger-muted"}`}>
            {CONFIANCA_LABEL[dados.confianca]}
          </span>
          {dados.pecas_vendidas_historico ?? 0} peças vendidas em {dados.maletas_fechadas ?? 0} maletas no SmallData
          {typeof dados.giro_geral_pct === "number" && ` · gira ${dados.giro_geral_pct}% do que recebe`}
          {" · "}
          {dados.referencia === "praca" ? `praça ${dados.praca_nome ?? ""}` : "rede"}
          {typeof dados.referencia_giro_geral_pct === "number" && `: ${dados.referencia_giro_geral_pct}%`}
        </p>
      ) : (
        <p className="text-sm text-ledger-muted">
          {dados.vinculada ? "Pouco histórico de venda: metas do padrão." : "Sem histórico do SmallData ligado a esta consultora: metas do padrão."}
        </p>
      )}

      {temHistorico && dados.destaques.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-sm">
          {dados.destaques.slice(0, 4).map((d) => (
            <li key={d.categoria} className={`rounded-full px-3 py-1 ${d.sinal === "forte" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
              {d.sinal === "forte" ? "▲ vende bem" : "▼ vende pouco"} {nomeCategoria(d.categoria)}: {d.giro_pct}% ({dados.referencia === "praca" ? "praça" : "rede"} {d.referencia_giro_pct}%)
            </li>
          ))}
        </ul>
      )}

      {temHistorico && dados.categorias.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ledger-muted">Ver por categoria</summary>
          <table className="mt-2 w-full text-left tabular-nums">
            <thead className="text-ledger-muted">
              <tr>
                <th className="py-1 font-medium">Categoria</th>
                <th className="py-1 text-right font-medium">Sugeridas</th>
                <th className="py-1 text-right font-medium">Vendidas por ela</th>
                <th className="py-1 text-right font-medium">Giro dela</th>
                <th className="py-1 text-right font-medium">Giro {dados.referencia === "praca" ? "praça" : "rede"}</th>
              </tr>
            </thead>
            <tbody>
              {dados.categorias.map((c) => (
                <tr key={c.categoria} className="border-t border-line">
                  <td className="py-1">{nomeCategoria(c.categoria)}</td>
                  <td className="py-1 text-right font-semibold">{c.pecas_sugeridas}</td>
                  <td className="py-1 text-right">{c.consultora_pecas_vendidas}</td>
                  <td className="py-1 text-right">{c.consultora_giro_pct === null ? "—" : `${c.consultora_giro_pct}%`}</td>
                  <td className="py-1 text-right">{c.referencia_giro_pct === null ? "—" : `${c.referencia_giro_pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ledger-muted">{dados.como_ler}</p>
        </details>
      )}
    </div>
  );
}

/** Tela única de montagem por leitor: cada bipe entra na maleta na hora. */
export function MontagemLeitor({
  cycleId,
  titulo,
  composicao,
  codigoMaleta,
  dataAcerto,
  aoFechar,
}: {
  cycleId: string;
  titulo: string;
  composicao: ItemComposicao[];
  codigoMaleta: string;
  dataAcerto: string | null;
  aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const qtd = React.useRef<Record<string, number>>({});
  const [itens, setItens] = React.useState<Record<string, { nome: string; qtd: number; preco: number; sku: string | null }>>({});
  const [codigo, setCodigo] = React.useState("");
  const [leituras, setLeituras] = React.useState<Leitura[]>([]);
  const [pendentes, setPendentes] = React.useState(0);
  const [nesta, setNesta] = React.useState(0);
  const [etapa, setEtapa] = React.useState<Etapa>("montagem");
  const [operador, setOperador] = React.useState("—");
  const fila = React.useRef<Promise<void>>(Promise.resolve());
  const campo = React.useRef<HTMLInputElement>(null);

  const info = useQuery({
    queryKey: ["maletas", "consultora-info", cycleId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("kit_consultora_info" as never, { _cycle: cycleId } as never);
      if (error) throw error;
      return data as unknown as InfoConsultora;
    },
  });

  const parametros = useQuery({
    queryKey: ["remessa-parametros"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("remessa_parametros" as never)
        .select("pecas_cliente_nova, meta_colares, meta_pulseiras, meta_aneis, meta_tornozeleiras")
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as ParametrosRemessa | null) ?? PARAMETROS_PADRAO;
    },
  });

  // Metas pelo histórico de venda dela (0113). Erro = sem permissão ou sem histórico: fica no padrão.
  const [totalMetas, setTotalMetas] = React.useState<number | null>(null);
  const [modoEscolhido, setModoEscolhido] = React.useState<ModoMetas | null>(null);
  const historico = useQuery({
    queryKey: ["maletas", "metas-historico", cycleId, totalMetas],
    queryFn: () => metasMontagem(cycleId, totalMetas),
    retry: false,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const campeas = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    campeas.current = new Set(historico.data?.variantes_campeas ?? []);
  }, [historico.data]);

  React.useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const nome = data.user?.user_metadata?.["full_name"] ?? data.user?.email;
      if (nome) setOperador(String(nome));
    });
  }, []);

  React.useEffect(() => {
    const m: Record<string, { nome: string; qtd: number; preco: number; sku: string | null }> = {};
    for (const c of composicao) {
      qtd.current[c.variant_id] = c.quantidade;
      m[c.variant_id] = {
        nome: [c.produto, c.variante].filter(Boolean).join(" · "),
        qtd: c.quantidade,
        preco: c.valor_unitario,
        sku: c.sku,
      };
    }
    setItens(m);
    // só na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Busca na composição (bip, nome, SKU ou referência) para achar a peça e tirar com o "−" sem rolar a lista.
  const campoBusca = React.useRef<HTMLInputElement>(null);
  const [buscaPeca, setBuscaPeca] = React.useState("");
  const idsItens = Object.keys(itens).sort().join(",");
  const codigosPecas = useQuery({
    queryKey: ["montagem", "codigos", idsItens],
    enabled: idsItens.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const ids = idsItens.split(",");
      const m: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase.from("product_variants")
          .select("id, barcode, sku, reference_code, products(reference_code, internal_code, legacy_code)")
          .in("id", ids.slice(i, i + 150));
        if (error) throw error;
        for (const v of (data ?? []) as unknown as { id: string; barcode: string | null; sku: string | null; reference_code: string | null; products: { reference_code: string | null; internal_code: string | null; legacy_code: string | null } | null }[])
          m[v.id] = [v.barcode, v.sku, v.reference_code, v.products?.reference_code, v.products?.internal_code, v.products?.legacy_code].filter(Boolean).join(" ");
      }
      return m;
    },
  });

  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    campo.current?.focus();
    const t = window.setInterval(() => {
      const a = document.activeElement;
      // A busca da composição é a única exceção: enquanto ela estiver em uso, o foco fica nela.
      if (!impressaoAberta.current && a !== campo.current && a !== campoBusca.current && !(a instanceof HTMLButtonElement)) campo.current?.focus();
    }, 400);
    return () => {
      window.clearInterval(t);
      document.body.style.overflow = prev;
    };
  }, []);

  // Impressão vai direto para a impressora (sem diálogo); o foco volta ao leitor.
  const impressaoAberta = React.useRef(false);

  function registrar(l: Omit<Leitura, "id" | "hora">) {
    setLeituras((a) => [{ ...l, id: crypto.randomUUID(), hora: new Date().toLocaleTimeString("pt-BR") }, ...a].slice(0, 40));
  }

  async function ajustar(variantId: string, nome: string, delta: number, preco = 0, sku: string | null = null, origem: "bipagem" | "manual" | "retirada" = "retirada") {
    const result = await operarMontagem(cycleId, variantId, delta, origem, crypto.randomUUID());
    const nova = result.quantidade;
    void qc.invalidateQueries({ queryKey: ["montagem-pessoal"] });
    qtd.current[variantId] = nova;
    setItens((m) => {
      const n = { ...m };
      if (nova === 0) delete n[variantId];
      else n[variantId] = { nome, qtd: nova, preco: preco || n[variantId]?.preco || 0, sku: sku ?? n[variantId]?.sku ?? null };
      return n;
    });
  }

  async function processar(cod: string, origem: "bipagem" | "manual" = "bipagem") {
    let r: Res | null = null;
    try {
      r = await resolver(cod, false);
      if (r?.encontrado && !r.variant_id && r.precisa_criar) r = await resolver(cod, true);
    } catch (e) {
      apito(false);
      registrar({ codigo: cod, ok: false, texto: "Falha ao ler", detalhe: traduzir(e) });
      return;
    }
    if (!r?.encontrado || !r.variant_id) {
      apito(false);
      registrar({ codigo: cod, ok: false, texto: "Código não cadastrado", detalhe: "Cadastre a peça antes de montar." });
      return;
    }
    const nome = [r.produto, r.variante].filter(Boolean).join(" · ");
    try {
      await ajustar(r.variant_id, nome, 1, r.preco_cents ?? 0, cod, origem);
      apito(true);
      setNesta((n) => n + 1);
      const extra = [
        campeas.current.has(r.variant_id) ? "★ campeã de venda dela" : null,
        r.unidade ? "unidade" : null,
        r.forma === "anel_tamanho" && r.tamanho ? `aro ${r.tamanho}${r.variante_criada ? " (tamanho registrado agora)" : ""}` : null,
      ].filter(Boolean).join(" · ");
      registrar({ codigo: cod, ok: true, texto: nome, variantId: r.variant_id, ...(extra ? { detalhe: extra } : {}) });
    } catch (e) {
      apito(false);
      registrar({ codigo: cod, ok: false, texto: nome || "Não entrou", detalhe: traduzir(e) });
    }
  }

  function enfileirar(fn: () => Promise<void>) {
    setPendentes((n) => n + 1);
    fila.current = fila.current.then(fn).finally(() => setPendentes((n) => n - 1));
  }

  const [sugestoes, setSugestoes] = React.useState<Sugestao[]>([]);
  const buscaTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function aoDigitar(valor: string) {
    setCodigo(valor);
    if (buscaTimer.current) clearTimeout(buscaTimer.current);
    const t = valor.trim();
    if (t.length < 3) {
      setSugestoes([]);
      return;
    }
    buscaTimer.current = setTimeout(() => {
      void buscarPecas(t).then(setSugestoes).catch(() => setSugestoes([]));
    }, 250);
  }

  function escolher(s: Sugestao) {
    setCodigo("");
    setSugestoes([]);
    enfileirar(() => processar(s.codigo, "manual"));
    campo.current?.focus();
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const cod = codigo.trim();
    setCodigo("");
    setSugestoes([]);
    if (!cod) return;
    // Digitou um nome e sobrou uma única sugestão: entra ela. Senão, vai como código.
    if (!/^[A-Za-z0-9-]+$/.test(cod) && sugestoes.length === 1) {
      const sugestao = sugestoes[0];
      if (sugestao) enfileirar(() => processar(sugestao.codigo, "manual"));
      return;
    }
    enfileirar(() => processar(cod));
  }

  function tirarUma(variantId: string, nome: string) {
    enfileirar(async () => {
      try {
        await ajustar(variantId, nome, -1);
        registrar({ codigo: "—", ok: true, texto: `Retirada 1 · ${nome}` });
      } catch (e) {
        registrar({ codigo: "—", ok: false, texto: "Não retirou", detalhe: traduzir(e) });
      }
      campo.current?.focus();
    });
  }

  async function irParaConferencia() {
    await fila.current;
    await qc.invalidateQueries({ queryKey: ["maletas"] });
    setEtapa("conferencia");
  }

  async function terminar() {
    await fila.current;
    await qc.invalidateQueries({ queryKey: ["maletas"] });
    aoFechar();
  }

  const lista = Object.entries(itens).sort((a, b) => a[1].nome.localeCompare(b[1].nome));
  const total = lista.reduce((s, [, v]) => s + v.qtd, 0);
  const valorTotal = lista.reduce((s, [, v]) => s + v.qtd * v.preco, 0);
  const ultima = leituras[0];

  /** Composição viva da bipagem, no formato da ficha, para conferência e documentos. */
  const composicaoViva: ItemComposicao[] = lista.map(([variant_id, v]) => ({
    variant_id,
    produto: v.nome,
    variante: null,
    sku: v.sku,
    quantidade: v.qtd,
    valor_unitario: v.preco,
    media_id: null,
  }));

  /** Bipado por tipo de peça, para os cards de meta (tipo pela categoria do produto — 0136). */
  const tipoDe = useTiposPeca(Object.keys(itens));
  const bipadoPorTipo = React.useMemo(() => {
    const m: Record<TipoPeca, number> = { brinco: 0, anel: 0, colar: 0, pulseira: 0, tornozeleira: 0, outro: 0 };
    for (const [id, v] of lista) m[tipoDe(id, v.sku, v.nome)] += v.qtd;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, tipoDe]);

  const metasPadrao = metasPorTipo(parametros.data ?? PARAMETROS_PADRAO);
  const somaPadrao = Object.values(metasPadrao).reduce((s, n) => s + n, 0);
  const metasHistorico = historico.data?.vinculada ? historico.data.metas_historico : null;
  const modoMetas: ModoMetas = metasHistorico ? (modoEscolhido ?? historico.data!.modo_sugerido) : "padrao";
  const metas: Record<TipoPeca, number> = modoMetas === "historico" && metasHistorico ? metasHistorico : metasPadrao;
  const tiposVisiveis: TipoPeca[] = metas.outro > 0 || bipadoPorTipo.outro > 0 ? [...ORDEM_TIPOS, "outro"] : ORDEM_TIPOS;

  if (etapa === "conferencia") {
    return (
      <ConferenciaMaleta
        cycleId={cycleId}
        titulo={titulo}
        composicao={composicaoViva}
        aoConcluir={() => setEtapa("documentos")}
        aoVoltar={() => setEtapa("montagem")}
      />
    );
  }
  if (etapa === "documentos") {
    return (
      <DocumentosMaleta
        cycleId={cycleId}
        codigoMaleta={codigoMaleta}
        titulo={titulo}
        composicao={composicaoViva}
        dataAcerto={dataAcerto}
        operador={operador}
        aoFechar={() => void terminar()}
      />
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Montagem por leitor" className="fixed inset-0 z-[100] overflow-auto bg-background">
      <div className="mx-auto max-w-[1500px] space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="ledger-eyebrow">Montagem por leitor</p>
            <p className="font-display text-2xl font-bold text-ledger-text">{titulo}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <BotaoTelaCheia />
            <button
              type="button"
              className="admin-btn"
              disabled={pendentes > 0 || total === 0}
              onClick={() => void irParaConferencia()}
            >
              <ClipboardCheck aria-hidden className="size-4" /> Conferência
            </button>
            <button type="button" className="admin-btn admin-btn-primary" disabled={pendentes > 0} onClick={() => void irParaConferencia()}>
              <CheckCircle2 aria-hidden className="size-4" /> {pendentes > 0 ? `Gravando ${pendentes}…` : "Concluir montagem"}
            </button>
          </div>
        </div>

        <FaixaHistorico
          dados={historico.data}
          carregando={historico.isLoading}
          modo={modoMetas}
          somaPadrao={somaPadrao}
          aoModo={setModoEscolhido}
          aoTotal={setTotalMetas}
        />

        {/* Cards de meta por tipo: o que a maleta precisa × o que já foi bipado */}
        <div className={`grid grid-cols-2 gap-3 ${tiposVisiveis.length > 5 ? "md:grid-cols-6" : "md:grid-cols-5"}`}>
          {tiposVisiveis.map((t) => {
            const meta = metas[t];
            const feito = bipadoPorTipo[t];
            const ok = meta > 0 && feito >= meta;
            return (
              <div key={t} className={`ledger-panel p-4 text-center ${ok ? "ring-2 ring-success/50" : ""}`}>
                <p className="ledger-eyebrow">{TIPO_PECA_LABEL[t]}</p>
                <p className="mt-1 font-display text-3xl font-bold tabular-nums text-ledger-text">
                  {feito}
                  <span className="text-base font-normal text-ledger-muted"> / {meta}</span>
                </p>
                <p className="text-xs text-ledger-muted">
                  {meta === 0 ? "sem meta" : ok ? "meta atingida" : `faltam ${meta - feito}`}
                </p>
              </div>
            );
          })}
        </div>

        <div className="grid gap-5 lg:grid-cols-[280px_1fr_340px]">
          {/* Dados básicos da consultora */}
          <aside className="ledger-panel h-fit space-y-3 p-5">
            <p className="ledger-eyebrow">Consultora</p>
            {info.isLoading && <p className="text-sm text-ledger-muted">Carregando…</p>}
            {info.data ? (
              <>
                <p className="font-display text-lg font-bold leading-tight text-ledger-text">{info.data.nome}</p>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="ledger-eyebrow">Praça</dt>
                    <dd className="text-ledger-text">{info.data.praca ?? "Sem praça vinculada"}</dd>
                  </div>
                  <div>
                    <dt className="ledger-eyebrow">Cidade</dt>
                    <dd className="text-ledger-text">{info.data.cidade ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="ledger-eyebrow">WhatsApp</dt>
                    <dd className="text-ledger-text">{info.data.whatsapp ?? "—"}</dd>
                  </div>
                </dl>
                {(historico.data?.ultimas_maletas.length ?? 0) > 0 && (
                  <div className="border-t border-line pt-3">
                    <p className="ledger-eyebrow mb-1">Últimas remessas (SmallData)</p>
                    <ul className="space-y-1 text-sm tabular-nums">
                      {historico.data!.ultimas_maletas.map((m) => (
                        <li key={m.remessa} className="flex justify-between gap-2">
                          <span className="text-ledger-muted">Rem. {m.remessa}{m.maletas > 1 ? ` · ${m.maletas} maletas` : ""}</span>
                          <span className="text-ledger-text">
                            {m.pecas_vendidas}/{m.pecas_enviadas} vendidas{m.giro_pct === null ? "" : ` · ${m.giro_pct}%`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              !info.isLoading && <p className="text-sm text-ledger-muted">Sem consultora definida nesta maleta.</p>
            )}
          </aside>

          <div className="ledger-panel p-6">
            <p className="ledger-eyebrow mb-3">Bipe as peças — cada leitura entra nesta maleta na hora</p>
            <form onSubmit={enviar} className="relative">
              <label className="flex items-center gap-4 rounded-2xl border-2 border-ink bg-background px-6 py-6 focus-within:ring-4 focus-within:ring-ring/30">
                <ScanBarcode className="h-12 w-12 shrink-0 text-ledger-text" />
                <input
                  ref={campo}
                  value={codigo}
                  onChange={(e) => aoDigitar(e.target.value)}
                  autoComplete="off"
                  aria-label="Código de barras ou nome da peça"
                  placeholder="Bipe, digite o código ou o nome da peça…"
                  className="w-full bg-transparent font-display text-4xl font-bold tracking-wide text-ledger-text outline-none placeholder:text-ledger-muted/60"
                />
              </label>
              {sugestoes.length > 0 && (
                <ul className="absolute inset-x-0 top-full z-10 mt-2 max-h-72 overflow-auto rounded-2xl border border-line-soft bg-surface shadow-xl">
                  {sugestoes.map((s) => (
                    <li key={s.codigo}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-surface-muted"
                        onClick={() => escolher(s)}
                      >
                        <span className="truncate text-ledger-text">{s.nome}</span>
                        <span className="shrink-0 tabular-nums text-ledger-muted">{s.codigo}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </form>
            {ultima && (
              <div role="status" className={`mt-5 grid grid-cols-2 gap-5 rounded-2xl p-5 ${ultima.ok ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                <div className="min-w-0 self-center">
                  <p className="text-sm font-bold uppercase tracking-[0.12em]">{ultima.ok ? "✓ Na maleta" : "✕ Recusado"}</p>
                  <p className="mt-1 text-2xl font-bold leading-tight break-words">{ultima.texto}</p>
                  {ultima.detalhe && <p className="mt-2 text-lg font-semibold">{ultima.detalhe}</p>}
                  <p className="mt-2 text-sm opacity-70">Código {ultima.codigo}</p>
                </div>
                <div className="flex items-center justify-center">
                  {ultima.variantId ? (
                    <FotoPeca
                      key={ultima.id}
                      variantId={ultima.variantId}
                      alt={ultima.texto}
                      className="aspect-square w-full max-w-[22rem] rounded-2xl border border-line bg-surface"
                    />
                  ) : (
                    <div className="grid aspect-square w-full max-w-[22rem] place-items-center rounded-2xl border border-line bg-surface text-sm text-ledger-muted">Sem foto</div>
                  )}
                </div>
              </div>
            )}
            <ul className="mt-5 max-h-48 divide-y divide-line overflow-auto text-sm">
              {leituras.slice(1).map((l) => (
                <li key={l.id} className="flex justify-between gap-3 py-2">
                  <span className={l.ok ? "text-ledger-text" : "text-destructive"}>{l.ok ? "✓" : "✕"} {l.texto}{l.detalhe ? ` — ${l.detalhe}` : ""}</span>
                  <span className="shrink-0 text-ledger-muted">{l.codigo} · {l.hora}</span>
                </li>
              ))}
            </ul>
          </div>

          <aside className="space-y-4">
            <div className="ledger-panel p-6 text-center">
              <p className="ledger-eyebrow">Peças na maleta</p>
              <p className="font-display text-8xl font-bold tabular-nums text-ledger-text">{total}</p>
              {nesta > 0 && total > nesta ? (
                <p className="text-sm text-ledger-muted">{nesta} nesta sessão + {total - nesta} anteriores</p>
              ) : nesta > 0 ? (
                <p className="text-sm text-ledger-muted">{nesta} bipada(s) nesta sessão</p>
              ) : (
                <p className="text-sm text-ledger-muted">Total acumulado da maleta, incluindo sessões anteriores</p>
              )}
            </div>
            <div className="ledger-panel p-6 text-center">
              <p className="ledger-eyebrow">Valor total da maleta</p>
              <p className="font-display text-5xl font-bold tabular-nums text-ledger-text">{brl(valorTotal)}</p>
              <p className="text-sm text-ledger-muted">soma do preço de venda das peças</p>
            </div>
            <div className="ledger-panel p-5">
              <EtiquetaMaleta cycleId={cycleId} />
              <p className="ledger-eyebrow mb-2">Composição</p>
              {lista.length === 0 ? (
                <p className="text-sm text-ledger-muted">Sem dados.</p>
              ) : (
                <ul className="max-h-[50vh] space-y-1 overflow-auto text-sm">
                  {lista.map(([id, p]) => (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <FotoPeca variantId={id} alt={p.nome} size="xs" />
                      <span className="flex-1 truncate">{p.nome}</span>
                      <span onClickCapture={() => window.setTimeout(() => campo.current?.focus(), 400)}><EtiquetasImprimir compact label={`Imprimir etiqueta de ${p.nome}`} origens={[{ variantId: id, quantidade: 1 }]} /></span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-ledger-muted">{brl(p.preco * p.qtd)}</span>
                        <strong className="tabular-nums">{p.qtd}</strong>
                        <button type="button" aria-label={`Retirar 1 de ${p.nome}`} className="rounded-md border border-line p-1 hover:bg-surface-muted" onClick={() => tirarUma(id, p.nome)}>
                          <Minus className="size-3" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" className="admin-btn w-full justify-center" disabled={pendentes > 0} onClick={() => void terminar()}>
              <X aria-hidden className="size-4" /> Fechar
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

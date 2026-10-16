import * as React from "react";
import { FotoPeca } from "@/components/FotoPeca";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Minus, ScanBarcode, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl, definirItem, traduzir, type ItemComposicao } from "@/lib/maletas";
import {
  PARAMETROS_PADRAO,
  TIPO_PECA_LABEL,
  metasPorTipo,
  tipoPeca,
  type ParametrosRemessa,
  type TipoPeca,
} from "@/lib/remessa";
import { ConferenciaMaleta } from "./ConferenciaMaleta";
import { DocumentosMaleta } from "./DocumentosMaleta";

type Leitura = { id: string; codigo: string; ok: boolean; texto: string; detalhe?: string; hora: string };
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

  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    campo.current?.focus();
    const t = window.setInterval(() => {
      const a = document.activeElement;
      if (a !== campo.current && !(a instanceof HTMLButtonElement)) campo.current?.focus();
    }, 400);
    return () => {
      window.clearInterval(t);
      document.body.style.overflow = prev;
    };
  }, []);

  function registrar(l: Omit<Leitura, "id" | "hora">) {
    setLeituras((a) => [{ ...l, id: crypto.randomUUID(), hora: new Date().toLocaleTimeString("pt-BR") }, ...a].slice(0, 40));
  }

  async function ajustar(variantId: string, nome: string, delta: number, preco = 0, sku: string | null = null) {
    const nova = Math.max(0, (qtd.current[variantId] ?? 0) + delta);
    await definirItem(cycleId, variantId, nova);
    qtd.current[variantId] = nova;
    setItens((m) => {
      const n = { ...m };
      if (nova === 0) delete n[variantId];
      else n[variantId] = { nome, qtd: nova, preco: preco || n[variantId]?.preco || 0, sku: sku ?? n[variantId]?.sku ?? null };
      return n;
    });
  }

  async function processar(cod: string) {
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
      await ajustar(r.variant_id, nome, 1, r.preco_cents ?? 0, cod);
      apito(true);
      setNesta((n) => n + 1);
      const extra = [
        r.unidade ? "unidade" : null,
        r.forma === "anel_tamanho" && r.tamanho ? `aro ${r.tamanho}` : null,
      ].filter(Boolean).join(" · ");
      registrar({ codigo: cod, ok: true, texto: nome, ...(extra ? { detalhe: extra } : {}) });
    } catch (e) {
      apito(false);
      registrar({ codigo: cod, ok: false, texto: nome || "Não entrou", detalhe: traduzir(e) });
    }
  }

  function enfileirar(fn: () => Promise<void>) {
    setPendentes((n) => n + 1);
    fila.current = fila.current.then(fn).finally(() => setPendentes((n) => n - 1));
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const cod = codigo.trim();
    setCodigo("");
    if (cod) enfileirar(() => processar(cod));
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

  /** Bipado por tipo de peça, para os cards de meta. */
  const bipadoPorTipo = React.useMemo(() => {
    const m: Record<TipoPeca, number> = { brinco: 0, anel: 0, colar: 0, pulseira: 0, tornozeleira: 0, outro: 0 };
    for (const [, v] of lista) m[tipoPeca(v.sku, v.nome)] += v.qtd;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens]);

  const metas = metasPorTipo(parametros.data ?? PARAMETROS_PADRAO);

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

        {/* Cards de meta por tipo: o que a maleta precisa × o que já foi bipado */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {ORDEM_TIPOS.map((t) => {
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
              </>
            ) : (
              !info.isLoading && <p className="text-sm text-ledger-muted">Sem consultora definida nesta maleta.</p>
            )}
          </aside>

          <div className="ledger-panel p-6">
            <p className="ledger-eyebrow mb-3">Bipe as peças — cada leitura entra nesta maleta na hora</p>
            <form onSubmit={enviar}>
              <label className="flex items-center gap-4 rounded-2xl border-2 border-ink bg-background px-6 py-6 focus-within:ring-4 focus-within:ring-ring/30">
                <ScanBarcode className="h-12 w-12 shrink-0 text-ledger-text" />
                <input
                  ref={campo}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  autoComplete="off"
                  inputMode="none"
                  aria-label="Código de barras"
                  placeholder="Aguardando leitura…"
                  className="w-full bg-transparent font-display text-4xl font-bold tracking-wide text-ledger-text outline-none placeholder:text-ledger-muted/60"
                />
              </label>
            </form>
            {ultima && (
              <div role="status" className={`mt-5 rounded-2xl px-6 py-5 ${ultima.ok ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                <p className="text-2xl font-bold">{ultima.ok ? "✓ Na maleta" : "✕ Recusado"} — {ultima.texto}</p>
                {ultima.detalhe && <p className="mt-1 text-base">{ultima.detalhe}</p>}
                <p className="mt-1 text-sm opacity-70">Código {ultima.codigo}</p>
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
              <p className="text-sm text-ledger-muted">{nesta} bipada(s) agora</p>
            </div>
            <div className="ledger-panel p-6 text-center">
              <p className="ledger-eyebrow">Valor total da maleta</p>
              <p className="font-display text-5xl font-bold tabular-nums text-ledger-text">{brl(valorTotal)}</p>
              <p className="text-sm text-ledger-muted">soma do preço de venda das peças</p>
            </div>
            <div className="ledger-panel p-5">
              <p className="ledger-eyebrow mb-2">Composição</p>
              {lista.length === 0 ? (
                <p className="text-sm text-ledger-muted">Sem dados.</p>
              ) : (
                <ul className="max-h-[50vh] space-y-1 overflow-auto text-sm">
                  {lista.map(([id, p]) => (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <FotoPeca variantId={id} alt={p.nome} size="xs" />
                      <span className="flex-1 truncate">{p.nome}</span>
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

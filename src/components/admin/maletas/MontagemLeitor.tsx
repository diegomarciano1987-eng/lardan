import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Minus, ScanBarcode, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { definirItem, traduzir, type ItemComposicao } from "@/lib/maletas";

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
};

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

/** Tela única de montagem por leitor: cada bipe entra na maleta na hora. */
export function MontagemLeitor({
  cycleId,
  titulo,
  composicao,
  aoFechar,
}: {
  cycleId: string;
  titulo: string;
  composicao: ItemComposicao[];
  aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const qtd = React.useRef<Record<string, number>>({});
  const [itens, setItens] = React.useState<Record<string, { nome: string; qtd: number }>>({});
  const [codigo, setCodigo] = React.useState("");
  const [leituras, setLeituras] = React.useState<Leitura[]>([]);
  const [pendentes, setPendentes] = React.useState(0);
  const [nesta, setNesta] = React.useState(0);
  const fila = React.useRef<Promise<void>>(Promise.resolve());
  const campo = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const m: Record<string, { nome: string; qtd: number }> = {};
    for (const c of composicao) {
      qtd.current[c.variant_id] = c.quantidade;
      m[c.variant_id] = { nome: [c.produto, c.variante].filter(Boolean).join(" · "), qtd: c.quantidade };
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

  async function ajustar(variantId: string, nome: string, delta: number) {
    const nova = Math.max(0, (qtd.current[variantId] ?? 0) + delta);
    await definirItem(cycleId, variantId, nova);
    qtd.current[variantId] = nova;
    setItens((m) => {
      const n = { ...m };
      if (nova === 0) delete n[variantId];
      else n[variantId] = { nome, qtd: nova };
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
      await ajustar(r.variant_id, nome, 1);
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

  async function terminar() {
    await fila.current;
    await qc.invalidateQueries({ queryKey: ["maletas"] });
    aoFechar();
  }

  const lista = Object.entries(itens).sort((a, b) => a[1].nome.localeCompare(b[1].nome));
  const total = lista.reduce((s, [, v]) => s + v.qtd, 0);
  const ultima = leituras[0];

  return (
    <div role="dialog" aria-modal="true" aria-label="Montagem por leitor" className="fixed inset-0 z-[100] overflow-auto bg-background">
      <div className="mx-auto max-w-[1500px] space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="ledger-eyebrow">Montagem por leitor</p>
            <p className="font-display text-2xl font-bold text-ledger-text">{titulo}</p>
          </div>
          <button type="button" className="admin-btn admin-btn-primary" disabled={pendentes > 0} onClick={() => void terminar()}>
            <CheckCircle2 aria-hidden className="size-4" /> {pendentes > 0 ? `Gravando ${pendentes}…` : "Terminar montagem"}
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
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
            <ul className="mt-5 max-h-72 divide-y divide-line overflow-auto text-sm">
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
            <div className="ledger-panel p-5">
              <p className="ledger-eyebrow mb-2">Composição</p>
              {lista.length === 0 ? (
                <p className="text-sm text-ledger-muted">Sem dados.</p>
              ) : (
                <ul className="max-h-[50vh] space-y-1 overflow-auto text-sm">
                  {lista.map(([id, p]) => (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.nome}</span>
                      <span className="flex items-center gap-2">
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

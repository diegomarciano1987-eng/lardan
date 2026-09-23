import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ScanBarcode, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { Panel, formatInt } from "@/components/admin/ui";
import { listStockLocations, registerMovement } from "@/lib/stock";

type Categoria = { id: string; name: string; parent_id: string | null };
type Leitura = {
  id: string;
  codigo: string;
  ok: boolean;
  texto: string;
  detalhe?: string;
  hora: string;
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
    /* sem som disponível */
  }
}

/** Categoria do produto ou qualquer categoria-mãe dela coincide com a escolhida. */
function pertence(catId: string | null, alvo: string, mapa: Map<string, Categoria>) {
  let atual = catId ? mapa.get(catId) : undefined;
  for (let i = 0; atual && i < 6; i++) {
    if (atual.id === alvo) return true;
    atual = atual.parent_id ? mapa.get(atual.parent_id) : undefined;
  }
  return false;
}

export function LeitorEntrada() {
  const locais = useQuery({ queryKey: ["leitor-locais"], queryFn: listStockLocations });
  const categorias = useQuery({
    queryKey: ["leitor-categorias"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id, name, parent_id").order("name");
      if (error) throw error;
      return (data ?? []) as Categoria[];
    },
  });
  const mapa = React.useMemo(
    () => new Map((categorias.data ?? []).map((c) => [c.id, c])),
    [categorias.data],
  );

  const [local, setLocal] = React.useState("");
  const [categoria, setCategoria] = React.useState("");
  const [codigo, setCodigo] = React.useState("");
  const [referencia, setReferencia] = React.useState("");
  const [contador, setContador] = React.useState(0);
  const [recusados, setRecusados] = React.useState(0);
  const [leituras, setLeituras] = React.useState<Leitura[]>([]);
  const [porPeca, setPorPeca] = React.useState<Record<string, { nome: string; qtd: number }>>({});
  const [pendentes, setPendentes] = React.useState(0);
  const fila = React.useRef<Promise<void>>(Promise.resolve());
  const campo = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!local && locais.data?.length) {
      const dep = locais.data.find((l) => l.code === "DEP-01") ?? locais.data[0];
      if (dep) setLocal(dep.id);
    }
  }, [locais.data, local]);

  const pronto = Boolean(local && categoria && referencia.trim());
  React.useEffect(() => {
    if (pronto) campo.current?.focus();
  }, [pronto]);

  const nomeCategoria = mapa.get(categoria)?.name ?? "";

  function registrar(l: Omit<Leitura, "id" | "hora">) {
    setLeituras((a) =>
      [{ ...l, id: crypto.randomUUID(), hora: new Date().toLocaleTimeString("pt-BR") }, ...a].slice(0, 30),
    );
  }

  async function processar(cod: string) {
    const { data, error } = await supabase.rpc("barcode_lookup", { _code: cod });
    const r = data as { encontrado: boolean; product_id?: string; variant_id?: string; produto?: string; variante?: string } | null;
    if (error || !r?.encontrado || !r.variant_id) {
      apito(false);
      setRecusados((n) => n + 1);
      registrar({ codigo: cod, ok: false, texto: "Código não cadastrado", detalhe: "Cadastre a peça antes de dar entrada." });
      return;
    }
    const { data: p } = await supabase
      .from("products")
      .select("category_id, subcategory_id")
      .eq("id", r.product_id!)
      .single();
    const ok =
      pertence(p?.category_id ?? null, categoria, mapa) || pertence(p?.subcategory_id ?? null, categoria, mapa);
    const nome = [r.produto, r.variante].filter(Boolean).join(" · ");
    if (!ok) {
      apito(false);
      setRecusados((n) => n + 1);
      const real = mapa.get(p?.category_id ?? "")?.name ?? "sem categoria";
      registrar({ codigo: cod, ok: false, texto: `Não é ${nomeCategoria}`, detalhe: `${nome} — categoria: ${real}. Não entrou.` });
      return;
    }
    try {
      await registerMovement({
        kind: "entrada",
        variantId: r.variant_id,
        quantity: 1,
        toLocationId: local,
        reasonCode: "compra",
        reference: referencia.trim(),
        note: `Entrada por leitor (${nomeCategoria})`,
      });
      apito(true);
      setContador((n) => n + 1);
      setPorPeca((m) => ({ ...m, [r.variant_id!]: { nome, qtd: (m[r.variant_id!]?.qtd ?? 0) + 1 } }));
      registrar({ codigo: cod, ok: true, texto: nome });
    } catch (e) {
      apito(false);
      setRecusados((n) => n + 1);
      registrar({ codigo: cod, ok: false, texto: "Não gravou", detalhe: (e as Error).message });
    }
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const cod = codigo.trim();
    setCodigo("");
    if (!cod || !pronto) return;
    setPendentes((n) => n + 1);
    fila.current = fila.current.then(() => processar(cod)).finally(() => setPendentes((n) => n - 1));
  }

  function zerar() {
    setContador(0);
    setRecusados(0);
    setLeituras([]);
    setPorPeca({});
    campo.current?.focus();
  }

  const opcoesLocal = (locais.data ?? []).map((l: { id: string; name: string; code?: string }) => ({
    value: l.id,
    label: l.code ? `${l.name} (${l.code})` : l.name,
  }));
  const opcoesCat = (categorias.data ?? [])
    .filter((c) => !c.parent_id)
    .map((c) => ({ value: c.id, label: c.name }));
  const ultima = leituras[0];

  return (
    <div className="space-y-5">
      <Panel title="Entrada rápida por leitor">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="ledger-eyebrow mb-2">1. Local de entrada</p>
            <SmartSelect options={opcoesLocal} value={local} onChange={setLocal} placeholder="Escolha o local" />
          </div>
          <div>
            <p className="ledger-eyebrow mb-2">Nota, pedido ou protocolo</p>
            <input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              aria-label="Referência do recebimento"
              placeholder="Ex.: NF 1234 ou Contagem 24/09"
              className="h-11 w-full rounded-[10px] border border-line bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div>
            <p className="ledger-eyebrow mb-2">2. Categoria desta entrada</p>
            <div className="flex flex-wrap gap-2">
              {opcoesCat.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategoria(c.value)}
                  className={
                    categoria === c.value
                      ? "rounded-[10px] bg-ink px-5 py-3 text-base font-semibold text-warm-ivory"
                      : "rounded-[10px] border border-line px-5 py-3 text-base font-semibold text-ledger-muted hover:bg-surface-muted"
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="ledger-panel p-6">
          <p className="ledger-eyebrow mb-3">3. Bipe as peças {nomeCategoria && `— entrada de ${nomeCategoria}`}</p>
          <form onSubmit={enviar}>
            <label className="flex items-center gap-4 rounded-2xl border-2 border-ink bg-background px-6 py-6 focus-within:ring-4 focus-within:ring-ring/30">
              <ScanBarcode className="h-12 w-12 shrink-0 text-ledger-text" />
              <input
                ref={campo}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                disabled={!pronto}
                autoComplete="off"
                inputMode="none"
                aria-label="Código de barras"
                placeholder={pronto ? "Aguardando leitura…" : "Preencha local, referência e categoria"}
                className="w-full bg-transparent font-display text-4xl font-bold tracking-wide text-ledger-text outline-none placeholder:text-ledger-muted/60"
              />
            </label>
          </form>
          {ultima && (
            <div
              role="status"
              className={`mt-5 rounded-2xl px-6 py-5 ${ultima.ok ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}
            >
              <p className="text-2xl font-bold">{ultima.ok ? "✓ Entrou" : "✕ Recusado"} — {ultima.texto}</p>
              {ultima.detalhe && <p className="mt-1 text-base">{ultima.detalhe}</p>}
              <p className="mt-1 text-sm opacity-70">Código {ultima.codigo}</p>
            </div>
          )}
          <ul className="mt-5 max-h-72 divide-y divide-line overflow-auto text-sm">
            {leituras.slice(1).map((l) => (
              <li key={l.id} className="flex justify-between gap-3 py-2">
                <span className={l.ok ? "text-ledger-text" : "text-destructive"}>
                  {l.ok ? "✓" : "✕"} {l.texto}
                </span>
                <span className="shrink-0 text-ledger-muted">{l.codigo} · {l.hora}</span>
              </li>
            ))}
          </ul>
        </div>

        <aside className="space-y-4">
          <div className="ledger-panel p-6 text-center">
            <p className="ledger-eyebrow">Peças que entraram</p>
            <p data-testid="contador" className="font-display text-8xl font-bold tabular-nums text-ledger-text">
              {formatInt(contador)}
            </p>
            <p className="text-sm text-ledger-muted">
              {recusados > 0 ? `${formatInt(recusados)} recusada(s)` : "nenhuma recusada"}
              {pendentes > 0 && ` · gravando ${pendentes}…`}
            </p>
            <button
              type="button"
              onClick={zerar}
              className="mt-4 inline-flex items-center gap-2 rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-ledger-muted hover:bg-surface-muted"
            >
              <RotateCcw className="h-4 w-4" /> Zerar contador
            </button>
          </div>
          <div className="ledger-panel p-5">
            <p className="ledger-eyebrow mb-2">Por peça</p>
            {Object.keys(porPeca).length === 0 ? (
              <p className="text-sm text-ledger-muted">Sem dados.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {Object.entries(porPeca).map(([id, p]) => (
                  <li key={id} className="flex justify-between gap-2">
                    <span className="truncate">{p.nome}</span>
                    <strong className="tabular-nums">{p.qtd}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackageCheck, ScanBarcode, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { TelaCheia } from "@/components/admin/TelaCheia";
import { useCapabilities } from "@/lib/capabilities";
import { listStockLocations } from "@/lib/stock";
import { chaveIdempotencia, traduzir } from "@/lib/maletas";

export const Route = createFileRoute("/_authenticated/admin/maletas_/entrada")({
  component: EntradaMaletaPage,
  head: () => ({
    meta: [
      { title: "Entrada de maleta — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type EntradaResumo = {
  id: string;
  codigo: string;
  status: "aberta" | "concluida" | "cancelada";
  total_pecas: number;
  referencia: string;
  consultora: string;
  consultora_ativada: boolean;
  local: string;
  criada_em: string;
  aberta_por: string | null;
};
type Leitura = { id: string; codigo: string; peca: string; quando: string; estornada: boolean };
type Detalhe = EntradaResumo & { leituras: Leitura[]; consultora_status_anterior: string | null };
type Resultado = { ok: boolean; texto: string; codigo: string };

async function rpc<T>(nome: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(nome as never, args as never);
  if (error) throw error;
  return data as T;
}

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

const SITUACAO = {
  aberta: { rotulo: "Em conferência", tom: "warning" },
  concluida: { rotulo: "Concluída", tom: "success" },
  cancelada: { rotulo: "Cancelada (sem peças)", tom: "neutral" },
} as const;

function NovaEntrada({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const [busca, setBusca] = React.useState("");
  const [limite, setLimite] = React.useState(60);
  const [rotuloEscolhida, setRotuloEscolhida] = React.useState<{ id: string; display_name: string; situacao: string } | null>(null);
  const [consultora, setConsultora] = React.useState("");
  const [local, setLocal] = React.useState("");
  const [referencia, setReferencia] = React.useState("");

  const consultoras = useQuery({
    queryKey: ["entrada-maleta", "consultoras", busca, limite],
    queryFn: () =>
      rpc<{ total: number; itens: { id: string; display_name: string; code: string | null; situacao: string }[] }>(
        "kit_entrada_consultoras",
        { _busca: busca || null, _limit: limite },
      ),
  });
  const locais = useQuery({ queryKey: ["entrada-maleta", "locais"], queryFn: listStockLocations });
  const opcoesLocal = (locais.data ?? [])
    .filter((l: { kind?: string; is_blocked?: boolean }) => (l.kind === "deposito" || l.kind === "loja") && !l.is_blocked)
    .map((l: { id: string; name: string; code?: string }) => ({ value: l.id, label: l.code ? `${l.name} (${l.code})` : l.name }));

  React.useEffect(() => {
    if (!local && locais.data?.length) {
      const dep = locais.data.find((l: { code?: string }) => l.code === "DEP-01");
      if (dep) setLocal(dep.id);
    }
  }, [locais.data, local]);

  const escolhida = consultoras.data?.itens.find((c) => c.id === consultora) ?? (rotuloEscolhida?.id === consultora ? rotuloEscolhida : undefined);
  const opcoesConsultora = (consultoras.data?.itens ?? []).map((c) => ({
    value: c.id,
    label: c.display_name,
    hint: c.situacao === "ativo" ? "Ativa" : "Inativa — será ativada",
  }));
  if (escolhida && !opcoesConsultora.some((o) => o.value === escolhida.id)) {
    opcoesConsultora.unshift({ value: escolhida.id, label: escolhida.display_name, hint: escolhida.situacao === "ativo" ? "Ativa" : "Inativa — será ativada" });
  }

  const abrir = useMutation({
    mutationFn: () =>
      rpc<{ id: string; codigo: string; ativada: boolean; consultora: string }>("kit_entrada_abrir", {
        _consultora: consultora,
        _location: local,
        _referencia: referencia,
        _nota: null,
      }),
    onSuccess: (r) => {
      toast.success(
        r.ativada ? `${r.codigo} aberta. ${r.consultora} agora está ativa.` : `${r.codigo} aberta para ${r.consultora}.`,
      );
      aoAbrir(r.id);
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  return (
    <Panel title="Nova entrada de maleta">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">1. Consultora (obrigatória)</span>
          <SmartSelect
            value={consultora}
            onChange={(v) => {
              setConsultora(v);
              const c = consultoras.data?.itens.find((x) => x.id === v);
              if (c) setRotuloEscolhida(c);
            }}
            onSearch={(t) => {
              setBusca(t);
              setLimite(60);
            }}
            loading={consultoras.isLoading}
            options={opcoesConsultora}
            footer={
              consultoras.data ? (
                <div className="flex items-center justify-between gap-2">
                  <span>
                    Mostrando {Math.min(consultoras.data.itens.length, consultoras.data.total).toLocaleString("pt-BR")} de{" "}
                    {consultoras.data.total.toLocaleString("pt-BR")}
                    {!busca && " · digite nome, código ou CPF"}
                  </span>
                  {consultoras.data.total > consultoras.data.itens.length && limite < 300 && (
                    <button type="button" className="underline" onClick={() => setLimite((l) => Math.min(l + 60, 300))}>
                      {consultoras.isFetching ? "Carregando…" : "Mostrar mais"}
                    </button>
                  )}
                </div>
              ) : null
            }
            searchPlaceholder="Buscar por nome, código ou CPF"
            placeholder="Escolher consultora"
          />
          <span className="text-xs text-ledger-muted">
            {escolhida && escolhida.situacao !== "ativo"
              ? "Ao abrir a entrada, ela passa a consultora ativa (fica registrado quem ativou)."
              : consultoras.data
                ? `${consultoras.data.total} consultora(s) encontradas`
                : "Digite para buscar em toda a base."}
          </span>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">2. Entra no local</span>
          <SmartSelect value={local} onChange={setLocal} options={opcoesLocal} placeholder="Escolher local" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">3. Referência</span>
          <input
            className="admin-input"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Ex.: Maleta antiga 24/09"
            aria-label="Referência da entrada"
          />
        </label>
      </div>
      <div className="mt-5">
        <button
          type="button"
          className="admin-btn admin-btn-primary"
          disabled={!consultora || !local || !referencia.trim() || abrir.isPending}
          onClick={() => abrir.mutate()}
        >
          <ScanBarcode aria-hidden className="size-4" /> {abrir.isPending ? "Abrindo…" : "Abrir e começar a bipar"}
        </button>
      </div>
    </Panel>
  );
}

function Conferencia({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const qc = useQueryClient();
  const detalhe = useQuery({
    queryKey: ["entrada-maleta", "detalhe", id],
    queryFn: () => rpc<Detalhe>("kit_entrada_detalhe", { _entrada: id }),
  });
  const [codigo, setCodigo] = React.useState("");
  const [ultimo, setUltimo] = React.useState<Resultado | null>(null);
  const [pendentes, setPendentes] = React.useState(0);
  const fila = React.useRef<Promise<void>>(Promise.resolve());
  const campo = React.useRef<HTMLInputElement>(null);
  const aberta = detalhe.data?.status === "aberta";

  React.useEffect(() => {
    if (!aberta) return;
    campo.current?.focus();
    const t = window.setInterval(() => {
      const ativo = document.activeElement;
      if (ativo !== campo.current && !(ativo instanceof HTMLButtonElement)) campo.current?.focus();
    }, 400);
    return () => window.clearInterval(t);
  }, [aberta]);

  const recarregar = () => qc.invalidateQueries({ queryKey: ["entrada-maleta"] });

  async function processar(cod: string) {
    try {
      const r = await rpc<{ peca: string; total: number }>("kit_entrada_bipar", {
        _entrada: id,
        _codigo: cod,
        _chave: chaveIdempotencia(),
      });
      apito(true);
      setUltimo({ ok: true, texto: r.peca, codigo: cod });
    } catch (e) {
      apito(false);
      setUltimo({ ok: false, texto: traduzir(e), codigo: cod });
    }
    await recarregar();
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const cod = codigo.trim();
    setCodigo("");
    if (!cod || !aberta) return;
    setPendentes((n) => n + 1);
    fila.current = fila.current.then(() => processar(cod)).finally(() => setPendentes((n) => n - 1));
  }

  const desfazer = useMutation({
    mutationFn: (item: string) => rpc("kit_entrada_desfazer", { _item: item }),
    onSuccess: () => {
      toast.success("Leitura desfeita e peça retirada do estoque.");
      void recarregar();
    },
    onError: (e) => toast.error(traduzir(e)),
    onSettled: () => campo.current?.focus(),
  });
  const concluir = useMutation({
    mutationFn: () => rpc<{ status: string; total: number }>("kit_entrada_concluir", { _entrada: id }),
    onSuccess: (r) => {
      toast.success(r.status === "concluida" ? `Entrada concluída com ${r.total} peça(s).` : "Entrada sem peças cancelada.");
      void recarregar();
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  if (detalhe.isLoading) return <Skeleton className="h-64" />;
  if (detalhe.isError || !detalhe.data)
    return <ErrorState message={traduzir(detalhe.error)} onRetry={() => void detalhe.refetch()} />;
  const d = detalhe.data;
  const validas = d.leituras.filter((l) => !l.estornada);
  const porPeca = Object.values(
    validas.reduce<Record<string, { peca: string; qtd: number }>>((m, l) => {
      m[l.peca] = { peca: l.peca, qtd: (m[l.peca]?.qtd ?? 0) + 1 };
      return m;
    }, {}),
  ).sort((a, b) => b.qtd - a.qtd);
  const s = SITUACAO[d.status];

  return (
    <TelaCheia>
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="admin-btn" onClick={aoFechar}>
          <ArrowLeft aria-hidden className="size-4" /> Voltar às entradas
        </button>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-ledger-text">{d.codigo}</span>
          <span className="text-ledger-muted">
            {d.consultora} · {d.local} · {d.referencia}
          </span>
          <StatusBadge tone={s.tom}>{s.rotulo}</StatusBadge>
          {d.consultora_ativada && <StatusBadge tone="info">Consultora ativada nesta entrada</StatusBadge>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="ledger-panel p-6">
          <form onSubmit={enviar}>
            <label className="flex items-center gap-4 rounded-2xl border-2 border-ink bg-background px-6 py-6 focus-within:ring-4 focus-within:ring-ring/30">
              <ScanBarcode className="h-12 w-12 shrink-0 text-ledger-text" />
              <input
                ref={campo}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                disabled={!aberta}
                autoComplete="off"
                inputMode="none"
                aria-label="Código de barras"
                placeholder={aberta ? "Bipe as peças da maleta…" : "Entrada encerrada"}
                className="w-full bg-transparent font-display text-4xl font-bold tracking-wide text-ledger-text outline-none placeholder:text-ledger-muted/60"
              />
            </label>
          </form>
          {ultimo && (
            <div
              role="status"
              className={`mt-5 rounded-2xl px-6 py-5 ${ultimo.ok ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}
            >
              <p className="text-2xl font-bold">
                {ultimo.ok ? "✓ Entrou no estoque" : "✕ Recusado"} — {ultimo.texto}
              </p>
              <p className="mt-1 text-sm opacity-70">Código {ultimo.codigo}</p>
            </div>
          )}
          <ul className="mt-5 max-h-80 divide-y divide-line overflow-auto text-sm">
            {d.leituras.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <span className={l.estornada ? "text-ledger-muted line-through" : "text-ledger-text"}>
                  {l.peca} <span className="text-ledger-muted">· {l.codigo}</span>
                </span>
                <span className="flex items-center gap-3 text-ledger-muted">
                  {new Date(l.quando).toLocaleTimeString("pt-BR")}
                  {aberta && !l.estornada && (
                    <button
                      type="button"
                      className="admin-btn"
                      aria-label={`Desfazer leitura ${l.codigo}`}
                      disabled={desfazer.isPending}
                      onClick={() => desfazer.mutate(l.id)}
                    >
                      <Undo2 aria-hidden className="size-4" />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-5">
          <div className="ledger-panel p-6 text-center">
            <p className="ledger-eyebrow">Peças que entraram</p>
            <p className="mt-2 font-display text-7xl font-bold tabular-nums text-ledger-text" aria-label="Contador">
              {d.total_pecas}
            </p>
            {pendentes > 0 && <p className="mt-2 text-sm text-ledger-muted">Gravando {pendentes}…</p>}
            {aberta && (
              <button
                type="button"
                className="admin-btn admin-btn-primary mt-5 w-full justify-center"
                disabled={concluir.isPending || pendentes > 0}
                onClick={() => concluir.mutate()}
              >
                <PackageCheck aria-hidden className="size-4" /> Concluir entrada
              </button>
            )}
          </div>
          <Panel title="Por peça">
            {porPeca.length === 0 ? (
              <p className="text-sm text-ledger-muted">Nenhuma peça ainda.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {porPeca.map((p) => (
                  <li key={p.peca} className="flex justify-between gap-3">
                    <span className="text-ledger-text">{p.peca}</span>
                    <span className="tabular-nums font-semibold">{p.qtd}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
    </TelaCheia>
  );
}

function EntradaMaletaPage() {
  const caps = useCapabilities();
  const pode = caps.includes("stock.operate");
  const [atual, setAtual] = React.useState<string | null>(null);
  const qc = useQueryClient();
  const lista = useQuery({
    queryKey: ["entrada-maleta", "lista"],
    queryFn: () => rpc<EntradaResumo[]>("kit_entradas_listar", { _limit: 50 }),
    enabled: pode,
  });

  if (!pode) {
    return <EmptyState title="Sem permissão" description="Só quem opera o estoque pode dar entrada de maleta." />;
  }
  if (atual) {
    return <Conferencia id={atual} aoFechar={() => { setAtual(null); void qc.invalidateQueries({ queryKey: ["entrada-maleta"] }); }} />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Maletas"
        title="Entrada de maleta"
        description="Peças que voltam da consultora entram no estoque uma a uma, pelo leitor. Toda entrada tem consultora vinculada, e ela passa a ativa."
        actions={
          <Link to="/admin/maletas" className="admin-btn">
            <ArrowLeft aria-hidden className="size-4" /> Maletas
          </Link>
        }
      />
      <NovaEntrada aoAbrir={setAtual} />
      <Panel title="Entradas recentes" flush>
        {lista.isLoading && <div className="p-6"><Skeleton className="h-14" /></div>}
        {lista.isError && <div className="px-6"><ErrorState message={traduzir(lista.error)} onRetry={() => void lista.refetch()} /></div>}
        {lista.data?.length === 0 && (
          <div className="px-6">
            <EmptyState title="Nenhuma entrada ainda" description="Abra a primeira entrada acima." />
          </div>
        )}
        {lista.data?.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setAtual(e.id)}
            className="flex w-full flex-wrap items-center justify-between gap-4 border-b border-line-soft px-6 py-4 text-left transition hover:bg-surface-muted"
          >
            <div className="min-w-0">
              <p className="font-semibold text-ledger-text">
                {e.codigo} <span className="text-ledger-muted">· {e.referencia}</span>
              </p>
              <p className="text-sm text-ledger-muted">
                {e.consultora} · {e.local} · {new Date(e.criada_em).toLocaleString("pt-BR")}
                {e.aberta_por ? ` · por ${e.aberta_por}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="tabular-nums font-semibold">{e.total_pecas} peças</span>
              <StatusBadge tone={SITUACAO[e.status].tom}>{SITUACAO[e.status].rotulo}</StatusBadge>
            </div>
          </button>
        ))}
      </Panel>
    </div>
  );
}

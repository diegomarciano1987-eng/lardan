import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Plus, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge, Skeleton } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { useCapabilities } from "@/lib/capabilities";
import { supabase } from "@/integrations/supabase/client";
import {
  SITUACAO_MALETA,
  brl,
  criarCiclo,
  listarMaletas,
  traduzir,
  type MaletaCard,
} from "@/lib/maletas";

export const Route = createFileRoute("/_authenticated/admin/maletas")({
  component: MaletasPage,
  head: () => ({
    meta: [
      { title: "Maletas — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const TOM = { neutro: "neutral", aviso: "warning", ok: "success", erro: "danger" } as const;

const SITUACOES = [
  { value: "todas", label: "Todas as situações" },
  ...Object.entries(SITUACAO_MALETA).map(([value, v]) => ({ value, label: v.rotulo })),
];

async function buscarPessoas(papel: "consultora" | "representante", termo: string) {
  const { data, error } = await supabase.rpc("list_parties", {
    _limit: 30,
    _offset: 0,
    _role: papel,
    ...(termo.trim() ? { _search: termo.trim() } : {}),
  } as never);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; display_name: string }[]).map((p) => ({
    value: p.id,
    label: p.display_name,
  }));
}

function NovaMaleta({ aoCriar }: { aoCriar: (cycleId: string) => void }) {
  const [aberto, setAberto] = React.useState(false);
  const [consultora, setConsultora] = React.useState("");
  const [representante, setRepresentante] = React.useState("");
  const [etiqueta, setEtiqueta] = React.useState("");

  const consultoras = useQuery({
    queryKey: ["maletas", "pessoas", "consultora"],
    queryFn: () => buscarPessoas("consultora", ""),
    enabled: aberto,
  });
  const representantes = useQuery({
    queryKey: ["maletas", "pessoas", "representante"],
    queryFn: () => buscarPessoas("representante", ""),
    enabled: aberto,
  });

  const criar = useMutation({
    mutationFn: () =>
      criarCiclo({
        consultora_party_id: consultora || null,
        representante_party_id: representante || null,
        label: etiqueta || null,
      }),
    onSuccess: (r) => {
      toast.success("Maleta aberta para montagem.");
      setAberto(false);
      aoCriar(r.cycle_id);
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  if (!aberto) {
    return (
      <button type="button" className="admin-btn admin-btn-primary" onClick={() => setAberto(true)}>
        <Plus aria-hidden className="size-4" /> Nova maleta
      </button>
    );
  }

  return (
    <Panel title="Nova maleta" className="w-full">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Consultora</span>
          <SmartSelect
            value={consultora}
            onChange={setConsultora}
            options={consultoras.data ?? []}
            placeholder="Escolher consultora"
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Representante (opcional)</span>
          <SmartSelect
            value={representante}
            onChange={setRepresentante}
            options={representantes.data ?? []}
            placeholder="Entrega direta"
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Etiqueta</span>
          <input
            className="admin-input"
            value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)}
            placeholder="Ex.: Maleta primavera"
          />
        </label>
      </div>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          className="admin-btn admin-btn-primary"
          disabled={criar.isPending}
          onClick={() => criar.mutate()}
        >
          {criar.isPending ? "Abrindo…" : "Abrir montagem"}
        </button>
        <button type="button" className="admin-btn" onClick={() => setAberto(false)}>
          Cancelar
        </button>
      </div>
    </Panel>
  );
}

function Linha({ m }: { m: MaletaCard }) {
  const s = SITUACAO_MALETA[m.situacao] ?? { rotulo: m.situacao, tom: "neutro" as const };
  return (
    <Link
      to="/admin/maletas/$id"
      params={{ id: m.cycle_id }}
      className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft px-6 py-4 transition hover:bg-surface-muted"
    >
      <div className="min-w-0">
        <p className="font-semibold text-ledger-text">
          {m.codigo} <span className="text-ledger-muted">· ciclo {m.ciclo}</span>
        </p>
        <p className="text-sm text-ledger-muted">
          {m.consultora ?? "Sem consultora definida"}
          {m.representante ? ` · via ${m.representante}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <span className="tabular-nums text-ledger-muted">{m.pecas} peças</span>
        <span className="tabular-nums font-semibold text-ledger-text">{brl(Number(m.valor_cents ?? 0))}</span>
        <StatusBadge tone={TOM[s.tom]}>{s.rotulo}</StatusBadge>
      </div>
    </Link>
  );
}

function MaletasPage() {
  const caps = useCapabilities();
  const podeMontar = caps.includes("kit.manage");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [situacao, setSituacao] = React.useState("todas");
  const [qr, setQr] = React.useState("");

  const lista = useQuery({
    queryKey: ["maletas", "board", situacao],
    queryFn: () => listarMaletas(situacao),
  });

  async function abrirPorQr() {
    const token = qr.trim().split("/").pop() ?? "";
    if (!token) return;
    const { data, error } = await supabase.from("kits").select("id").eq("qr_token", token).maybeSingle();
    if (error || !data) {
      toast.error("Maleta não encontrada para este código.");
      return;
    }
    const alvo = (lista.data ?? []).find((m) => m.kit_id === data.id);
    if (!alvo) {
      toast.error("Nenhum ciclo desta maleta está visível para você.");
      return;
    }
    navigate({ to: "/admin/maletas/$id", params: { id: alvo.cycle_id } });
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Núcleo comercial"
        title="Maletas"
        description="Montagem, conferência, expedição, cadeia de custódia e aceite. Todas as ações usam as regras transacionais do banco."
        actions={
          podeMontar ? (
            <NovaMaleta
              aoCriar={(id) => {
                qc.invalidateQueries({ queryKey: ["maletas"] });
                navigate({ to: "/admin/maletas/$id", params: { id } });
              }}
            />
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-64">
          <SmartSelect value={situacao} onChange={setSituacao} options={SITUACOES} placeholder="Situação" />
        </div>
        <div className="flex items-center gap-2">
          <input
            className="admin-input w-72"
            value={qr}
            onChange={(e) => setQr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void abrirPorQr();
            }}
            placeholder="Bipar QR ou colar o código da maleta"
          />
          <button type="button" className="admin-btn" onClick={() => void abrirPorQr()}>
            <ScanLine aria-hidden className="size-4" /> Abrir
          </button>
        </div>
      </div>

      <Panel flush>
        {lista.isLoading && <div className="space-y-2 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
        {lista.isError && (
          <div className="px-6">
            <ErrorState message={traduzir(lista.error)} onRetry={() => void lista.refetch()} />
          </div>
        )}
        {lista.data?.length === 0 && (
          <div className="px-6">
            <EmptyState
              title="Nenhuma maleta nesta situação"
              description="Abra uma nova maleta para começar a montagem, ou mude o filtro de situação."
            />
          </div>
        )}
        {lista.data?.map((m) => <Linha key={m.cycle_id} m={m} />)}
      </Panel>

      <p className="flex items-center gap-2 text-xs text-ledger-muted">
        <BriefcaseBusiness aria-hidden className="size-4" />
        Peças em trânsito, divergentes ou reservadas não contam como disponíveis para venda.
      </p>
    </div>
  );
}

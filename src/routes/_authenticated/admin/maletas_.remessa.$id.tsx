import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { BackButton, EmptyState, ErrorState, Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { useCapabilities } from "@/lib/capabilities";
import { SITUACAO_MALETA, brl, traduzir } from "@/lib/maletas";
import {
  STATUS_REMESSA,
  abrirMaletaNaRemessa,
  consultorasDaPraca,
  dataBR,
  listarRemessas,
  maletasDaRemessa,
} from "@/lib/remessas";

export const Route = createFileRoute("/_authenticated/admin/maletas_/remessa/$id")({
  component: RemessaPage,
  head: () => ({
    meta: [
      { title: "Remessa — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const TOM = { neutro: "neutral", aviso: "warning", ok: "success", erro: "danger" } as const;

function Card({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line-soft bg-surface p-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ledger-text">{valor}</p>
    </div>
  );
}

function RemessaPage() {
  const { id } = Route.useParams();
  const caps = useCapabilities();
  const podeMontar = caps.includes("kit.manage");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [consultora, setConsultora] = React.useState("");
  const [busca, setBusca] = React.useState("");

  const remessa = useQuery({
    queryKey: ["remessas", "lista", "todas"],
    queryFn: () => listarRemessas(),
    select: (l) => l.find((r) => r.id === id) ?? null,
  });
  const maletas = useQuery({ queryKey: ["remessas", "maletas", id], queryFn: () => maletasDaRemessa(id) });
  const r = remessa.data;
  const consultoras = useQuery({
    queryKey: ["remessas", "consultoras", r?.praca_id, busca],
    queryFn: () => consultorasDaPraca(r!.praca_id, busca),
    enabled: !!r,
  });
  const jaTem = new Set((maletas.data ?? []).map((m) => m.consultora_party_id));
  const opcoes = (consultoras.data ?? []).map((o) => (jaTem.has(o.value) ? { ...o, label: `${o.label} · já tem maleta` } : o));

  const abrir = useMutation({
    mutationFn: () => {
      if (!consultora) throw new Error("Escolha a consultora.");
      return abrirMaletaNaRemessa(id, consultora);
    },
    onSuccess: (res) => {
      toast.success(res.repetida ? "Esta consultora já tem maleta nesta remessa." : "Maleta aberta para montagem.");
      qc.invalidateQueries({ queryKey: ["remessas"] });
      navigate({ to: "/admin/maletas/$id", params: { id: res.cycle_id } });
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  if (remessa.isLoading) return <Skeleton className="h-40" />;
  if (remessa.isError) return <ErrorState message={traduzir(remessa.error)} onRetry={() => void remessa.refetch()} />;
  if (!r) return <EmptyState title="Remessa não encontrada" description="Ela pode não existir ou não estar visível para você." />;
  const s = STATUS_REMESSA[r.status] ?? { rotulo: r.status, tom: "neutral" as const };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start gap-4">
        <BackButton />
        <div className="min-w-0 flex-1">
          <p className="ledger-eyebrow">Remessa · {r.praca}</p>
          <h1 className="font-display text-4xl font-bold text-ledger-text">Remessa {r.numero}</h1>
          <p className="mt-1 text-sm text-ledger-muted">
            Emissão {dataBR(r.data_emissao)} · Acerto {dataBR(r.data_acerto)}
            {r.representante ? ` · Representante ${r.representante}` : " · Entrega direta"}
          </p>
        </div>
        <StatusBadge tone={s.tom}>{s.rotulo}</StatusBadge>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Card rotulo="Consultoras na praça" valor={r.consultoras_praca} />
        <Card rotulo="Maletas abertas" valor={r.maletas} />
        <Card rotulo="Conferidas" valor={r.maletas_conferidas} />
        <Card rotulo="Peças" valor={r.pecas} />
        <Card rotulo="Valor consignado" valor={brl(Number(r.valor_cents))} />
      </div>

      {podeMontar && r.status !== "fechada" && r.status !== "cancelada" && (
        <Panel title="Abrir maleta nesta remessa">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-80 flex-1 gap-1.5 text-sm">
              <span className="ledger-eyebrow">Consultora da praça {r.praca}</span>
              <SmartSelect value={consultora} onChange={setConsultora} options={opcoes} onSearch={setBusca}
                loading={consultoras.isFetching} searchPlaceholder="Buscar por nome ou CPF" placeholder="Escolher consultora" />
              <span className="text-xs text-ledger-muted">
                {consultoras.data ? `${consultoras.data.length} consultora(s) encontradas nesta praça` : "Carregando consultoras…"}
              </span>
            </label>
            <button type="button" className="admin-btn admin-btn-primary" disabled={abrir.isPending} onClick={() => abrir.mutate()}>
              <Plus aria-hidden className="size-4" /> {abrir.isPending ? "Abrindo…" : "Abrir maleta"}
            </button>
          </div>
        </Panel>
      )}

      <Panel title="Maletas da remessa" flush>
        {maletas.isLoading && <div className="p-6"><Skeleton className="h-14" /></div>}
        {maletas.data?.length === 0 && (
          <div className="px-6"><EmptyState title="Nenhuma maleta ainda" description="Escolha uma consultora da praça acima para abrir a primeira maleta." /></div>
        )}
        {maletas.data?.map((m) => {
          const st = SITUACAO_MALETA[m.status] ?? { rotulo: m.status, tom: "neutro" as const };
          return (
            <Link key={m.cycle_id} to="/admin/maletas/$id" params={{ id: m.cycle_id }}
              className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft px-6 py-4 transition hover:bg-surface-muted">
              <p className="font-semibold text-ledger-text">{m.consultora ?? "Sem consultora"}</p>
              <div className="flex items-center gap-6 text-sm">
                <span className="tabular-nums text-ledger-muted">{m.pecas} peças</span>
                <span className="tabular-nums font-semibold text-ledger-text">{brl(Number(m.valor_cents ?? 0))}</span>
                <StatusBadge tone={TOM[st.tom]}>{st.rotulo}</StatusBadge>
              </div>
            </Link>
          );
        })}
      </Panel>
    </div>
  );
}

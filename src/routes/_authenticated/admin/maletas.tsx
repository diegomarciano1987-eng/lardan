import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Plus, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge, Skeleton } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { useCapabilities } from "@/lib/capabilities";
import { supabase } from "@/integrations/supabase/client";
import { brl, traduzir } from "@/lib/maletas";
import { STATUS_REMESSA, criarRemessa, dataBR, isoDia, listarRemessas, type RemessaCard } from "@/lib/remessas";

export const Route = createFileRoute("/_authenticated/admin/maletas")({
  component: RemessasPage,
  head: () => ({
    meta: [
      { title: "Remessas — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const SITUACOES = [
  { value: "todas", label: "Todas as situações" },
  ...Object.entries(STATUS_REMESSA).map(([value, v]) => ({ value, label: v.rotulo })),
];

async function buscarPracas() {
  const { data, error } = await supabase.rpc("pracas_resumo" as never);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; nome: string; ativo: boolean; consultoras: number }[])
    .filter((p) => p.ativo)
    .map((p) => ({ value: p.id, label: `${p.nome} · ${p.consultoras} consultoras` }));
}

async function buscarRepresentantes(termo: string) {
  const { data, error } = await supabase.rpc("list_parties", {
    _limit: 40,
    _offset: 0,
    _role: "representante",
    ...(termo.trim() ? { _search: termo.trim() } : {}),
  } as never);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; display_name: string }[]).map((p) => ({ value: p.id, label: p.display_name }));
}

async function buscarDepositos() {
  const { data, error } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("kind", "deposito")
    .eq("is_active", true)
    .order("code");
  if (error) throw error;
  return (data ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }));
}

function NovaRemessa({ aoCriar }: { aoCriar: (id: string) => void }) {
  const [aberto, setAberto] = React.useState(false);
  const [praca, setPraca] = React.useState("");
  const [numero, setNumero] = React.useState("");
  const [emissao, setEmissao] = React.useState<Date | undefined>(new Date());
  const [acerto, setAcerto] = React.useState<Date | undefined>();
  const [representante, setRepresentante] = React.useState("");
  const [buscaR, setBuscaR] = React.useState("");
  const [deposito, setDeposito] = React.useState("");

  const pracas = useQuery({ queryKey: ["remessas", "pracas"], queryFn: buscarPracas, enabled: aberto });
  const reps = useQuery({ queryKey: ["remessas", "reps", buscaR], queryFn: () => buscarRepresentantes(buscaR), enabled: aberto });
  const depositos = useQuery({ queryKey: ["remessas", "depositos"], queryFn: buscarDepositos, enabled: aberto });
  React.useEffect(() => {
    if (depositos.data?.length === 1 && !deposito) setDeposito(depositos.data[0]!.value);
  }, [depositos.data, deposito]);

  const criar = useMutation({
    mutationFn: () => {
      if (!praca) throw new Error("Escolha a praça da remessa.");
      return criarRemessa({
        praca,
        numero: numero.trim() ? Number(numero) : null,
        data_emissao: isoDia(emissao),
        data_acerto: isoDia(acerto),
        representante: representante || null,
        deposito: deposito || null,
      });
    },
    onSuccess: (r) => {
      toast.success(`Remessa nº ${r.numero} aberta.`);
      setAberto(false);
      aoCriar(r.id);
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  if (!aberto) {
    return (
      <button type="button" className="admin-btn admin-btn-primary" onClick={() => setAberto(true)}>
        <Plus aria-hidden className="size-4" /> Nova remessa
      </button>
    );
  }

  return (
    <Panel title="Nova remessa" className="w-full">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="grid gap-1.5 text-sm md:col-span-2">
          <span className="ledger-eyebrow">Praça</span>
          <SmartSelect value={praca} onChange={setPraca} options={pracas.data ?? []} loading={pracas.isFetching} placeholder="Escolher praça" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Número da remessa</span>
          <input className="admin-input" inputMode="numeric" value={numero}
            onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))} placeholder="Automático (próximo número)" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Data de emissão</span>
          <DateField value={emissao} onChange={setEmissao} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Data de acerto</span>
          <DateField value={acerto} onChange={setAcerto} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Representante</span>
          <SmartSelect value={representante} onChange={setRepresentante} options={reps.data ?? []} onSearch={setBuscaR}
            loading={reps.isFetching} searchPlaceholder="Buscar representante" placeholder="Entrega direta" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Depósito de origem</span>
          <SmartSelect value={deposito} onChange={setDeposito} options={depositos.data ?? []} placeholder="Escolher depósito" />
        </label>
      </div>
      <div className="mt-5 flex gap-2">
        <button type="button" className="admin-btn admin-btn-primary" disabled={criar.isPending} onClick={() => criar.mutate()}>
          {criar.isPending ? "Abrindo…" : "Abrir remessa"}
        </button>
        <button type="button" className="admin-btn" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </Panel>
  );
}

function Linha({ r }: { r: RemessaCard }) {
  const s = STATUS_REMESSA[r.status] ?? { rotulo: r.status, tom: "neutral" as const };
  return (
    <Link to="/admin/maletas/remessa/$id" params={{ id: r.id }}
      className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft px-6 py-4 transition hover:bg-surface-muted">
      <div className="min-w-0">
        <p className="font-semibold text-ledger-text">
          Remessa {r.numero} <span className="text-ledger-muted">· {r.praca}</span>
        </p>
        <p className="text-sm text-ledger-muted">
          Emissão {dataBR(r.data_emissao)} · Acerto {dataBR(r.data_acerto)}
          {r.representante ? ` · ${r.representante}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <span className="tabular-nums text-ledger-muted">{r.maletas} maletas · {r.maletas_conferidas} conferidas</span>
        <span className="tabular-nums text-ledger-muted">{r.pecas} peças</span>
        <span className="tabular-nums font-semibold text-ledger-text">{brl(Number(r.valor_cents ?? 0))}</span>
        <StatusBadge tone={s.tom}>{s.rotulo}</StatusBadge>
      </div>
    </Link>
  );
}

function RemessasPage() {
  const caps = useCapabilities();
  const podeMontar = caps.includes("kit.manage");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [situacao, setSituacao] = React.useState("todas");
  const [qr, setQr] = React.useState("");

  const lista = useQuery({ queryKey: ["remessas", "lista", situacao], queryFn: () => listarRemessas(situacao) });

  async function abrirPorQr() {
    const bruto = qr.trim();
    const token = (/[?&]qr=([^&#\s]+)/.exec(bruto)?.[1] ?? bruto.split("/").pop() ?? "").trim();
    if (!token) return;
    const { data, error } = await supabase.from("kits").select("id").eq("qr_token", token).maybeSingle();
    if (error || !data) {
      toast.error("Maleta não encontrada para este código.");
      return;
    }
    const { data: ciclo } = await supabase.from("kit_cycles").select("id").eq("kit_id", data.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!ciclo) {
      toast.error("Nenhum ciclo desta maleta está visível para você.");
      return;
    }
    navigate({ to: "/admin/maletas/$id", params: { id: ciclo.id } });
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Núcleo comercial"
        title="Remessas"
        description="Cada remessa tem seu número e sua praça. As maletas das consultoras são abertas dentro da remessa."
        actions={
          <div className="flex flex-wrap gap-2">
            {caps.includes("stock.operate") && (
              <Link to="/admin/maletas/entrada" className="admin-btn">
                <ScanLine aria-hidden className="size-4" /> Entrada de maleta
              </Link>
            )}
            {podeMontar && (
              <NovaRemessa aoCriar={(id) => {
                qc.invalidateQueries({ queryKey: ["remessas"] });
                navigate({ to: "/admin/maletas/remessa/$id", params: { id } });
              }} />
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-64">
          <SmartSelect value={situacao} onChange={setSituacao} options={SITUACOES} placeholder="Situação" />
        </div>
        <div className="flex items-center gap-2">
          <input className="admin-input w-72" value={qr} onChange={(e) => setQr(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void abrirPorQr(); }}
            placeholder="Bipar QR ou colar o código da maleta" />
          <button type="button" className="admin-btn" onClick={() => void abrirPorQr()}>
            <ScanLine aria-hidden className="size-4" /> Abrir
          </button>
        </div>
      </div>

      <Panel flush>
        {lista.isLoading && <div className="space-y-2 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
        {lista.isError && (
          <div className="px-6"><ErrorState message={traduzir(lista.error)} onRetry={() => void lista.refetch()} /></div>
        )}
        {lista.data?.length === 0 && (
          <div className="px-6">
            <EmptyState title="Nenhuma remessa nesta situação"
              description="Abra uma nova remessa escolhendo a praça; depois as maletas das consultoras são abertas dentro dela." />
          </div>
        )}
        {lista.data?.map((r) => <Linha key={r.id} r={r} />)}
      </Panel>

      <p className="flex items-center gap-2 text-xs text-ledger-muted">
        <BriefcaseBusiness aria-hidden className="size-4" />
        Peças em trânsito, divergentes ou reservadas não contam como disponíveis para venda.
      </p>
    </div>
  );
}

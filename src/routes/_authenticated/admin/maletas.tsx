import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Plus, ScanLine, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge, Skeleton } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { DateRangeField } from "@/components/premium/DateRangeField";
import type { DateRange } from "react-day-picker";
import { useCapabilities } from "@/lib/capabilities";
import { useColabEscopo } from "@/lib/colab-escopo";
import { supabase } from "@/integrations/supabase/client";
import { brl, traduzir } from "@/lib/maletas";
import { remessasHistorico } from "@/lib/historico-jflex";
import { RemessasHistorico } from "@/components/admin/historico/RemessasHistorico";
import { MaletasNaRua } from "@/components/admin/maletas/MaletasNaRua";
import { ConfigurarImpressora } from "@/components/admin/maletas/ConfigurarImpressora";
import { AcertosPainel } from "@/components/admin/maletas/AcertosPainel";
import { STATUS_REMESSA, buscarRemessas, criarRemessa, dataBR, definirEnvioRemessa, isoDia, type RemessaCard, type TipoEnvio } from "@/lib/remessas";

export const Route = createFileRoute("/_authenticated/admin/maletas")({
  component: RemessasPage,
  head: () => ({
    meta: [
      { title: "Remessas — Administração LARDAN" },
      { name: "description", content: "Remessas e maletas da carteira autorizada LARDAN." },
      { property: "og:title", content: "Remessas e maletas — LARDAN" },
      { property: "og:description", content: "Consulta e operação autorizada das remessas por representante." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  const { lerColabEscopo } = await import("@/lib/colab-escopo");
  const escopo = await lerColabEscopo();
  if (escopo.colaboradora) return escopo.representante ? [{ value: escopo.representante, label: escopo.nome ?? "Representante vinculado" }] : [];
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
  // RPC escopada: colaboradora não lê locations diretamente; Depósito Principal (DEP-01) vem primeiro.
  const { data, error } = await supabase.rpc("kit_depositos_operacao");
  if (error) throw error;
  return (data ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }));
}

function NovaRemessa({ aoCriar }: { aoCriar: (id: string) => void }) {
  const escopo = useColabEscopo();
  const [aberto, setAberto] = React.useState(false);
  const [praca, setPraca] = React.useState("");
  const [numero, setNumero] = React.useState("");
  const [emissao, setEmissao] = React.useState<Date | undefined>(new Date());
  const [acerto, setAcerto] = React.useState<Date | undefined>();
  const [representante, setRepresentante] = React.useState("");
  const [buscaR, setBuscaR] = React.useState("");
  const [deposito, setDeposito] = React.useState("");
  const [envio, setEnvio] = React.useState<TipoEnvio>("pessoal");
  React.useEffect(() => { if (escopo.data?.colaboradora) setRepresentante(escopo.data.representante ?? ""); }, [escopo.data]);

  const pracas = useQuery({ queryKey: ["remessas", "pracas"], queryFn: buscarPracas, enabled: aberto });
  const reps = useQuery({ queryKey: ["remessas", "reps", escopo.data?.colaboradora, escopo.data?.representante, buscaR], queryFn: () => buscarRepresentantes(buscaR), enabled: aberto && escopo.isSuccess });
  const representantes = escopo.data?.colaboradora ? (escopo.data.representante ? [{ value: escopo.data.representante, label: escopo.data.nome ?? "Representante vinculado" }] : []) : reps.data ?? [];
  const depositos = useQuery({ queryKey: ["remessas", "depositos"], queryFn: buscarDepositos, enabled: aberto });
  React.useEffect(() => {
    const principal = depositos.data?.find((d) => d.label.startsWith("DEP-01")) ?? (depositos.data?.length === 1 ? depositos.data[0] : undefined);
    if (principal && !deposito) setDeposito(principal.value);
  }, [depositos.data, deposito]);

  const criar = useMutation({
    mutationFn: async () => {
      if (!praca) throw new Error("Escolha a praça da remessa.");
      const r = await criarRemessa({
        praca,
        numero: numero.trim() ? Number(numero) : null,
        data_emissao: isoDia(emissao),
        data_acerto: isoDia(acerto),
        representante: representante || null,
        deposito: deposito || null,
      });
      if (envio === "correio") await definirEnvioRemessa(r.id, "correio");
      return r;
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
            onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))} placeholder="Automático: próximo número livre (nunca repete o SmallData)" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Como a maleta vai</span>
          <SmartSelect value={envio} onChange={(v) => setEnvio((v || "pessoal") as TipoEnvio)}
            options={[{ value: "pessoal", label: "Pessoalmente (representante ou retirada)" }, { value: "correio", label: "Pelo correio" }]} />
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
          <SmartSelect value={escopo.data?.colaboradora ? escopo.data.representante ?? "" : representante} onChange={setRepresentante} options={representantes} {...(!escopo.data?.colaboradora ? { onSearch: setBuscaR } : {})}
            loading={reps.isFetching} searchPlaceholder="Buscar representante" placeholder={escopo.data?.colaboradora ? "Sem representante vinculado" : "Entrega direta"} />
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
  const escopo = useColabEscopo();
  const colab = escopo.data?.colaboradora === true;
  const podeMontar = caps.includes("kit.manage");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [situacao, setSituacao] = React.useState("todas");
  const [qr, setQr] = React.useState("");
  const [texto, setTexto] = React.useState("");
  const [busca, setBusca] = React.useState("");
  const [praca, setPraca] = React.useState("");
  const [rep, setRep] = React.useState("");
  const [buscaRep, setBuscaRep] = React.useState("");
  const [fonte, setFonte] = React.useState<"lardan" | "jflex">("lardan");
  const [remessaAberta, setRemessaAberta] = React.useState<number | null>(null);
  const [periodo, setPeriodo] = React.useState<DateRange | undefined>();
  const [campoData, setCampoData] = React.useState<"emissao" | "acerto">("emissao");
  React.useEffect(() => { if (escopo.data?.colaboradora) setRep(escopo.data.representante ?? ""); }, [escopo.data]);
  React.useEffect(() => {
    const t = setTimeout(() => setBusca(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const pracas = useQuery({ queryKey: ["remessas", "pracas"], queryFn: buscarPracas });
  const reps = useQuery({ queryKey: ["remessas", "reps", colab, escopo.data?.representante, buscaRep], queryFn: () => buscarRepresentantes(buscaRep), enabled: escopo.isSuccess });
  const representantes = colab ? (escopo.data?.representante ? [{ value: escopo.data.representante, label: escopo.data.nome ?? "Representante vinculado" }] : []) : reps.data ?? [];
  const filtros = {
    busca, status: situacao, praca, representante: rep,
    de: isoDia(periodo?.from), ate: isoDia(periodo?.to ?? periodo?.from), campoData,
  };
  const lista = useQuery({ queryKey: ["remessas", "busca", filtros], queryFn: () => buscarRemessas(filtros) });
  // A mesma busca também consulta o Histórico SmallData (já escopado ao representante da colaboradora no servidor).
  const historico = useQuery({ queryKey: ["remessas", "busca-historico", busca], queryFn: () => remessasHistorico({ busca, limite: 30 }), enabled: busca.trim().length >= 2 });
  const tot = (lista.data ?? []).reduce(
    (a, r) => ({ n: a.n + 1, m: a.m + Number(r.maletas), c: a.c + Number(r.maletas_conferidas), p: a.p + Number(r.pecas), v: a.v + Number(r.valor_cents) }),
    { n: 0, m: 0, c: 0, p: 0, v: 0 },
  );
  const temFiltro = !!(texto || praca || rep || periodo || situacao !== "todas");
  function limpar() {
    setTexto(""); setPraca(""); setRep(colab ? escopo.data?.representante ?? "" : ""); setPeriodo(undefined); setSituacao("todas");
  }

  async function abrirPorQr() {
    const bruto = qr.trim();
    const token = (/[?&]qr=([^&#\s]+)/.exec(bruto)?.[1] ?? bruto.split("/").pop() ?? "").trim();
    if (!token) return;
    const { data: resolved, error } = await supabase.rpc("kit_identificacao_buscar", { _codigo: token });
    if (error || !resolved) {
      toast.error("Maleta não encontrada para este código.");
      return;
    }
    navigate({ to: "/admin/maletas/$id", params: { id: resolved } });
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Núcleo comercial"
        title="Remessas"
        description="Cada remessa tem seu número e sua praça. As maletas das consultoras são abertas dentro da remessa."
        actions={
          <div className="flex flex-wrap gap-2">
            {escopo.isSuccess && !colab && <ConfigurarImpressora />}
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

      <nav aria-label="Fonte dos dados de remessas" className="flex flex-wrap gap-2">
        <button type="button" className={fonte === "lardan" ? "admin-btn admin-btn-primary" : "admin-btn"} onClick={() => setFonte("lardan")}>
          Operação Lardan
        </button>
        <button type="button" className={fonte === "jflex" ? "admin-btn admin-btn-primary" : "admin-btn"} onClick={() => setFonte("jflex")}>
          Histórico SmallData
        </button>
      </nav>

      {escopo.isSuccess && !colab && <AcertosPainel />}
      {escopo.isSuccess && !colab && <MaletasNaRua />}

      {fonte === "jflex" ? (
        <RemessasHistorico abrir={remessaAberta} aoAbrir={setRemessaAberta} />
      ) : (
        <>
      <Panel>
        <div className="grid gap-4 lg:grid-cols-12">
          <label className="grid gap-1.5 text-sm lg:col-span-5">
            <span className="ledger-eyebrow">Buscar</span>
            <span className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" />
              <input className="admin-input w-full pl-9" value={texto} onChange={(e) => setTexto(e.target.value)}
                placeholder="Nº da remessa, praça, representante ou consultora" />
            </span>
          </label>
          <label className="grid gap-1.5 text-sm lg:col-span-4">
            <span className="ledger-eyebrow">Praça / região</span>
            <SmartSelect value={praca} onChange={setPraca}
              options={[{ value: "", label: "Todas as praças" }, ...(pracas.data ?? [])]} placeholder="Todas as praças" />
          </label>
          <label className="grid gap-1.5 text-sm lg:col-span-3">
            <span className="ledger-eyebrow">Situação</span>
            <SmartSelect value={situacao} onChange={setSituacao} options={SITUACOES} placeholder="Situação" />
          </label>
          <label className="grid gap-1.5 text-sm lg:col-span-4">
            <span className="ledger-eyebrow">Representante</span>
            <SmartSelect value={colab ? escopo.data?.representante ?? "" : rep} onChange={setRep} {...(!colab ? { onSearch: setBuscaRep } : {})} loading={reps.isFetching}
              options={[...(!colab ? [{ value: "", label: "Todos os representantes" }] : []), ...representantes]}
              searchPlaceholder="Buscar representante" placeholder={colab ? "Representante vinculado" : "Todos os representantes"} />
          </label>
          <label className="grid gap-1.5 text-sm lg:col-span-2">
            <span className="ledger-eyebrow">Período por</span>
            <SmartSelect value={campoData} onChange={(v) => setCampoData(v as "emissao" | "acerto")}
              options={[{ value: "emissao", label: "Data de emissão" }, { value: "acerto", label: "Data de acerto" }]} />
          </label>
          <label className="grid gap-1.5 text-sm lg:col-span-3">
            <span className="ledger-eyebrow">Período</span>
            <DateRangeField value={periodo} onChange={setPeriodo} placeholder="Qualquer data" />
          </label>
          <div className="flex items-end gap-2 lg:col-span-3">
            <input className="admin-input min-w-0 flex-1" value={qr} onChange={(e) => setQr(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void abrirPorQr(); }} placeholder="Bipar código de barras da maleta" aria-label="Código de barras da maleta" />
            <Button variant="outline" size="icon" onClick={() => void abrirPorQr()} aria-label="Abrir maleta pelo código de barras">
              <ScanLine aria-hidden className="size-4" />
            </Button>
          </div>
        </div>
        {temFiltro && (
          <button type="button" className="mt-4 inline-flex items-center gap-1 text-sm text-ledger-muted hover:text-ledger-text" onClick={limpar}>
            <X aria-hidden className="size-4" /> Limpar filtros
          </button>
        )}
      </Panel>

      <div className="grid gap-3 md:grid-cols-5">
        {[
          ["Remessas", tot.n],
          ["Maletas", tot.m],
          ["Conferidas", tot.c],
          ["Peças", tot.p],
          ["Valor consignado", brl(tot.v)],
        ].map(([r, v]) => (
          <div key={r as string} className="rounded-xl border border-line-soft bg-surface p-4">
            <p className="ledger-eyebrow">{r}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ledger-text">{v}</p>
          </div>
        ))}
      </div>

      <Panel flush>
        {lista.isLoading && <div className="space-y-2 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
        {lista.isError && (
          <div className="px-6"><ErrorState message={traduzir(lista.error)} onRetry={() => void lista.refetch()} /></div>
        )}
        {lista.data?.length === 0 && (
          <div className="px-6">
            <EmptyState title={temFiltro ? "Nenhuma remessa com estes filtros" : "Nenhuma remessa aberta ainda"}
              description="Abra uma nova remessa escolhendo a praça; depois as maletas das consultoras são abertas dentro dela." />
          </div>
        )}
        {lista.data?.map((r) => <Linha key={r.id} r={r} />)}
      </Panel>

      {busca.trim().length >= 2 && (
        <Panel flush>
          <div className="flex items-center justify-between gap-3 border-b border-line-soft px-6 py-4">
            <p className="ledger-eyebrow">Histórico SmallData · “{busca.trim()}”</p>
            {historico.data && <span className="text-xs text-ledger-muted">{historico.data.total} remessa(s){historico.data.total > historico.data.itens.length ? ` · mostrando ${historico.data.itens.length}` : ""}</span>}
          </div>
          {historico.isLoading && <div className="space-y-2 p-6">{[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
          {historico.isError && <div className="px-6"><ErrorState message={traduzir(historico.error)} onRetry={() => void historico.refetch()} /></div>}
          {historico.data?.itens.length === 0 && <div className="px-6"><EmptyState title="Sem dados no Histórico SmallData" description="Nenhuma remessa histórica corresponde a esta busca." /></div>}
          {historico.data?.itens.map((h) => (
            <button key={h.numero} type="button" onClick={() => { setRemessaAberta(h.numero); setFonte("jflex"); }}
              className="grid w-full grid-cols-[90px_1fr_1fr_auto_auto_auto] items-center gap-4 border-b border-line-soft px-6 py-3 text-left text-sm hover:bg-surface-muted">
              <span className="font-semibold tabular-nums">Nº {h.numero}</span>
              <span className="truncate">{h.praca ?? "—"}</span>
              <span className="truncate text-ledger-muted">{h.representante ?? "—"}</span>
              <span className="tabular-nums text-ledger-muted">{dataBR(h.emissao)}</span>
              <span className="tabular-nums text-ledger-muted">{h.maletas} maletas · {h.pecas_vendidas}/{h.pecas_enviadas} peças</span>
              <StatusBadge tone={h.status === "aberta" ? "warning" : "neutral"}>{h.status === "aberta" ? "Aberta" : "Fechada"}</StatusBadge>
            </button>
          ))}
        </Panel>
      )}

      <p className="flex items-center gap-2 text-xs text-ledger-muted">
        <BriefcaseBusiness aria-hidden className="size-4" />
        Peças em trânsito, divergentes ou reservadas não contam como disponíveis para venda.
      </p>
        </>
      )}
    </div>
  );
}

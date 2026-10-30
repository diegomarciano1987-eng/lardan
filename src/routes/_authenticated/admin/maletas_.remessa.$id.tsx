import * as React from "react";
import { EtiquetasImprimir } from "@/components/admin/EtiquetasImprimir";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Lock, Plus, Receipt, ScrollText, Tag, UserRound } from "lucide-react";
import { imprimirPedidoConsignacao, imprimirPromissoriaMaleta } from "@/components/admin/maletas/DocumentosMaleta";
import { imprimirEtiquetaMaleta } from "@/components/admin/maletas/EtiquetaMaleta";
import { abrirMaletaRepresentante, mensagem } from "@/lib/maletas-perdidas";
import { EnvioRemessa } from "@/components/admin/maletas/EnvioRemessa";
import { ConfigurarImpressora } from "@/components/admin/maletas/ConfigurarImpressora";
import { useAdminRoles } from "@/components/admin/AdminShell";
import { liberarKitSemPreBaixa } from "@/lib/pre-baixa";
import { toast } from "sonner";
import { BackButton, EmptyState, ErrorState, Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { useCapabilities } from "@/lib/capabilities";
import { useColabEscopo } from "@/lib/colab-escopo";
import { SITUACAO_MALETA, brl, traduzir } from "@/lib/maletas";
import {
  STATUS_REMESSA,
  abrirMaletaNaRemessa,
  consultorasDaPraca,
  consultorasSemPraca,
  dataBR,
  finalizarRemessa,
  listarRemessas,
  maletasDaRemessa,
  reabrirRemessa,
  vincularConsultoraRemessa,
} from "@/lib/remessas";

export const Route = createFileRoute("/_authenticated/admin/maletas_/remessa/$id")({
  component: RemessaPage,
  head: () => ({
    meta: [
      { title: "Remessa — Administração LARDAN" },
      { name: "description", content: "Maletas e impressão de etiquetas das peças da remessa LARDAN." },
      { property: "og:title", content: "Remessa — Administração LARDAN" },
      { property: "og:description", content: "Maletas e impressão de etiquetas das peças da remessa LARDAN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  const escopo = useColabEscopo();
  const podeMontar = caps.includes("kit.manage");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [consultora, setConsultora] = React.useState("");
  const [busca, setBusca] = React.useState("");
  const master = useAdminRoles().includes("master" as never);
  const [semPreBaixa, setSemPreBaixa] = React.useState<string | null>(null);
  const [motivoLib, setMotivoLib] = React.useState("");

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
    onError: (e) => {
      const t = traduzir(e);
      // 0158: maleta anterior sem pré-baixa fechada — o Master pode liberar com motivo
      if (/pré-baixa/i.test(t)) setSemPreBaixa(t);
      toast.error(t);
    },
  });
  const liberar = useMutation({
    mutationFn: () => liberarKitSemPreBaixa(consultora, motivoLib),
    onSuccess: () => { toast.success("Liberado uma vez. Abrindo a maleta…"); setSemPreBaixa(null); setMotivoLib(""); abrir.mutate(); },
    onError: (e) => toast.error(traduzir(e)),
  });

  // 0130: maleta sem consultora, que sai para o representante passar a uma consultora ou candidata dele
  const abrirRep = useMutation({
    mutationFn: () => abrirMaletaRepresentante(id),
    onSuccess: (res) => {
      toast.success("Maleta aberta para o representante.");
      qc.invalidateQueries({ queryKey: ["remessas"] });
      navigate({ to: "/admin/maletas/$id", params: { id: res.cycle_id } });
    },
    onError: (e) => toast.error(mensagem(e)),
  });
  const comConsultora = (maletas.data ?? []).filter((m) => m.consultora_party_id).length;
  const comRepresentante = (maletas.data ?? []).length - comConsultora;
  const emMontagem = (maletas.data ?? []).filter((m) => m.status === "montagem" || m.status === "rascunho").length;

  // 0184: consultora sem praça → praça da remessa
  const [semPraca, setSemPraca] = React.useState("");
  const [buscaSemPraca, setBuscaSemPraca] = React.useState("");
  const semPracaOpcoes = useQuery({
    queryKey: ["remessas", "sem-praca", id, buscaSemPraca],
    queryFn: () => consultorasSemPraca(id, buscaSemPraca),
    enabled: podeMontar && buscaSemPraca.trim().length >= 2,
  });
  const vincular = useMutation({
    mutationFn: async () => {
      await vincularConsultoraRemessa(id, semPraca);
      return abrirMaletaNaRemessa(id, semPraca);
    },
    onSuccess: (res) => {
      toast.success("Consultora trazida para a praça e maleta aberta.");
      qc.invalidateQueries({ queryKey: ["remessas"] });
      navigate({ to: "/admin/maletas/$id", params: { id: res.cycle_id } });
    },
    onError: (e) => { qc.invalidateQueries({ queryKey: ["remessas"] }); toast.error(traduzir(e)); },
  });

  // 0184: documentos direto da lista
  const [imprimindo, setImprimindo] = React.useState<string | null>(null);
  async function imprimir(cycleId: string, tipo: "pedido" | "promissoria" | "etiqueta") {
    setImprimindo(`${cycleId}:${tipo}`);
    try {
      if (tipo === "etiqueta") { await imprimirEtiquetaMaleta(cycleId); toast.success("Etiqueta enviada para a Argox."); }
      else if (tipo === "pedido") await imprimirPedidoConsignacao(cycleId);
      else await imprimirPromissoriaMaleta(cycleId);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível imprimir."); }
    finally { setImprimindo(null); }
  }

  // 0184: finalizar / reabrir
  const [confirmaNumero, setConfirmaNumero] = React.useState("");
  const [motivoReabrir, setMotivoReabrir] = React.useState("");
  const finalizar = useMutation({
    mutationFn: () => finalizarRemessa(id, Number(confirmaNumero)),
    onSuccess: (res) => { toast.success(`Remessa ${res.numero} finalizada.`); setConfirmaNumero(""); qc.invalidateQueries({ queryKey: ["remessas"] }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  const reabrir = useMutation({
    mutationFn: () => reabrirRemessa(id, motivoReabrir),
    onSuccess: (res) => { toast.success(`Remessa ${res.numero} reaberta.`); setMotivoReabrir(""); qc.invalidateQueries({ queryKey: ["remessas"] }); },
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
          <div className="mt-2"><EnvioRemessa remessaId={r.id} podeAlterar={podeMontar && r.status !== "fechada" && r.status !== "cancelada"} /></div>
        </div>
        <StatusBadge tone={s.tom}>{s.rotulo}</StatusBadge>
        {escopo.isSuccess && !escopo.data?.colaboradora && <ConfigurarImpressora />}
        <EtiquetasImprimir origens={(maletas.data ?? []).map((m) => ({ cycleId: m.cycle_id }))} />
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Card rotulo="Consultoras na praça" valor={r.consultoras_praca} />
        <Card rotulo="Maletas abertas" valor={`${r.maletas}${comRepresentante ? ` · ${comRepresentante} c/ representante` : ""}`} />
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
            {semPreBaixa && master && (
              <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-warning/50 bg-warning/5 p-3 text-sm">
                <span className="w-full text-ledger-muted">{semPreBaixa}</span>
                <input className="admin-input flex-1" placeholder="Motivo para liberar sem pré-baixa (fica na auditoria)" value={motivoLib} onChange={(e) => setMotivoLib(e.target.value)} />
                <button type="button" className="admin-btn" disabled={liberar.isPending || motivoLib.trim().length < 5} onClick={() => liberar.mutate()}>Liberar e abrir</button>
              </div>
            )}
            {r.representante && (
              <button type="button" className="admin-btn" disabled={abrirRep.isPending} onClick={() => abrirRep.mutate()}
                title="A maleta sai sem consultora para o representante; ele passa para uma consultora ou candidata da carteira dele.">
                <UserRound aria-hidden className="size-4" /> {abrirRep.isPending ? "Abrindo…" : `Maleta para o representante ${r.representante}`}
              </button>
            )}
          </div>
        </Panel>
      )}

      {podeMontar && r.status !== "fechada" && r.status !== "cancelada" && (
        <Panel title="Consultora não aparece na lista?">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-80 flex-1 gap-1.5 text-sm">
              <span className="ledger-eyebrow">Consultoras ativas ainda sem praça{r.representante ? ` (sem representante ou de ${r.representante})` : ""}</span>
              <SmartSelect value={semPraca} onChange={setSemPraca} options={semPracaOpcoes.data ?? []} onSearch={setBuscaSemPraca}
                loading={semPracaOpcoes.isFetching} searchPlaceholder="Digite nome ou CPF (2 letras ou mais)" placeholder="Buscar consultora sem praça"
                emptyLabel={buscaSemPraca.trim().length < 2 ? "Digite ao menos 2 letras" : "Nenhuma consultora sem praça com esse nome"} />
              <span className="text-xs text-ledger-muted">Ela passa para a praça {r.praca} (fica registrado quem fez). Quem já tem outra praça não muda por aqui.</span>
            </label>
            <button type="button" className="admin-btn admin-btn-primary" disabled={!semPraca || vincular.isPending} onClick={() => vincular.mutate()}>
              <Plus aria-hidden className="size-4" /> {vincular.isPending ? "Vinculando…" : "Trazer para a praça e abrir maleta"}
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
          const semPecas = !m.pecas;
          return (
            <div key={m.cycle_id} className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft px-6 py-4 transition hover:bg-surface-muted">
              <Link to="/admin/maletas/$id" params={{ id: m.cycle_id }} className="min-w-56 flex-1 font-semibold text-ledger-text hover:underline">
                {m.consultora ?? `Com o representante${r.representante ? ` ${r.representante}` : ""} · sem consultora`}
              </Link>
              <div className="flex flex-wrap items-center gap-2" aria-label={`Documentos de ${m.consultora ?? "maleta"}`}>
                <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={semPecas || imprimindo !== null}
                  onClick={() => void imprimir(m.cycle_id, "pedido")}>
                  <FileText aria-hidden className="size-3.5" /> {imprimindo === `${m.cycle_id}:pedido` ? "Preparando…" : "Pedido"}
                </button>
                <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={semPecas || !m.consultora_party_id || imprimindo !== null}
                  onClick={() => void imprimir(m.cycle_id, "promissoria")}>
                  <ScrollText aria-hidden className="size-3.5" /> {imprimindo === `${m.cycle_id}:promissoria` ? "Preparando…" : "Promissória"}
                </button>
                <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={imprimindo !== null}
                  onClick={() => void imprimir(m.cycle_id, "etiqueta")}>
                  <Tag aria-hidden className="size-3.5" /> {imprimindo === `${m.cycle_id}:etiqueta` ? "Preparando…" : "Etiqueta"}
                </button>
                <button type="button" className="admin-btn h-9 px-3 text-xs" disabled title="A emissão da nota fiscal ainda está em homologação; o botão fica aqui e será liberado quando a emissão real for ligada.">
                  <Receipt aria-hidden className="size-3.5" /> Nota fiscal (em breve)
                </button>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <span className="tabular-nums text-ledger-muted">{m.pecas} peças</span>
                <span className="tabular-nums font-semibold text-ledger-text">{brl(Number(m.valor_cents ?? 0))}</span>
                <StatusBadge tone={TOM[st.tom]}>{st.rotulo}</StatusBadge>
              </div>
            </div>
          );
        })}
      </Panel>

      {podeMontar && r.status !== "cancelada" && (
        <Panel title={r.status === "fechada" ? "Remessa finalizada" : "Finalizar remessa"}>
          {r.status === "fechada" ? (
            <div className="space-y-3 text-sm">
              <p className="text-ledger-muted">Remessa {r.numero} está finalizada: não abre novas maletas nem muda o envio. As maletas seguem normalmente (expedição, acerto).</p>
              {master && (
                <div className="flex flex-wrap items-center gap-2">
                  <input className="admin-input flex-1" placeholder="Motivo para reabrir (fica na auditoria)" value={motivoReabrir} onChange={(e) => setMotivoReabrir(e.target.value)} />
                  <button type="button" className="admin-btn" disabled={reabrir.isPending || motivoReabrir.trim().length < 5} onClick={() => reabrir.mutate()}>Reabrir remessa</button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-ledger-muted">
                Quando todas as maletas estiverem conferidas, finalize: a remessa {r.numero} fica fechada de vez, sem novas maletas.
                {emMontagem > 0 && <strong className="text-ledger-text"> Ainda há {emMontagem} maleta(s) em montagem.</strong>}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input className="admin-input w-56" inputMode="numeric" placeholder={`Digite ${r.numero} para confirmar`} value={confirmaNumero}
                  onChange={(e) => setConfirmaNumero(e.target.value.replace(/\D/g, ""))} aria-label="Número da remessa para confirmar" />
                <button type="button" className="admin-btn admin-btn-primary" disabled={finalizar.isPending || emMontagem > 0 || Number(confirmaNumero) !== r.numero}
                  onClick={() => finalizar.mutate()}>
                  <Lock aria-hidden className="size-4" /> {finalizar.isPending ? "Finalizando…" : "Finalizar remessa"}
                </button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

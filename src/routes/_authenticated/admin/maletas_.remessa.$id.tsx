import * as React from "react";
import { InfoAcertoInline, InformacoesRemessa, semAnotacao, useInformacoesRemessa } from "@/components/admin/maletas/InformacoesRemessa";
import { EtiquetasImprimir } from "@/components/admin/EtiquetasImprimir";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, ChevronRight, FileText, Lock, Plus, ScrollText, Search, ShieldCheck, Tag, UserRound } from "lucide-react";
import { imprimirPedidoConsignacao, imprimirPromissoriaMaleta } from "@/components/admin/maletas/DocumentosMaleta";
import { imprimirEtiquetaMaleta } from "@/components/admin/maletas/EtiquetaMaleta";
import { abrirMaletaRepresentante, devolverCustodiaRepresentante, expedirRemessaRepresentante, mensagem } from "@/lib/maletas-perdidas";
import { EnvioRemessa } from "@/components/admin/maletas/EnvioRemessa";
import { NotaFiscalMaleta, useNotasMaletas } from "@/components/admin/maletas/NotaFiscalMaleta";
import { ConfigurarImpressora } from "@/components/admin/maletas/ConfigurarImpressora";
import { SeloNotaTroca, useTrocasPendentes } from "@/components/admin/maletas/TrocasPendentes";
import { supabase } from "@/integrations/supabase/client";
import { AceiteAdministrativo } from "@/components/admin/maletas/AceiteAdministrativo";
import { DevolucoesPendentes } from "@/components/admin/maletas/DevolucoesPendentes";
import { STATUS_TRANSFERIR, TransferirMaletaBotao } from "@/components/admin/maletas/TransferirMaleta";
import { useAdminRoles } from "@/components/admin/AdminShell";
import { liberarKitSemPreBaixa } from "@/lib/pre-baixa";
import { toast } from "sonner";
import { casaBusca } from "@/lib/busca-maletas";
import { BackButton, EmptyState, ErrorState, Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { useCapabilities } from "@/lib/capabilities";
import { useColabEscopo } from "@/lib/colab-escopo";
import { SITUACAO_MALETA, brl, expedir, liberarParaConsultora, traduzir } from "@/lib/maletas";
import {
  STATUS_REMESSA,
  abrirMaletaNaRemessa,
  abrirSegundaMaletaNaRemessa,
  buscarConsultorasDaRemessa,
  abrirMaletaPelaBusca,
  consultorasSemPraca,
  dataBR,
  finalizarRemessa,
  lerEnvioRemessa,
  listarRemessas,
  maletasDaRemessa,
  rotuloMaletaRemessa,
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
  const podeNotaMaleta = master || podeMontar;
  const [semPreBaixa, setSemPreBaixa] = React.useState<string | null>(null);
  const [motivoLib, setMotivoLib] = React.useState("");

  const remessa = useQuery({
    queryKey: ["remessas", "lista", "todas"],
    queryFn: () => listarRemessas(undefined, { comCanceladas: true }),
    select: (l) => l.find((r) => r.id === id) ?? null,
  });
  const maletas = useQuery({ queryKey: ["remessas", "maletas", id], queryFn: () => maletasDaRemessa(id) });
  const notas = useNotasMaletas((maletas.data ?? []).map((m) => m.cycle_id));
  const idsConsultoras = React.useMemo(() => [...new Set((maletas.data ?? []).map((m) => m.consultora_party_id).filter(Boolean) as string[])].sort(), [maletas.data]);
  const codigos = useQuery({
    queryKey: ["remessas", "codigos", idsConsultoras],
    enabled: idsConsultoras.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("parties").select("id, code").in("id", idsConsultoras);
      if (error) throw error;
      return new Map((data ?? []).map((p) => [p.id, p.code as string | null]));
    },
  });
  // 0340: número da maleta (MAL-…) de cada linha, para mostrar e para a busca dentro da remessa
  const idsCiclos = React.useMemo(() => (maletas.data ?? []).map((m) => m.cycle_id).sort(), [maletas.data]);
  const codigosMaleta = useQuery({
    queryKey: ["remessas", "codigos-maleta", idsCiclos],
    enabled: idsCiclos.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("kit_cycles").select("id, kits(code)").in("id", idsCiclos);
      if (error) throw error;
      return new Map((data ?? []).map((c) => [c.id as string, ((c as unknown as { kits: { code: string } | null }).kits?.code ?? null) as string | null]));
    },
  });
  const [buscaMaleta, setBuscaMaleta] = React.useState("");
  const [gruposAbertos, setGruposAbertos] = React.useState<Set<string>>(new Set());
  const maletasFiltradas = React.useMemo(() => (maletas.data ?? []).filter((m) => casaBusca(buscaMaleta, [
    m.consultora, m.consultora_party_id ? codigos.data?.get(m.consultora_party_id) : null,
    codigosMaleta.data?.get(m.cycle_id), rotuloMaletaRemessa(m),
  ])), [maletas.data, buscaMaleta, codigos.data, codigosMaleta.data]);
  const trocas = useTrocasPendentes(id);
  const trocaPorMaleta = React.useMemo(() => new Map((trocas.data ?? []).map((t) => [t.cycle_id, t])), [trocas.data]);
  // Master: remessa criada por engano (sem nenhuma maleta) cancela aqui mesmo, com motivo (remessa_cancelar_vazia)
  const cancelarVazia = useMutation({
    mutationFn: async (numero: number) => {
      const motivo = window.prompt(`Cancelar a remessa ${numero}? Ela não tem nenhuma maleta. Escreva o motivo (fica na auditoria):`, "Remessa criada por engano");
      if (motivo === null) return null;
      const { error } = await supabase.rpc("remessa_cancelar_vazia", { _remessa: id, _motivo: motivo });
      if (error) throw new Error(error.message);
      return numero;
    },
    onSuccess: (n) => {
      if (!n) return;
      toast.success(`Remessa ${n} cancelada.`);
      void qc.invalidateQueries({ queryKey: ["remessas"] });
      navigate({ to: "/admin/maletas" });
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const r = remessa.data;
  const consultoras = useQuery({
    queryKey: ["remessas", "consultoras-busca-unica", id, busca],
    queryFn: () => buscarConsultorasDaRemessa(id, busca),
    enabled: !!r && podeMontar,
  });
  const jaTem = new Set((maletas.data ?? []).map((m) => m.consultora_party_id));
  const opcoes = (consultoras.data ?? []).map((o) => (jaTem.has(o.value) ? { ...o, label: `${o.label} · já tem maleta` } : o));

  const abrir = useMutation({
    mutationFn: () => {
      if (!consultora) throw new Error("Escolha a consultora.");
      return abrirMaletaPelaBusca(id, consultora);
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
  // 0322: segunda maleta para a mesma consultora nesta remessa (motivo obrigatório)
  const [motivoSegunda, setMotivoSegunda] = React.useState("");
  const maletasDela = (maletas.data ?? []).filter((m) => consultora && m.consultora_party_id === consultora && m.status !== "cancelada");
  const abrirSegunda = useMutation({
    mutationFn: () => {
      if (!consultora) throw new Error("Escolha a consultora.");
      if (motivoSegunda.trim().length < 5) throw new Error("Escreva o motivo da segunda maleta (mínimo 5 letras).");
      return abrirSegundaMaletaNaRemessa(id, consultora, motivoSegunda.trim());
    },
    onSuccess: (res) => {
      toast.success(res.repetida ? "Ela já tem uma segunda maleta vazia aberta: abrindo essa." : "Segunda maleta aberta para montagem.");
      setMotivoSegunda("");
      qc.invalidateQueries({ queryKey: ["remessas"] });
      navigate({ to: "/admin/maletas/$id", params: { id: res.cycle_id } });
    },
    onError: (e) => {
      const t = traduzir(e);
      if (/pré-baixa/i.test(t)) setSemPreBaixa(t);
      toast.error(t);
    },
  });
  const liberar = useMutation({
    mutationFn: () => liberarKitSemPreBaixa(consultora, motivoLib),
    onSuccess: () => { toast.success("Liberado uma vez. Abrindo a maleta…"); setSemPreBaixa(null); setMotivoLib(""); abrir.mutate(); },
    onError: (e) => toast.error(traduzir(e)),
  });

  const liberarMaleta = useMutation({
    mutationFn: (cycleId: string) => liberarParaConsultora(cycleId),
    onSuccess: (r) => {
      toast.success(r.repetida ? "Esta maleta já foi entregue à consultora." : "Entrega confirmada. Agora a consultora confere e aceita a maleta no app dela.");
      qc.invalidateQueries({ queryKey: ["remessas"] });
      qc.invalidateQueries({ queryKey: ["maletas"] });
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  // 0130: maleta sem consultora, que sai para o representante passar a uma consultora ou candidata dele.
  // Abertura em lote: cada uma é numerada pelo banco (ABERTURA N · Remessa X) e a tela não sai da remessa.
  const [destino, setDestino] = React.useState<"consultora" | "representante">("consultora");
  const [qtdAbertura, setQtdAbertura] = React.useState(1);
  const abrirRep = useMutation({
    mutationFn: async (qtd: number) => {
      const numeros: number[] = [];
      for (let i = 0; i < qtd; i++) {
        const res = await abrirMaletaRepresentante(id);
        const n = (res as { abertura_numero?: number }).abertura_numero;
        if (typeof n === "number") numeros.push(n);
      }
      return numeros;
    },
    onSuccess: (nums) => {
      const faixa = nums.length > 1 ? `ABERTURA ${nums[0]} a ${nums[nums.length - 1]}` : nums.length === 1 ? `ABERTURA ${nums[0]}` : "";
      toast.success(`${nums.length} ${nums.length === 1 ? "maleta de abertura aberta" : "maletas de abertura abertas"} em nome do representante${faixa ? ` (${faixa})` : ""}. Já aparecem na lista abaixo para montar.`);
      setQtdAbertura(1);
      qc.invalidateQueries({ queryKey: ["remessas"] });
    },
    onError: (e) => { toast.error(mensagem(e)); qc.invalidateQueries({ queryKey: ["remessas"] }); },
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
  const infos = useInformacoesRemessa(id);
  // 0247: remessa pelo correio — envio e entrega confirmados pelo rastreio
  const envio = useQuery({ queryKey: ["remessas", "envio", id], queryFn: () => lerEnvioRemessa(id) });
  const peloCorreio = envio.data?.tipo_envio === "correio";
  const pendInfo = semAnotacao(infos.data);
  // 0254: remessa com representante (não Correios): fábrica → representante → consultora
  const comRep = !!r?.representante && !peloCorreio && envio.isSuccess;
  const conferidasRep = (maletas.data ?? []).filter((m) => m.status === "conferida").length;
  const recarregarRem = () => { qc.invalidateQueries({ queryKey: ["remessas"] }); qc.invalidateQueries({ queryKey: ["maletas"] }); };
  const paraRep = useMutation({
    mutationFn: async (ciclos: string[] | null) => {
      if (!ciclos) return (await expedirRemessaRepresentante(id)).maletas;
      for (const c of ciclos) await expedir(c, { rota: "representante" });
      return ciclos.length;
    },
    onSuccess: (n) => { toast.success(`${n} ${n === 1 ? "maleta entregue" : "maletas entregues"} ao representante. Ele confirma no app dele.`); recarregarRem(); },
    onError: (e) => { toast.error(traduzir(e)); recarregarRem(); },
  });
  const devolver = useMutation({
    mutationFn: (v: { cycle: string; motivo: string }) => devolverCustodiaRepresentante(v.cycle, v.motivo),
    onSuccess: () => { toast.success("Maleta voltou para a custódia do representante."); recarregarRem(); },
    onError: (e) => toast.error(traduzir(e)),
  });
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

  const alternarGrupo = (k: string) => setGruposAbertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const gruposMaletas = (() => {
    const mapa = new Map<string, { chave: string; itens: typeof maletasFiltradas }>();
    for (const m of maletasFiltradas) {
      const chave = m.consultora_party_id ? `c:${m.consultora_party_id}` : `m:${m.cycle_id}`;
      const g = mapa.get(chave) ?? { chave, itens: [] };
      g.itens.push(m);
      mapa.set(chave, g);
    }
    return [...mapa.values()];
  })();
  // Remessa (Diego 19/11): mesma consultora com 2+ maletas na remessa vira uma linha só, que abre as maletas dela
  const linhaMaleta = (m: (typeof maletasFiltradas)[number], sub = false) => {
          const st = SITUACAO_MALETA[m.status] ?? { rotulo: m.status, tom: "neutro" as const };
          const semPecas = !m.pecas;
          return (
            <div key={m.cycle_id} data-maleta-linha={sub ? "sub" : ""} className={`flex flex-wrap items-center justify-between gap-4 border-b border-line-soft py-4 transition hover:bg-surface-muted ${sub ? "pl-12 pr-6 last:border-b-0" : "px-6"}`}>
              <Link to="/admin/maletas/$id" params={{ id: m.cycle_id }} className="min-w-56 flex-1 font-semibold text-ledger-text hover:underline">
                {rotuloMaletaRemessa(m) && (
                  <span className="mr-2 inline-flex h-6 items-center rounded-md bg-primary/10 px-2 align-middle text-xs font-bold tracking-wide text-primary tabular-nums" data-rotulo-maleta="">
                    {rotuloMaletaRemessa(m)}
                  </span>
                )}
                {m.consultora_party_id && codigos.data?.get(m.consultora_party_id) && (
                  <span className="mr-2 align-middle text-sm font-semibold tabular-nums text-ledger-muted">[Cód. {codigos.data.get(m.consultora_party_id)}]</span>
                )}
                {m.consultora ?? `Com o representante${r.representante ? ` ${r.representante}` : ""} · sem consultora`}
                {codigosMaleta.data?.get(m.cycle_id) && (
                  <span className="ml-2 whitespace-nowrap align-middle text-xs font-semibold tabular-nums text-ledger-muted">{codigosMaleta.data.get(m.cycle_id)}</span>
                )}
              </Link>
              <div className="flex flex-wrap items-center gap-2" aria-label={`Documentos de ${m.consultora ?? "maleta"}`}>
                <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={semPecas || imprimindo !== null}
                  onClick={() => void imprimir(m.cycle_id, "pedido")}>
                  <FileText aria-hidden className="size-3.5" /> {imprimindo === `${m.cycle_id}:pedido` ? "Preparando…" : "Pedido"}
                </button>
                <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={semPecas || imprimindo !== null}
                  onClick={() => void imprimir(m.cycle_id, "promissoria")}>
                  <ScrollText aria-hidden className="size-3.5" /> {imprimindo === `${m.cycle_id}:promissoria` ? "Preparando…" : "Promissória"}
                </button>
                <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={imprimindo !== null}
                  onClick={() => void imprimir(m.cycle_id, "etiqueta")}>
                  <Tag aria-hidden className="size-3.5" /> {imprimindo === `${m.cycle_id}:etiqueta` ? "Preparando…" : "Etiqueta"}
                </button>
                <NotaFiscalMaleta cycleId={m.cycle_id} status={m.status} nota={notas.porMaleta.get(m.cycle_id)} podeEmitir={podeNotaMaleta}
                  temConsultora={!!m.consultora_party_id} semPecas={semPecas} producao={notas.producao} />
                {trocaPorMaleta.get(m.cycle_id) && <SeloNotaTroca pendencia={trocaPorMaleta.get(m.cycle_id)!} />}
                {peloCorreio && m.consultora_party_id && ["conferida", "expedida", "transito"].includes(m.status) && (
                  <Link to="/admin/maletas/$id" params={{ id: m.cycle_id }} hash="correios"
                    className="admin-btn admin-btn-primary h-9 px-3 text-xs"
                    title="Abre o painel Correios desta maleta: cotação, pré-postagem e etiqueta. Saída e entrega são confirmadas pelo rastreio.">
                    {m.status === "conferida" ? "Enviar pelos Correios" : "Rastreio Correios"}
                  </Link>
                )}
                {comRep && m.status === "conferida" && podeMontar && (
                  <button type="button" className="admin-btn admin-btn-primary h-9 px-3 text-xs" disabled={semPecas || paraRep.isPending}
                    onClick={() => paraRep.mutate([m.cycle_id])}>
                    <UserRound aria-hidden className="size-3.5" /> Entregar ao representante
                  </button>
                )}
                {comRep && m.status === "transito" && (
                  <span className="inline-flex h-9 items-center rounded-full bg-muted px-3 text-xs text-ledger-muted">Com o representante · entrega em mãos</span>
                )}
                {comRep && m.status === "recebida" && podeMontar && (
                  <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={devolver.isPending}
                    title="Use quando a maleta foi marcada como entregue à consultora por engano e ainda está com o representante."
                    onClick={() => { const mot = window.prompt("Motivo para voltar a maleta para o representante (fica registrado):", "Entregue direto por engano; está com o representante"); if (mot && mot.trim().length >= 5) devolver.mutate({ cycle: m.cycle_id, motivo: mot }); }}>
                    Voltar para o representante
                  </button>
                )}
                {!comRep && podeMontar && m.consultora_party_id && ["conferida", "expedida", "transito"].includes(m.status) && (!peloCorreio || master) && (
                  <button type="button" className="admin-btn admin-btn-primary h-9 px-3 text-xs" disabled={semPecas || liberarMaleta.isPending}
                    onClick={() => liberarMaleta.mutate(m.cycle_id)}>
                    <CheckCircle2 aria-hidden className="size-3.5" /> {liberarMaleta.isPending && liberarMaleta.variables === m.cycle_id ? "Confirmando…" : "Confirmar entrega"}
                  </button>
                )}
                {m.status === "recebida" && (
                  <span className="inline-flex h-9 items-center rounded-full bg-muted px-3 text-xs text-ledger-muted">Aguardando aceite da consultora</span>
                )}
                {/* 0279: transferir para outra consultora (antes da nota ou já na rua, sem aceite) */}
                {podeNotaMaleta && STATUS_TRANSFERIR.includes(m.status) && m.status !== "rascunho" && (
                  <TransferirMaletaBotao cycleId={m.cycle_id} pracaId={r.praca_id}
                    rotulo={[rotuloMaletaRemessa(m), m.consultora ?? "sem consultora"].filter(Boolean).join(" · ")} />
                )}
              </div>
              <div className="flex items-center gap-6 text-sm">
                <span className="tabular-nums text-ledger-muted">{m.pecas} peças</span>
                <span className="tabular-nums font-semibold text-ledger-text">{brl(Number(m.valor_cents ?? 0))}</span>
                <StatusBadge tone={TOM[st.tom]}>{st.rotulo}</StatusBadge>
              </div>
              {podeMontar && m.consultora_party_id && m.status !== "cancelada" && r.status !== "cancelada" && (
                <InfoAcertoInline remessaId={r.id} partyId={m.consultora_party_id} podeEditar={podeMontar} />
              )}
            </div>
          );
  };

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
        {master && (
          <Link to="/admin/cadastros/correcoes" className="admin-btn" title="Master: cancelar remessa vazia, excluir venda de teste, vincular histórico.">
            <ShieldCheck aria-hidden className="size-4" /> Correções do administrador
          </Link>
        )}
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
          {r.representante && (
            <div className="mb-4 grid gap-2" role="radiogroup" aria-label="Para quem é a maleta">
              <span className="ledger-eyebrow">Para quem é a maleta</span>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" role="radio" aria-checked={destino === "consultora"} onClick={() => setDestino("consultora")}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${destino === "consultora" ? "border-2 border-primary bg-primary/15" : "border-border opacity-80 hover:bg-muted/50 hover:opacity-100"}`}>
                  <span aria-hidden className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 ${destino === "consultora" ? "border-primary" : "border-ledger-muted/60"}`}>{destino === "consultora" && <span className="size-2.5 rounded-full bg-primary" />}</span>
                  <span className="grid gap-0.5">
                    <strong className="text-sm text-ledger-text">Consultora da praça</strong>
                    <span className="text-xs text-ledger-muted">Maleta com nome de uma consultora já cadastrada.</span>
                  </span>
                </button>
                <button type="button" role="radio" aria-checked={destino === "representante"} onClick={() => setDestino("representante")}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${destino === "representante" ? "border-2 border-primary bg-primary/15" : "border-border opacity-80 hover:bg-muted/50 hover:opacity-100"}`}>
                  <span aria-hidden className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 ${destino === "representante" ? "border-primary" : "border-ledger-muted/60"}`}>{destino === "representante" && <span className="size-2.5 rounded-full bg-primary" />}</span>
                  <span className="grid gap-0.5">
                    <strong className="text-sm text-ledger-text">Representante · maletas de abertura</strong>
                    <span className="text-xs text-ledger-muted">Sem consultora, em custódia de {r.representante}, para ele abrir novas consultoras.</span>
                  </span>
                </button>
              </div>
            </div>
          )}
          {r.representante && destino === "representante" ? (
            <div className="flex flex-wrap items-end gap-3" aria-label="Maletas de abertura do representante">
              <div className="grid min-w-80 flex-1 gap-1.5 text-sm">
                <span className="ledger-eyebrow">Representante</span>
                <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-ledger-text">
                  <UserRound aria-hidden className="size-4 text-primary" /> <strong>{r.representante}</strong>
                </div>
                <span className="text-xs text-ledger-muted">
                  {comRepresentante > 0 ? `${comRepresentante} ${comRepresentante === 1 ? "maleta de abertura já aberta" : "maletas de abertura já abertas"} nesta remessa. ` : ""}
                  Cada uma recebe o número ABERTURA 1, 2, 3… e depois ele passa para uma consultora ou candidata pelo app dele.
                </span>
              </div>
              <div className="grid gap-1.5 text-sm">
                <span className="ledger-eyebrow">Quantidade</span>
                <div className="flex h-10 items-center overflow-hidden rounded-lg border border-border">
                  <button type="button" className="h-full px-3 text-lg hover:bg-muted disabled:opacity-40" aria-label="Diminuir quantidade"
                    disabled={qtdAbertura <= 1 || abrirRep.isPending} onClick={() => setQtdAbertura((q) => Math.max(1, q - 1))}>−</button>
                  <span className="min-w-12 text-center text-base font-semibold tabular-nums" aria-live="polite" aria-label="Quantidade de maletas">{qtdAbertura}</span>
                  <button type="button" className="h-full px-3 text-lg hover:bg-muted disabled:opacity-40" aria-label="Aumentar quantidade"
                    disabled={qtdAbertura >= 30 || abrirRep.isPending} onClick={() => setQtdAbertura((q) => Math.min(30, q + 1))}>+</button>
                </div>
              </div>
              <button type="button" className="admin-btn admin-btn-primary" disabled={abrirRep.isPending}
                onClick={() => { if (qtdAbertura === 1 || window.confirm(`Abrir ${qtdAbertura} maletas de abertura em nome do representante ${r.representante}?`)) abrirRep.mutate(qtdAbertura); }}>
                <UserRound aria-hidden className="size-4" />
                {abrirRep.isPending ? "Abrindo…" : `Abrir ${qtdAbertura} ${qtdAbertura === 1 ? "maleta de abertura" : "maletas de abertura"}`}
              </button>
            </div>
          ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-80 flex-1 gap-1.5 text-sm">
              <span className="ledger-eyebrow">{escopo.data?.carteira ? `Consultora da praça ${r.praca}` : "Consultora"}</span>
              <SmartSelect value={consultora} onChange={setConsultora} options={opcoes} onSearch={setBusca}
                loading={consultoras.isFetching} searchPlaceholder="Nome, código ou CPF" placeholder="Escolher consultora" />
              <span className="text-xs text-ledger-muted">
                {consultoras.error ? "Não foi possível buscar agora. Tente novamente." : consultoras.data ? `${consultoras.data.length} consultora(s) encontradas${consultoras.data.length === 100 ? " · refine a busca" : ""}` : "Carregando consultoras…"}
              </span>
            </label>
            <button type="button" className="admin-btn admin-btn-primary" disabled={abrir.isPending} onClick={() => abrir.mutate()}>
              <Plus aria-hidden className="size-4" /> {abrir.isPending ? "Abrindo…" : "Abrir maleta"}
            </button>
            {maletasDela.length > 0 && (
              <div className="grid w-full gap-2 rounded-xl border border-warning/50 bg-warning/5 p-3 text-sm" aria-label="Segunda maleta para a mesma consultora">
                <p className="text-ledger-text">
                  <strong>Ela já tem {maletasDela.length === 1 ? "uma maleta" : `${maletasDela.length} maletas`} nesta remessa.</strong>{" "}
                  "Abrir maleta" leva para a que ela já tem. Para montar mais uma, escreva o motivo e use "Abrir 2ª maleta".
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input className="admin-input min-w-72 flex-1" value={motivoSegunda} onChange={(e) => setMotivoSegunda(e.target.value)}
                    aria-label="Motivo da segunda maleta" placeholder="Motivo (ex.: vende muito, pediu mais peças para o fim de ano)" />
                  <button type="button" className="admin-btn admin-btn-primary" disabled={abrirSegunda.isPending || motivoSegunda.trim().length < 5}
                    onClick={() => abrirSegunda.mutate()}>
                    <Plus aria-hidden className="size-4" /> {abrirSegunda.isPending ? "Abrindo…" : "Abrir 2ª maleta"}
                  </button>
                </div>
                <p className="text-xs text-ledger-muted">O motivo fica registrado. A comissão continua somando as maletas dela na remessa.</p>
              </div>
            )}
            {semPreBaixa && master && (
              <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-warning/50 bg-warning/5 p-3 text-sm">
                <span className="w-full text-ledger-muted">{semPreBaixa}</span>
                <input className="admin-input flex-1" placeholder="Motivo para liberar sem pré-baixa (fica na auditoria)" value={motivoLib} onChange={(e) => setMotivoLib(e.target.value)} />
                <button type="button" className="admin-btn" disabled={liberar.isPending || motivoLib.trim().length < 5} onClick={() => liberar.mutate()}>Liberar e abrir</button>
              </div>
            )}
          </div>
          )}
        </Panel>
      )}

      {podeMontar && escopo.data?.carteira && r.status !== "fechada" && r.status !== "cancelada" && (
        <Panel title="Consultora não aparece na lista?">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-80 flex-1 gap-1.5 text-sm">
              <span className="ledger-eyebrow">Trazer consultora de fora desta praça</span>
              <SmartSelect value={semPraca} onChange={setSemPraca} options={semPracaOpcoes.data ?? []} onSearch={setBuscaSemPraca}
                loading={semPracaOpcoes.isFetching} searchPlaceholder="Digite nome ou CPF (2 letras ou mais)" placeholder="Buscar consultora (nome, código ou CPF)"
                emptyLabel={buscaSemPraca.trim().length < 2 ? "Digite ao menos 2 letras" : "Nenhuma consultora encontrada com esse nome"} />
              <span className="text-xs text-ledger-muted">Ela passa para a praça {r.praca} (fica registrado quem fez). Quem já tem outra praça não muda por aqui.</span>
            </label>
            <button type="button" className="admin-btn admin-btn-primary" disabled={!semPraca || vincular.isPending} onClick={() => vincular.mutate()}>
              <Plus aria-hidden className="size-4" /> {vincular.isPending ? "Vinculando…" : "Trazer para a praça e abrir maleta"}
            </button>
          </div>
        </Panel>
      )}

      {comRep && podeMontar && conferidasRep > 0 && (
        <Panel title={`Entregar ao representante ${r.representante}`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-sm text-ledger-muted">
              {conferidasRep} {conferidasRep === 1 ? "maleta conferida pronta" : "maletas conferidas prontas"}. Elas passam para a custódia do representante: ele confirma no app que recebeu, entrega em mãos a cada consultora e ela confirma o recebimento e faz o aceite. As peças já aparecem na vitrine dela para divulgar; vender, só depois do recebimento.
            </p>
            <button type="button" className="admin-btn admin-btn-primary" disabled={paraRep.isPending}
              onClick={() => { if (window.confirm(`Entregar ${conferidasRep} maletas ao representante ${r.representante}?`)) paraRep.mutate(null); }}>
              <UserRound aria-hidden className="size-4" /> {paraRep.isPending ? "Entregando…" : `Entregar as ${conferidasRep} ao representante`}
            </button>
          </div>
        </Panel>
      )}

      {master && maletas.isSuccess && (maletas.data?.length ?? 0) === 0 && r.status !== "cancelada" && r.status !== "fechada" && (
        <Panel title="Remessa criada por engano?">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-sm text-ledger-muted">
              A remessa {r.numero} está vazia (nenhuma maleta). Se foi aberta por engano, cancele aqui. Ela sai das listas e fica registrada na auditoria com o motivo.
            </p>
            <button type="button" className="admin-btn" disabled={cancelarVazia.isPending} onClick={() => cancelarVazia.mutate(r.numero)}>
              <Ban aria-hidden className="size-4" /> {cancelarVazia.isPending ? "Cancelando…" : `Cancelar remessa ${r.numero}`}
            </button>
          </div>
        </Panel>
      )}

      {podeMontar && <DevolucoesPendentes remessaNumero={r.numero} />}

      {master && <AceiteAdministrativo remessaId={id} />}
      <Panel title="Maletas da remessa" flush>
        {maletas.isLoading && <div className="p-6"><Skeleton className="h-14" /></div>}
        {maletas.data?.length === 0 && (
          <div className="px-6"><EmptyState title="Nenhuma maleta ainda" description="Escolha uma consultora da praça acima para abrir a primeira maleta." /></div>
        )}
        {(maletas.data?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-6 py-4">
            <label className="flex h-11 min-w-[18rem] flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 focus-within:border-champagne">
              <Search aria-hidden className="size-4 shrink-0 text-ledger-muted" />
              <input value={buscaMaleta} onChange={(e) => setBuscaMaleta(e.target.value)} aria-label="Buscar maleta nesta remessa"
                placeholder="Buscar consultora (nome ou código) ou maleta (MAL-00467, 467, MALETA 02)"
                className="h-full w-full bg-transparent text-sm outline-none placeholder:text-ledger-muted" />
              {buscaMaleta && <button type="button" className="text-xs text-ledger-muted hover:text-ledger-text" onClick={() => setBuscaMaleta("")}>Limpar</button>}
            </label>
            <span className="text-sm tabular-nums text-ledger-muted">
              {buscaMaleta.trim() ? `${maletasFiltradas.length} de ${maletas.data?.length ?? 0} maletas` : `${maletas.data?.length ?? 0} maletas`}
            </span>
          </div>
        )}
        {buscaMaleta.trim() && maletasFiltradas.length === 0 && (maletas.data?.length ?? 0) > 0 && (
          <div className="px-6 py-6"><EmptyState title="Nenhuma maleta encontrada" description="Confira o nome, o código da consultora ou o número da maleta." /></div>
        )}
        {gruposMaletas.map((g) => {
          if (g.itens.length === 1) return linhaMaleta(g.itens[0]!);
          const aberto = buscaMaleta.trim().length > 0 || gruposAbertos.has(g.chave);
          const m0 = g.itens[0]!;
          const pecas = g.itens.reduce((t, m) => t + Number(m.pecas ?? 0), 0);
          const valor = g.itens.reduce((t, m) => t + Number(m.valor_cents ?? 0), 0);
          return (
            <div key={g.chave} className="border-b border-line-soft" data-grupo-consultora="">
              <button type="button" aria-expanded={aberto} onClick={() => alternarGrupo(g.chave)}
                className="flex w-full flex-wrap items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-surface-muted">
                <span className="flex min-w-56 flex-1 items-center gap-2 font-semibold text-ledger-text">
                  <ChevronRight aria-hidden className={`size-4 shrink-0 text-ledger-muted transition-transform ${aberto ? "rotate-90" : ""}`} />
                  <span className="min-w-0">
                    {m0.consultora_party_id && codigos.data?.get(m0.consultora_party_id) && (
                      <span className="mr-2 align-middle text-sm font-semibold tabular-nums text-ledger-muted">[Cód. {codigos.data.get(m0.consultora_party_id)}]</span>
                    )}
                    {m0.consultora}
                    <span className="ml-2 inline-flex h-6 items-center rounded-md bg-primary/10 px-2 align-middle text-xs font-bold text-primary">{g.itens.length} maletas</span>
                    <span className="ml-2 whitespace-nowrap align-middle text-xs font-semibold tabular-nums text-ledger-muted">
                      {g.itens.map((m) => codigosMaleta.data?.get(m.cycle_id) ?? rotuloMaletaRemessa(m)).filter(Boolean).join(" + ")}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-6 text-sm">
                  <span className="tabular-nums text-ledger-muted">{pecas} peças</span>
                  <span className="tabular-nums font-semibold text-ledger-text">{brl(valor)}</span>
                  <span className="text-xs text-ledger-muted">{aberto ? "Fechar" : "Abrir as maletas"}</span>
                </span>
              </button>
              {aberto && <div className="border-t border-line-soft bg-surface-muted/40">{g.itens.map((m) => linhaMaleta(m, true))}</div>}
            </div>
          );
        })}
      </Panel>

      {podeMontar && r.status !== "cancelada" && <InformacoesRemessa remessaId={r.id} podeEditar={podeMontar} />}

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
                {pendInfo > 0 && <strong className="text-ledger-text"> {pendInfo} consultora(s) da praça sem maleta e sem motivo anotado acima{master ? " (o Master pode finalizar assim mesmo)" : ""}.</strong>}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input className="admin-input w-56" inputMode="numeric" placeholder={`Digite ${r.numero} para confirmar`} value={confirmaNumero}
                  onChange={(e) => setConfirmaNumero(e.target.value.replace(/\D/g, ""))} aria-label="Número da remessa para confirmar" />
                <button type="button" className="admin-btn admin-btn-primary" disabled={finalizar.isPending || emMontagem > 0 || Number(confirmaNumero) !== r.numero || (pendInfo > 0 && !master)}
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

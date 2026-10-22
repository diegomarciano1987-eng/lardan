/**
 * Focus NFe — notas de TESTE em homologação (sem valor fiscal).
 * Valida token, certificado e o roteiro (remessa → devolução/venda/perda)
 * com consultora e peças reais do cadastro. Emitir e cancelar: só Master.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { ErrorState, Panel, Skeleton, StatusBadge, type StatusTone, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  focusArquivos,
  focusCancelar,
  focusConsultar,
  focusEmitirTeste,
  focusEstado,
  focusRegistrarAviso,
} from "@/lib/focus/focus.functions";
import { valorFiscalUnitario, type OperacaoNfe } from "@/lib/focus/nfe";

interface Envio {
  ref: string;
  ambiente: string;
  operacao: OperacaoNfe;
  ref_origem: string | null;
  consultora: string | null;
  status: string;
  status_sefaz: string | null;
  mensagem_sefaz: string | null;
  erros: { mensagem?: string; campo?: string }[] | null;
  chave_nfe: string | null;
  numero: string | null;
  serie: string | null;
  tem_danfe: boolean;
  valor_total: number | null;
  pecas: number | null;
  itens: { codigo: string; descricao: string; quantidade: number }[] | null;
  created_at: string;
}

const OPERACAO: Record<OperacaoNfe, string> = { remessa: "Remessa", devolucao: "Devolução", venda: "Venda", perda: "Perda" };
const STATUS: Record<string, { rotulo: string; tom: StatusTone }> = {
  pendente: { rotulo: "Preparando", tom: "neutral" },
  processando_autorizacao: { rotulo: "Na SEFAZ", tom: "info" },
  autorizado: { rotulo: "Autorizada", tom: "success" },
  erro_autorizacao: { rotulo: "Rejeitada", tom: "danger" },
  denegado: { rotulo: "Denegada", tom: "danger" },
  cancelado: { rotulo: "Cancelada", tom: "warning" },
  erro_envio: { rotulo: "Não enviada", tom: "danger" },
};
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Falha.");

// ------------------------------------------------------------ busca ---
function BuscaConsultora({ onEscolher }: { onEscolher: (p: { id: string; nome: string }) => void }) {
  const [texto, setTexto] = React.useState("");
  const [termo, setTermo] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setTermo(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);
  const q = useQuery({
    queryKey: ["focus", "pessoas", termo],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_parties", { _search: termo.trim(), _limit: 20, _offset: 0 });
      if (error) throw error;
      return ((data ?? []) as unknown as { id: string; display_name: string; code?: string | null }[]).map((p) => ({
        value: p.id,
        label: `${p.display_name}${p.code ? ` · ${p.code}` : ""}`,
      }));
    },
    enabled: termo.trim().length >= 2,
  });
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="ledger-eyebrow">Consultora (dados reais; na nota de teste o nome sai como exige a SEFAZ)</span>
      <span className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" />
        <input className="admin-input w-full pl-9" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nome ou código" />
      </span>
      {termo.trim().length >= 2 && (
        <SmartSelect
          value=""
          onChange={(v) => {
            const o = q.data?.find((x) => x.value === v);
            if (o) onEscolher({ id: o.value, nome: o.label });
          }}
          options={q.data ?? []}
          loading={q.isFetching}
          placeholder={q.data?.length ? "Escolher consultora" : "Nenhuma pessoa encontrada"}
        />
      )}
    </div>
  );
}

interface Peca { variantId: string; nome: string; codigo: string; precoCents: number; quantidade: number }

function BuscaPeca({ onEscolher }: { onEscolher: (p: Omit<Peca, "quantidade">) => void }) {
  const [texto, setTexto] = React.useState("");
  const [termo, setTermo] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setTermo(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);
  const q = useQuery({
    queryKey: ["focus", "pecas", termo],
    queryFn: async () => {
      const t = termo.trim().replace(/[%,()]/g, " ");
      let consulta = supabase.from("products").select("id, name, internal_code, price_cents, product_variants(id, label, sku, price_cents, is_active)").limit(10);
      consulta = /^\d+$/.test(t) ? consulta.or(`internal_code.ilike.%${t}%,name.ilike.%${t}%`) : consulta.ilike("name", `%${t}%`);
      const { data, error } = await consulta;
      if (error) throw error;
      type V = { id: string; label: string | null; sku: string | null; price_cents: number | null; is_active: boolean };
      const out: Omit<Peca, "quantidade">[] = [];
      for (const p of (data ?? []) as unknown as { name: string; internal_code: string | null; price_cents: number | null; product_variants: V[] }[]) {
        for (const v of p.product_variants ?? []) {
          if (!v.is_active) continue;
          out.push({ variantId: v.id, nome: [p.name, v.label].filter(Boolean).join(" · "), codigo: v.sku ?? p.internal_code ?? "", precoCents: v.price_cents || p.price_cents || 0 });
        }
      }
      return out.slice(0, 15);
    },
    enabled: termo.trim().length >= 2,
  });
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="ledger-eyebrow">Peças</span>
      <span className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" />
        <input className="admin-input w-full pl-9" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nome ou código da peça" />
      </span>
      {(q.data?.length ?? 0) > 0 && (
        <ul className="max-h-48 divide-y divide-line-soft overflow-auto rounded-xl border border-line-soft">
          {q.data!.map((p) => (
            <li key={p.variantId}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted" onClick={() => onEscolher(p)}>
                <span className="truncate">{p.nome}</span>
                <span className="shrink-0 tabular-nums text-ledger-muted">{p.codigo} · {formatBRLFromCents(p.precoCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------- nova remessa ---
function NovaRemessa({ aoEmitir }: { aoEmitir: () => void }) {
  const emitir = useServerFn(focusEmitirTeste);
  const [consultora, setConsultora] = React.useState<{ id: string; nome: string } | null>(null);
  const [pecas, setPecas] = React.useState<Peca[]>([]);
  const m = useMutation({
    mutationFn: () =>
      emitir({ data: { operacao: "remessa", partyId: consultora?.id ?? null, itens: pecas.map((p) => ({ variantId: p.variantId, quantidade: p.quantidade })) } }),
    onSuccess: (r) => {
      toast.success(`Remessa de teste enviada (${STATUS[r.status]?.rotulo ?? r.status}).`);
      setPecas([]);
      aoEmitir();
    },
    onError: (e) => toast.error(msgErro(e)),
  });
  const totalFiscal = pecas.reduce((s, p) => s + valorFiscalUnitario(p.precoCents) * p.quantidade, 0);

  return (
    <div className="space-y-4 rounded-2xl border border-line-soft p-4">
      <p className="text-sm font-semibold text-ledger-text">Nova remessa de teste</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <BuscaConsultora onEscolher={setConsultora} />
          {consultora && <p className="text-sm">Consultora: <strong>{consultora.nome}</strong></p>}
        </div>
        <BuscaPeca
          onEscolher={(p) =>
            setPecas((l) => (l.some((x) => x.variantId === p.variantId) ? l.map((x) => (x.variantId === p.variantId ? { ...x, quantidade: x.quantidade + 1 } : x)) : [...l, { ...p, quantidade: 1 }]))
          }
        />
      </div>
      {pecas.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
            <tr>
              <th className="py-1.5">Peça</th>
              <th className="py-1.5 text-right">Varejo</th>
              <th className="py-1.5 text-right">Na nota (1/3)</th>
              <th className="py-1.5 text-right">Qtd.</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pecas.map((p) => (
              <tr key={p.variantId} className="border-t border-line-soft">
                <td className="py-1.5">{p.nome} <span className="text-ledger-muted">{p.codigo}</span></td>
                <td className="py-1.5 text-right tabular-nums">{formatBRLFromCents(p.precoCents)}</td>
                <td className="py-1.5 text-right tabular-nums">{valorFiscalUnitario(p.precoCents).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                <td className="py-1.5 text-right">
                  <input type="number" min={1} max={999} className="admin-input w-20 text-right" value={p.quantidade}
                    onChange={(e) => setPecas((l) => l.map((x) => (x.variantId === p.variantId ? { ...x, quantidade: Math.max(1, Math.trunc(Number(e.target.value) || 1)) } : x)))} />
                </td>
                <td className="py-1.5 text-right">
                  <button type="button" aria-label={`Tirar ${p.nome}`} className="rounded-md p-1 hover:bg-surface-muted" onClick={() => setPecas((l) => l.filter((x) => x.variantId !== p.variantId))}>
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ledger-muted">
          {pecas.length ? `Total da nota: ${totalFiscal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (1/3 do varejo)` : "Escolha a consultora e as peças."}
        </p>
        <button type="button" className="admin-btn admin-btn-primary" disabled={!consultora || pecas.length === 0 || m.isPending} onClick={() => m.mutate()}>
          <Plus aria-hidden className="size-4" /> {m.isPending ? "Enviando…" : "Emitir remessa de teste"}
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------- ações por nota ---
function AcoesRemessa({ envio, aoEmitir, podeEmitir }: { envio: Envio; aoEmitir: () => void; podeEmitir: boolean }) {
  const emitir = useServerFn(focusEmitirTeste);
  const cancelar = useServerFn(focusCancelar);
  const [modo, setModo] = React.useState<null | "devolucao" | "venda" | "perda" | "cancelar">(null);
  const [qtd, setQtd] = React.useState<Record<string, number>>({});
  const [justificativa, setJustificativa] = React.useState("Nota de teste emitida em homologacao para validar a integracao.");

  const derivada = useMutation({
    mutationFn: (op: "devolucao" | "venda" | "perda") => emitir({ data: { operacao: op, refOrigem: envio.ref, quantidades: qtd } }),
    onSuccess: (r, op) => {
      toast.success(`${OPERACAO[op]} de teste enviada (${STATUS[r.status]?.rotulo ?? r.status}).`);
      setModo(null);
      aoEmitir();
    },
    onError: (e) => toast.error(msgErro(e)),
  });
  const canc = useMutation({
    mutationFn: () => cancelar({ data: { ref: envio.ref, justificativa } }),
    onSuccess: (r) => {
      toast.success(r.status === "cancelado" ? "Nota cancelada." : `Cancelamento: ${r.mensagem ?? r.status}`);
      setModo(null);
      aoEmitir();
    },
    onError: (e) => toast.error(msgErro(e)),
  });

  if (!podeEmitir || envio.status !== "autorizado") return null;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {envio.operacao === "remessa" &&
          (["devolucao", "venda", "perda"] as const).map((op) => (
            <button key={op} type="button" className={cn("admin-btn", modo === op && "admin-btn-primary")} onClick={() => setModo(modo === op ? null : op)}>
              {OPERACAO[op]} de teste
            </button>
          ))}
        <button type="button" className={cn("admin-btn", modo === "cancelar" && "admin-btn-primary")} onClick={() => setModo(modo === "cancelar" ? null : "cancelar")}>
          Cancelar nota
        </button>
      </div>
      {modo && modo !== "cancelar" && (
        <div className="space-y-2 rounded-xl border border-line-soft p-3 text-sm">
          <p className="text-ledger-muted">Quantas peças entram na {OPERACAO[modo].toLowerCase()} (0 = fica fora):</p>
          {(envio.itens ?? []).map((i) => (
            <label key={i.codigo} className="flex items-center justify-between gap-3">
              <span className="truncate">{i.descricao} <span className="text-ledger-muted">{i.codigo}</span></span>
              <input type="number" min={0} max={i.quantidade} className="admin-input w-20 text-right" value={qtd[i.codigo] ?? i.quantidade}
                onChange={(e) => setQtd((m) => ({ ...m, [i.codigo]: Math.min(i.quantidade, Math.max(0, Math.trunc(Number(e.target.value) || 0))) }))} />
            </label>
          ))}
          <button type="button" className="admin-btn admin-btn-primary" disabled={derivada.isPending} onClick={() => derivada.mutate(modo)}>
            {derivada.isPending ? "Enviando…" : `Emitir ${OPERACAO[modo].toLowerCase()} de teste`}
          </button>
        </div>
      )}
      {modo === "cancelar" && (
        <div className="space-y-2 rounded-xl border border-line-soft p-3 text-sm">
          <label className="grid gap-1.5">
            <span className="ledger-eyebrow">Justificativa (15 a 255 letras)</span>
            <input className="admin-input w-full" value={justificativa} maxLength={255} onChange={(e) => setJustificativa(e.target.value)} />
          </label>
          <button type="button" className="admin-btn admin-btn-primary" disabled={canc.isPending || justificativa.trim().length < 15} onClick={() => canc.mutate()}>
            {canc.isPending ? "Cancelando…" : "Confirmar cancelamento"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- tela ---
export function FocusHomologacao() {
  const qc = useQueryClient();
  const estadoFn = useServerFn(focusEstado);
  const consultar = useServerFn(focusConsultar);
  const arquivos = useServerFn(focusArquivos);
  const registrar = useServerFn(focusRegistrarAviso);

  const estado = useQuery({ queryKey: ["focus", "estado"], queryFn: () => estadoFn(), retry: false });
  const envios = useQuery({
    queryKey: ["focus", "envios"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fiscal_focus_envios_lista" as never, { _limite: 30 } as never);
      if (error) throw error;
      return (data ?? []) as unknown as Envio[];
    },
    enabled: estado.isSuccess,
    refetchInterval: (q) => ((q.state.data as Envio[] | undefined)?.some((e) => e.status === "processando_autorizacao") ? 5000 : false),
  });
  const recarregar = () => void qc.invalidateQueries({ queryKey: ["focus", "envios"] });

  // Sem aviso (webhook) cadastrado, a tela pergunta à Focus pelas notas em processamento.
  const processando = (envios.data ?? []).filter((e) => e.status === "processando_autorizacao").map((e) => e.ref).join(",");
  React.useEffect(() => {
    if (!processando) return;
    const t = setInterval(() => {
      for (const ref of processando.split(",")) void consultar({ data: { ref } }).then(recarregar).catch(() => undefined);
    }, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processando]);

  const aviso = useMutation({
    mutationFn: () => registrar(),
    onSuccess: (r) => toast.success(r.criado ? "Aviso cadastrado na Focus." : "O aviso já estava cadastrado na Focus."),
    onError: (e) => toast.error(msgErro(e)),
  });
  const abrir = async (ref: string, tipo: "danfe" | "xml") => {
    try {
      const a = await arquivos({ data: { ref } });
      const url = tipo === "danfe" ? a.danfe : a.xml;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else toast.error("Arquivo ainda não disponível.");
    } catch (e) {
      toast.error(msgErro(e));
    }
  };

  if (estado.isError) return null; // sem permissão: o cartão não aparece
  const s = estado.data;

  return (
    <Panel title="Focus NFe — notas de teste em homologação (sem valor fiscal)">
      {!s ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="space-y-5 text-sm">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-line-soft p-3">
              <p className="ledger-eyebrow">Homologação</p>
              {s.homologacao.pronto ? (
                <p className="mt-1"><StatusBadge tone="success">Pronta</StatusBadge></p>
              ) : (
                <p className="mt-1 text-ledger-text">Falta configurar: <strong>{s.homologacao.faltando.join(", ")}</strong></p>
              )}
            </div>
            <div className="rounded-xl border border-line-soft p-3">
              <p className="ledger-eyebrow">Emissor</p>
              <p className="mt-1 text-ledger-text">{s.emissor ? `CNPJ ${s.emissor.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")} · ${s.emissor.uf}` : "Não definido"}</p>
            </div>
            <div className="rounded-xl border border-line-soft p-3">
              <p className="ledger-eyebrow">Aviso automático da Focus</p>
              {s.homologacao.avisoPronto ? (
                <button type="button" className="admin-btn mt-1" disabled={!s.podeEmitir || !s.homologacao.pronto || aviso.isPending} onClick={() => aviso.mutate()}>
                  {aviso.isPending ? "Cadastrando…" : "Registrar aviso na Focus"}
                </button>
              ) : (
                <p className="mt-1 text-ledger-muted">Falta FOCUS_WEBHOOK_URL e FOCUS_WEBHOOK_SECRET. Sem aviso, a tela consulta a Focus sozinha.</p>
              )}
            </div>
          </div>

          {s.podeEmitir && s.homologacao.pronto && s.emissor && <NovaRemessa aoEmitir={recarregar} />}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="ledger-eyebrow">Notas de teste</p>
              <button type="button" className="admin-btn" onClick={recarregar}><RefreshCw aria-hidden className="size-4" /> Atualizar</button>
            </div>
            {envios.isLoading && <Skeleton className="h-16 w-full" />}
            {envios.isError && <ErrorState message={msgErro(envios.error)} onRetry={() => void envios.refetch()} />}
            {envios.data?.length === 0 && <p className="text-ledger-muted">Nenhuma nota de teste ainda.</p>}
            <ul className="space-y-3">
              {(envios.data ?? []).map((e) => {
                const st = STATUS[e.status] ?? { rotulo: e.status, tom: "neutral" as StatusTone };
                return (
                  <li key={e.ref} className="rounded-xl border border-line-soft p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-ledger-text">
                        {OPERACAO[e.operacao]} {e.numero ? `nº ${e.numero} série ${e.serie ?? "—"}` : ""} · {e.consultora ?? "—"}
                      </p>
                      <StatusBadge tone={st.tom}>{st.rotulo}</StatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-ledger-muted">
                      {new Date(e.created_at).toLocaleString("pt-BR")} · {e.pecas ?? 0} peça(s) ·{" "}
                      {Number(e.valor_total ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · ref {e.ref}
                      {e.chave_nfe ? ` · chave ${e.chave_nfe}` : ""}
                    </p>
                    {(e.mensagem_sefaz || e.erros?.length) && (
                      <p className={cn("mt-1 text-xs", e.status === "autorizado" ? "text-ledger-muted" : "text-danger")}>
                        {e.status_sefaz ? `SEFAZ ${e.status_sefaz}: ` : ""}{e.mensagem_sefaz}
                        {e.erros?.map((x) => ` ${x.campo ? `[${x.campo}] ` : ""}${x.mensagem ?? ""}`).join(";")}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="admin-btn" onClick={() => void consultar({ data: { ref: e.ref } }).then(recarregar).catch((x) => toast.error(msgErro(x)))}>
                        <RefreshCw aria-hidden className="size-4" /> Consultar na Focus
                      </button>
                      {e.tem_danfe && (
                        <>
                          <button type="button" className="admin-btn" onClick={() => void abrir(e.ref, "danfe")}><FileText aria-hidden className="size-4" /> DANFE</button>
                          <button type="button" className="admin-btn" onClick={() => void abrir(e.ref, "xml")}><FileText aria-hidden className="size-4" /> XML</button>
                        </>
                      )}
                    </div>
                    <AcoesRemessa envio={e} aoEmitir={recarregar} podeEmitir={s.podeEmitir} />
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  );
}

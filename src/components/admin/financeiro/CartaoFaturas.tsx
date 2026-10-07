import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Lock, Plus, Sparkles, Trash2, Unlock, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Panel, Skeleton, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { useCapabilities } from "@/lib/capabilities";
import { buscarContrapartes, fetchClassificacoes, fetchFinAccounts } from "@/lib/financeiro";
import {
  abrirFatura,
  classificarGastos,
  detalheFatura,
  excluirGasto,
  fecharFatura,
  importarGastos,
  lerExtrato,
  painelCartao,
  proximoVencimento,
  reabrirFatura,
  type FaturaResumo,
  type GastoLido,
} from "@/lib/financeiro-cartao";
import { categorizarFatura } from "@/lib/cartao.functions";
import { Campo, inputCls } from "@/components/admin/financeiro/NovoCartaoSheet";

const dataBR = (d: string) => new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`));
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const refBR = (r: string) => `${r.slice(5, 7)}/${r.slice(0, 4)}`;

function situacao(f: FaturaResumo): { tone: "info" | "warning" | "success"; label: string } {
  if (f.status === "aberta") return { tone: "info", label: "Aberta" };
  if (f.pago_cents >= f.total_cents) return { tone: "success", label: "Paga" };
  return { tone: "warning", label: f.pago_cents > 0 ? "Paga em parte" : "Fechada — a pagar" };
}

/** Painel do cartão: faturas, importação do extrato, categorias por IA e fechamento em conta a pagar única. */
export function CartaoFaturas({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const pode = caps.includes("finance.payable.manage");
  const painel = useQuery({ queryKey: ["cartao-painel", accountId], queryFn: () => painelCartao(accountId) });
  const [sel, setSel] = React.useState<string | null>(null);
  const [nova, setNova] = React.useState(false);

  const faturas = painel.data?.faturas ?? [];
  React.useEffect(() => {
    if (!sel && faturas[0]) setSel(faturas.find((f) => f.status === "aberta")?.id ?? faturas[0].id);
  }, [faturas, sel]);

  if (painel.isLoading) return <Skeleton className="h-48 w-full" />;
  if (painel.error) return <ErrorState message={(painel.error as Error).message} />;
  const cfg = painel.data?.config;
  const usado = faturas
    .filter((f) => f.status === "aberta" || f.pago_cents < f.total_cents)
    .reduce((s, f) => s + f.total_cents - (f.status === "fechada" ? f.pago_cents : 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Resumo titulo="Limite" valor={cfg?.limite_cents != null ? formatBRLFromCents(cfg.limite_cents) : "Não informado"} />
        <Resumo titulo="Em uso (faturas não pagas)" valor={formatBRLFromCents(usado)} />
        <Resumo titulo="Disponível" valor={cfg?.limite_cents != null ? formatBRLFromCents(cfg.limite_cents - usado) : "—"} />
        <Resumo
          titulo="Fatura"
          valor={`${cfg?.dia_fechamento ? `fecha dia ${cfg.dia_fechamento} · ` : ""}vence dia ${cfg?.dia_vencimento ?? "—"}`}
        />
      </div>

      <Panel
        title="Faturas"
        action={
          pode ? (
            <button type="button" className="admin-btn-primary" onClick={() => setNova(true)}>
              <Plus aria-hidden className="size-4" /> Nova fatura
            </button>
          ) : undefined
        }
      >
        {faturas.length === 0 ? (
          <EmptyState title="Nenhuma fatura ainda" description="Crie a fatura do mês e importe o extrato do cartão." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {faturas.map((f) => {
              const s = situacao(f);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSel(f.id)}
                  aria-pressed={sel === f.id}
                  className={`min-w-44 rounded-[12px] border px-4 py-3 text-left transition-colors ${
                    sel === f.id ? "border-champagne bg-surface shadow-sm" : "border-line-soft bg-cream-2 hover:bg-surface"
                  }`}
                >
                  <p className="text-xs font-semibold tracking-wide text-ledger-muted uppercase">Fatura {refBR(f.referencia)}</p>
                  <p className="font-display text-lg font-bold tabular-nums text-ledger-text">{formatBRLFromCents(f.total_cents)}</p>
                  <p className="mb-1.5 text-xs text-ledger-muted">vence {dataBR(f.vencimento)} · {f.qtd} gastos</p>
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      {sel && <FaturaPainel key={sel} faturaId={sel} pode={pode} accountId={accountId} />}

      <NovaFatura
        open={nova}
        onOpenChange={setNova}
        diaVenc={cfg?.dia_vencimento ?? 10}
        onCriar={async (venc) => {
          const id = await abrirFatura(accountId, venc.slice(0, 7), venc);
          await qc.invalidateQueries({ queryKey: ["cartao-painel", accountId] });
          setSel(id);
        }}
      />
    </div>
  );
}

function Resumo({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-[14px] border border-line-soft bg-surface px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-ledger-muted uppercase">{titulo}</p>
      <p className="mt-1 font-display text-lg font-bold tabular-nums text-ledger-text">{valor}</p>
    </div>
  );
}

function NovaFatura({
  open,
  onOpenChange,
  diaVenc,
  onCriar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  diaVenc: number;
  onCriar: (venc: string) => Promise<void>;
}) {
  const [venc, setVenc] = React.useState<Date | undefined>();
  const [salvando, setSalvando] = React.useState(false);
  React.useEffect(() => {
    if (open) setVenc(new Date(`${proximoVencimento(diaVenc)}T12:00:00`));
  }, [open, diaVenc]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova fatura</DialogTitle>
          <DialogDescription>A fatura é identificada pelo mês do vencimento. Se já existir, ela é aberta.</DialogDescription>
        </DialogHeader>
        <Campo label="Vencimento">
          <DateField value={venc} onChange={setVenc} />
        </Campo>
        <div className="flex justify-end gap-2">
          <button type="button" className="admin-btn" onClick={() => onOpenChange(false)}>Cancelar</button>
          <button
            type="button"
            className="admin-btn-primary"
            disabled={!venc || salvando}
            onClick={async () => {
              if (!venc) return;
              setSalvando(true);
              try {
                await onCriar(iso(venc));
                onOpenChange(false);
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSalvando(false);
              }
            }}
          >
            {salvando ? "Abrindo…" : "Abrir fatura"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FaturaPainel({ faturaId, pode, accountId }: { faturaId: string; pode: boolean; accountId: string }) {
  const qc = useQueryClient();
  const det = useQuery({ queryKey: ["cartao-fatura", faturaId], queryFn: () => detalheFatura(faturaId) });
  const cls = useQuery({ queryKey: ["fin-classificacoes", "payable"], queryFn: () => fetchClassificacoes({ direction: "payable" }) });
  const categorizar = useServerFn(categorizarFatura);
  const [filtro, setFiltro] = React.useState<"todos" | "sem" | "revisar">("todos");
  const [previa, setPrevia] = React.useState<GastoLido[] | null>(null);
  const [colar, setColar] = React.useState(false);
  const [fechar, setFechar] = React.useState(false);
  const [reabrir, setReabrir] = React.useState(false);
  const arquivo = React.useRef<HTMLInputElement>(null);

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["cartao-fatura", faturaId] });
    void qc.invalidateQueries({ queryKey: ["cartao-painel", accountId] });
  };

  const ia = useMutation({
    mutationFn: async () => {
      const r = await categorizar({ data: { fatura_id: faturaId } });
      if (!r.ok) throw new Error(r.erro);
      return r;
    },
    onSuccess: (r) => {
      toast.success(
        `${r.ia} sugeridos pela IA, ${r.historico} pelo histórico${r.restantes ? `, ${r.restantes} sem sugestão` : ""}. Revise os marcados.`,
      );
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const classificar = useMutation({
    mutationFn: classificarGastos,
    onSuccess: recarregar,
    onError: (e: Error) => toast.error(e.message),
  });

  if (det.isLoading) return <Skeleton className="h-64 w-full" />;
  if (det.error || !det.data) return <ErrorState message="Não foi possível abrir a fatura." />;
  const { fatura, linhas } = det.data;
  const aberta = fatura.status === "aberta";
  const total = linhas.reduce((s, l) => s + l.valor_cents, 0);
  const sem = linhas.filter((l) => !l.chart_account_id).length;
  const revisar = linhas.filter((l) => l.classificado_por === "ia" && (l.ia_confianca ?? 0) < 0.7).length;
  const visiveis = linhas.filter((l) =>
    filtro === "sem" ? !l.chart_account_id : filtro === "revisar" ? l.classificado_por === "ia" && (l.ia_confianca ?? 0) < 0.7 : true,
  );
  const planos = (cls.data?.planos ?? []).filter((p) => ["custo", "despesa", "passivo"].includes(p.natureza));
  const opPlanos = planos.map((p) => ({ value: p.id, label: `${p.codigo} ${p.nome}`, group: p.natureza === "custo" ? "Custos" : p.natureza === "despesa" ? "Despesas" : "Investimentos e outros" }));
  const opCentros = [{ value: "", label: "Sem centro de custo" }, ...(cls.data?.centros ?? []).map((c) => ({ value: c.id, label: `${c.codigo} ${c.nome}` }))];

  const porCategoria = new Map<string, number>();
  for (const l of linhas) porCategoria.set(l.chart ?? "Sem categoria", (porCategoria.get(l.chart ?? "Sem categoria") ?? 0) + l.valor_cents);

  async function lerArquivo(f: File) {
    const texto = await f.text();
    const lidas = lerExtrato(f.name, texto);
    if (!lidas.length) {
      toast.error("Nenhum gasto reconhecido nesse arquivo.");
      return;
    }
    setPrevia(lidas);
  }

  return (
    <div className="space-y-6">
      <Panel
        title={`Fatura ${refBR(fatura.referencia)} — vence ${dataBR(fatura.vencimento)}`}
        action={
          <div className="flex flex-wrap gap-2">
            {aberta && pode && (
              <>
                <input ref={arquivo} type="file" accept=".ofx,.csv,.txt" className="hidden" aria-label="Arquivo do extrato" onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerArquivo(f); e.target.value = ""; }} />
                <button type="button" className="admin-btn" onClick={() => arquivo.current?.click()}>
                  <Upload aria-hidden className="size-4" /> Importar extrato
                </button>
                <button type="button" className="admin-btn" onClick={() => setColar(true)}>Colar gastos</button>
                <button type="button" className="admin-btn" disabled={ia.isPending || sem === 0} onClick={() => ia.mutate()}>
                  <Sparkles aria-hidden className="size-4" /> {ia.isPending ? "Categorizando…" : `Categorizar com IA${sem ? ` (${sem})` : ""}`}
                </button>
                <button type="button" className="admin-btn-primary" disabled={!linhas.length} onClick={() => setFechar(true)}>
                  <Lock aria-hidden className="size-4" /> Fechar e gerar conta a pagar
                </button>
              </>
            )}
            {!aberta && pode && (
              <button type="button" className="admin-btn" onClick={() => setReabrir(true)}>
                <Unlock aria-hidden className="size-4" /> Reabrir fatura
              </button>
            )}
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>Total: <b className="tabular-nums">{formatBRLFromCents(total)}</b></span>
          <span>{linhas.length} gastos</span>
          <span className={sem ? "font-semibold text-warning" : "text-success"}>{sem ? `${sem} sem categoria` : "Todos classificados"}</span>
          {!aberta && fatura.titulo_numero && <span>Conta a pagar nº <b>{fatura.titulo_numero}</b></span>}
          <span className="ml-auto flex gap-1.5">
            {(["todos", "sem", "revisar"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setFiltro(k)} aria-pressed={filtro === k}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${filtro === k ? "border-champagne bg-surface" : "border-line-soft bg-cream-2 text-ledger-muted"}`}>
                {k === "todos" ? "Todos" : k === "sem" ? `Sem categoria (${sem})` : `Revisar IA (${revisar})`}
              </button>
            ))}
          </span>
        </div>

        {linhas.length === 0 ? (
          <EmptyState title="Fatura vazia" description="Importe o arquivo do cartão (OFX ou CSV) ou cole os gastos." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs tracking-wide text-ledger-muted uppercase">
                  <th className="py-2 pr-3">Data da compra</th>
                  <th className="py-2 pr-3">Descrição</th>
                  <th className="py-2 pr-3 text-right">Valor</th>
                  <th className="w-72 py-2 pr-3">Categoria</th>
                  <th className="w-52 py-2 pr-3">Centro de custo</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {visiveis.map((l) => (
                  <tr key={l.id} data-gasto={l.id}>
                    <td className="py-2 pr-3 tabular-nums">{dataBR(l.data)}</td>
                    <td className="py-2 pr-3">
                      <p className="font-medium text-ledger-text">{l.descricao}</p>
                      <p className="text-xs text-ledger-muted">
                        {l.parcela ? `Parcela ${l.parcela} · ` : ""}
                        {l.classificado_por === "ia" && (
                          <span className={(l.ia_confianca ?? 0) < 0.7 ? "font-semibold text-warning" : ""} title={l.ia_motivo ?? ""}>
                            Sugestão da IA {Math.round((l.ia_confianca ?? 0) * 100)}%{l.ia_motivo ? ` — ${l.ia_motivo}` : ""}
                          </span>
                        )}
                        {l.classificado_por === "historico" && "Aprendido de classificações anteriores"}
                        {l.classificado_por === "manual" && "Conferido"}
                      </p>
                    </td>
                    <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${l.valor_cents < 0 ? "text-success" : ""}`}>
                      {formatBRLFromCents(l.valor_cents)}
                    </td>
                    <td className="py-2 pr-3">
                      <SmartSelect
                        options={opPlanos}
                        value={l.chart_account_id ?? ""}
                        disabled={!pode || classificar.isPending}
                        placeholder="Escolher categoria"
                        onChange={(v) => classificar.mutate([{ id: l.id, chart_account_id: v || null, cost_center_id: l.cost_center_id, origem: "manual" }])}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <SmartSelect
                        options={opCentros}
                        value={l.cost_center_id ?? ""}
                        disabled={!pode || !l.chart_account_id || classificar.isPending}
                        placeholder="Centro"
                        onChange={(v) => classificar.mutate([{ id: l.id, chart_account_id: l.chart_account_id, cost_center_id: v || null, origem: l.classificado_por ?? "manual" }])}
                      />
                    </td>
                    <td className="py-2 text-right">
                      {aberta && pode && (
                        <button type="button" aria-label="Excluir gasto" className="rounded p-1.5 text-ledger-muted hover:text-danger"
                          onClick={async () => {
                            const motivo = window.prompt("Motivo para excluir este gasto da fatura:");
                            if (!motivo?.trim()) return;
                            try { await excluirGasto(l.id, motivo); recarregar(); } catch (e) { toast.error((e as Error).message); }
                          }}>
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {linhas.length > 0 && (
        <Panel title="Resumo por categoria (entra no resultado pela data de cada compra)">
          <ul className="divide-y divide-line-soft">
            {[...porCategoria.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k} className="flex justify-between py-2 text-sm">
                <span className={k === "Sem categoria" ? "font-semibold text-warning" : ""}>{k}</span>
                <span className="tabular-nums font-semibold">{formatBRLFromCents(v)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Previa linhas={previa} onClose={() => setPrevia(null)} faturaId={faturaId} onOk={recarregar} />
      <ColarDialog open={colar} onOpenChange={setColar} onLer={(l) => { setColar(false); setPrevia(l); }} />
      <FecharDialog open={fechar} onOpenChange={setFechar} faturaId={faturaId} vencimento={fatura.vencimento} total={total} sem={sem} accountId={accountId} onOk={recarregar} />
      <ReabrirDialog open={reabrir} onOpenChange={setReabrir} faturaId={faturaId} onOk={recarregar} />
    </div>
  );
}

function Previa({ linhas, onClose, faturaId, onOk }: { linhas: GastoLido[] | null; onClose: () => void; faturaId: string; onOk: () => void }) {
  const [itens, setItens] = React.useState<GastoLido[]>([]);
  const [salvando, setSalvando] = React.useState(false);
  React.useEffect(() => setItens(linhas ?? []), [linhas]);
  const marcados = itens.filter((l) => l.incluir && !l.erro);
  const total = marcados.reduce((s, l) => s + l.valor_cents, 0);
  return (
    <Dialog open={!!linhas} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Conferir antes de importar</DialogTitle>
          <DialogDescription>
            Gasto positivo, estorno negativo. Pagamentos da fatura anterior vêm desmarcados. Linhas já importadas são ignoradas.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between text-sm">
          <span>{marcados.length} de {itens.length} linhas · total <b className="tabular-nums">{formatBRLFromCents(total)}</b></span>
          <button type="button" className="admin-btn" onClick={() => setItens((xs) => xs.map((x) => ({ ...x, valor_cents: -x.valor_cents })))}>
            Inverter sinais
          </button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded-[10px] border border-line-soft">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line-soft">
              {itens.map((l, i) => (
                <tr key={i} className={l.erro ? "bg-cream-2 text-ledger-muted" : ""}>
                  <td className="w-8 p-2">
                    <input type="checkbox" aria-label={`Incluir ${l.descricao}`} disabled={!!l.erro} checked={l.incluir && !l.erro}
                      onChange={(e) => setItens((xs) => xs.map((x, j) => (j === i ? { ...x, incluir: e.target.checked } : x)))} />
                  </td>
                  <td className="p-2 tabular-nums">{l.data ? dataBR(l.data) : "—"}</td>
                  <td className="p-2">{l.descricao}{l.parcela ? ` (${l.parcela})` : ""}{l.erro ? ` — ${l.erro}` : ""}</td>
                  <td className="p-2 text-right tabular-nums">{formatBRLFromCents(l.valor_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="admin-btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="admin-btn-primary" disabled={!marcados.length || salvando}
            onClick={async () => {
              setSalvando(true);
              try {
                const r = await importarGastos(faturaId, marcados);
                toast.success(`${r.inseridos} gastos importados${r.repetidos ? `, ${r.repetidos} já existiam` : ""}.`);
                onOk();
                onClose();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSalvando(false);
              }
            }}>
            {salvando ? "Importando…" : `Importar ${marcados.length} gastos`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ColarDialog({ open, onOpenChange, onLer }: { open: boolean; onOpenChange: (v: boolean) => void; onLer: (l: GastoLido[]) => void }) {
  const [texto, setTexto] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Colar gastos</DialogTitle>
          <DialogDescription>Uma linha por gasto: data; descrição; valor. Ex.: 03/09/2026; POSTO SHELL; 189,90</DialogDescription>
        </DialogHeader>
        <textarea aria-label="Gastos colados" value={texto} onChange={(e) => setTexto(e.target.value)} rows={10}
          className="w-full rounded-[10px] border border-line bg-surface p-3 font-mono text-sm outline-none focus:border-champagne" />
        <div className="flex justify-end gap-2">
          <button type="button" className="admin-btn" onClick={() => onOpenChange(false)}>Cancelar</button>
          <button type="button" className="admin-btn-primary" disabled={!texto.trim()}
            onClick={() => {
              const l = lerExtrato("colado.csv", texto);
              if (!l.length) {
                toast.error("Nenhum gasto reconhecido.");
                return;
              }
              setTexto("");
              onLer(l);
            }}>
            Conferir
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FecharDialog({ open, onOpenChange, faturaId, vencimento, total, sem, accountId, onOk }: {
  open: boolean; onOpenChange: (v: boolean) => void; faturaId: string; vencimento: string; total: number; sem: number; accountId: string; onOk: () => void;
}) {
  const painel = useQuery({ queryKey: ["cartao-painel", accountId], queryFn: () => painelCartao(accountId) });
  const contas = useQuery({ queryKey: ["fin-accounts"], queryFn: fetchFinAccounts });
  const [termo, setTermo] = React.useState("");
  const pessoas = useQuery({ queryKey: ["contrapartes", termo], queryFn: () => buscarContrapartes(termo), enabled: open });
  const [venc, setVenc] = React.useState<Date | undefined>();
  const [conta, setConta] = React.useState("");
  const [party, setParty] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const cfg = painel.data?.config;
  React.useEffect(() => {
    if (!open) return;
    setVenc(new Date(`${vencimento}T12:00:00`));
    setConta(cfg?.conta_pagamento_id ?? "");
    setParty(cfg?.emissor_party_id ?? "");
  }, [open, vencimento, cfg?.conta_pagamento_id, cfg?.emissor_party_id]);
  const opPessoas = [
    ...(cfg?.emissor_party_id && cfg.emissor ? [{ value: cfg.emissor_party_id, label: cfg.emissor }] : []),
    ...(pessoas.data ?? []).filter((p) => p.id !== cfg?.emissor_party_id).map((p) => ({ value: p.id, label: p.nome, hint: p.hint })),
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fechar fatura</DialogTitle>
          <DialogDescription>
            Gera uma única conta a pagar de {formatBRLFromCents(total)}. Os gastos continuam no resultado pela data de cada compra.
          </DialogDescription>
        </DialogHeader>
        {sem > 0 && <p className="rounded-[10px] border border-warning px-3 py-2 text-sm text-warning">Ainda há {sem} gasto(s) sem categoria. Classifique todos antes de fechar.</p>}
        <div className="grid gap-3">
          <Campo label="Vencimento (dia do pagamento)"><DateField value={venc} onChange={setVenc} /></Campo>
          <Campo label="Conta que vai pagar">
            <SmartSelect options={(contas.data ?? []).filter((c) => c.kind !== "cartao_credito" && c.is_active).map((c) => ({ value: c.id, label: c.nome }))} value={conta} onChange={setConta} placeholder="Escolher conta" />
          </Campo>
          <Campo label="Favorecido (banco emissor)">
            <SmartSelect options={opPessoas} value={party} onChange={setParty} onSearch={setTermo} loading={pessoas.isFetching} placeholder="Buscar cadastro" />
          </Campo>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="admin-btn" onClick={() => onOpenChange(false)}>Cancelar</button>
          <button type="button" className="admin-btn-primary" disabled={salvando || sem > 0 || !venc || !party}
            onClick={async () => {
              if (!venc) return;
              setSalvando(true);
              try {
                await fecharFatura(faturaId, { vencimento: iso(venc), conta_pagamento_id: conta || null, party_id: party });
                toast.success("Fatura fechada. Conta a pagar gerada.");
                onOk();
                onOpenChange(false);
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSalvando(false);
              }
            }}>
            {salvando ? "Gerando…" : "Fechar e gerar conta a pagar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReabrirDialog({ open, onOpenChange, faturaId, onOk }: { open: boolean; onOpenChange: (v: boolean) => void; faturaId: string; onOk: () => void }) {
  const [motivo, setMotivo] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reabrir fatura</DialogTitle>
          <DialogDescription>A conta a pagar gerada é cancelada (fica no histórico). Só é possível se ela ainda não foi paga.</DialogDescription>
        </DialogHeader>
        <input aria-label="Motivo da reabertura" className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" />
        <div className="flex justify-end gap-2">
          <button type="button" className="admin-btn" onClick={() => onOpenChange(false)}>Cancelar</button>
          <button type="button" className="admin-btn-primary" disabled={!motivo.trim()}
            onClick={async () => {
              try { await reabrirFatura(faturaId, motivo); toast.success("Fatura reaberta."); setMotivo(""); onOk(); onOpenChange(false); }
              catch (e) { toast.error((e as Error).message); }
            }}>
            Reabrir
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

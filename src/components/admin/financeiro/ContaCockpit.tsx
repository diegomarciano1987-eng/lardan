import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";
import { ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, Pencil, Search } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  StatusBadge,
  formatBRLFromCents,
} from "@/components/admin/ui";
import { DateRangeField } from "@/components/premium/DateRangeField";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { useCapabilities } from "@/lib/capabilities";
import { fetchFinAccounts, reaisParaCentavos, transferirEntreContas } from "@/lib/financeiro";
import {
  atualizarConta,
  fetchAuditoriaConta,
  fetchCockpitConta,
  fetchDadosConta,
} from "@/lib/financeiro-contas";

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dataBR = (d: string) => new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`));
const dataHoraBR = (d: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(d));

const TIPO_MOV: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  transferencia_entrada: "Transferência recebida",
  transferencia_saida: "Transferência enviada",
  ajuste: "Ajuste",
  saldo_inicial: "Saldo inicial",
};

const TIPO_CONTA: Record<string, string> = {
  conta_corrente: "Conta corrente",
  poupanca: "Poupança",
  caixa: "Caixa",
  carteira: "Carteira",
  compensacao: "Compensação",
  provedor: "Provedor de pagamento",
  investimento: "Investimento",
};

const CAMPOS: { k: string; label: string; wide?: boolean }[] = [
  { k: "nome", label: "Nome da conta" },
  { k: "apelido", label: "Apelido" },
  { k: "banco", label: "Banco" },
  { k: "banco_codigo", label: "Código do banco" },
  { k: "agencia_masked", label: "Agência" },
  { k: "conta_masked", label: "Número da conta" },
  { k: "conta_digito", label: "Dígito" },
  { k: "pix_chave", label: "Chave Pix" },
  { k: "titular", label: "Titular" },
  { k: "titular_documento", label: "CPF/CNPJ do titular" },
  { k: "agencia_endereco", label: "Endereço da agência", wide: true },
  { k: "agencia_cidade", label: "Cidade da agência" },
  { k: "gerente", label: "Gerente" },
  { k: "gerente_contato", label: "Contato do gerente" },
  { k: "notes", label: "Observações", wide: true },
];

const ACAO: Record<string, string> = {
  "finance.account.update": "Dados da conta alterados",
  transferencia: "Transferência entre contas",
  "transferencia.estorno": "Transferência estornada",
};

type Aba = "movimentos" | "dados" | "transferir" | "auditoria";

export function ContaCockpit({ id }: { id: string }) {
  const caps = useCapabilities();
  const podeGerir = caps.includes("finance.bank.manage");
  const [aba, setAba] = React.useState<Aba>("movimentos");
  const contas = useQuery({ queryKey: ["fin-accounts"], queryFn: fetchFinAccounts });
  const dados = useQuery({ queryKey: ["fin-account-dados", id], queryFn: () => fetchDadosConta(id) });
  const conta = contas.data?.find((c) => c.id === id);

  if (contas.isLoading || dados.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!conta || !dados.data?.["id"])
    return (
      <Panel>
        <EmptyState title="Conta não encontrada" description="Volte para Contas e caixas e escolha outra conta." />
      </Panel>
    );

  const d = dados.data;
  const abas: { k: Aba; label: string }[] = [
    { k: "movimentos", label: "Movimentações" },
    { k: "dados", label: "Dados da conta" },
    ...(podeGerir && (contas.data?.length ?? 0) > 1
      ? [{ k: "transferir" as Aba, label: "Transferir entre contas" }]
      : []),
    { k: "auditoria", label: "Auditoria" },
  ];

  return (
    <div className="space-y-6">
      <Link to="/admin/financeiro/contas" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ledger-muted hover:text-ledger-text">
        <ArrowLeft aria-hidden className="size-4" /> Contas e caixas
      </Link>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="ledger-eyebrow">{TIPO_CONTA[conta.kind] ?? conta.kind}</p>
            <h1 className="font-display text-2xl font-bold text-ledger-text">{conta.nome}</h1>
            <p className="mt-1 text-sm text-ledger-muted">
              {[
                d["banco"] ? `${d["banco_codigo"] ? `${d["banco_codigo"]} · ` : ""}${d["banco"]}` : null,
                d["agencia_masked"] ? `Ag. ${d["agencia_masked"]}` : null,
                d["conta_masked"] ? `C/C ${d["conta_masked"]}${d["conta_digito"] ? `-${d["conta_digito"]}` : ""}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Dados bancários não informados"}
            </p>
          </div>
          <div className="text-right">
            <StatusBadge tone={conta.is_active ? "success" : "neutral"}>
              {conta.is_active ? "Ativa" : "Inativa"}
            </StatusBadge>
            <p className="mt-2 text-xs font-semibold tracking-wide text-ledger-muted uppercase">Saldo atual</p>
            <p className={`font-display text-3xl font-bold tabular-nums ${conta.saldo_cents < 0 ? "text-danger" : "text-ledger-text"}`}>
              {formatBRLFromCents(conta.saldo_cents)}
            </p>
          </div>
        </div>
      </Panel>

      <nav aria-label="Seções da conta" className="flex flex-wrap gap-1.5">
        {abas.map((a) => (
          <button
            key={a.k}
            type="button"
            onClick={() => setAba(a.k)}
            aria-current={aba === a.k ? "page" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold ${
              aba === a.k
                ? "border-champagne bg-surface text-ledger-text shadow-sm"
                : "border-line-soft bg-cream-2 text-ledger-muted hover:text-ledger-text"
            }`}
          >
            {a.label}
          </button>
        ))}
      </nav>

      {aba === "movimentos" && <Movimentos id={id} />}
      {aba === "dados" && <Dados id={id} dados={d} podeGerir={podeGerir} />}
      {aba === "transferir" && <Transferir id={id} />}
      {aba === "auditoria" && <Auditoria id={id} />}
    </div>
  );
}

function Movimentos({ id }: { id: string }) {
  const hoje = new Date();
  const [periodo, setPeriodo] = React.useState<DateRange | undefined>({
    from: new Date(hoje.getFullYear(), hoje.getMonth(), 1),
    to: new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0),
  });
  const [busca, setBusca] = React.useState("");
  const [q, setQ] = React.useState("");
  const [pagina, setPagina] = React.useState(0);
  React.useEffect(() => {
    const t = setTimeout(() => setQ(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);
  React.useEffect(() => setPagina(0), [periodo, q]);

  const de = periodo?.from ? iso(periodo.from) : iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const ate = periodo?.to ? iso(periodo.to) : periodo?.from ? iso(periodo.from) : iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0));
  const PAG = 50;
  const cockpit = useQuery({
    queryKey: ["fin-account-cockpit", id, de, ate, q, pagina],
    queryFn: () => fetchCockpitConta({ id, de, ate, ...(q ? { q } : {}), limit: PAG, offset: pagina * PAG }),
  });
  const c = cockpit.data;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,320px)_1fr]">
          <DateRangeField
            value={periodo}
            onChange={(r) => setPeriodo(r?.from ? r : undefined)}
            placeholder="Mês atual"
          />
          <label className="relative">
            <Search aria-hidden className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ledger-muted" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por descrição, pessoa, título ou conta"
              className={`${inputCls} pl-9`}
            />
          </label>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Saldo no início" v={c?.saldo_anterior_cents} />
        <Kpi label="Entrou" v={c?.entradas_cents} tom="success" />
        <Kpi label="Saiu" v={c?.saidas_cents} tom="danger" />
        <Kpi label="Transferências" v={c ? c.transf_entrada_cents - c.transf_saida_cents : undefined} hint={c ? `+${formatBRLFromCents(c.transf_entrada_cents)} / −${formatBRLFromCents(c.transf_saida_cents)}` : undefined} />
        <Kpi label="Saldo no fim" v={c?.saldo_final_cents} forte />
      </div>

      <Panel title={`Movimentações${c ? ` · ${c.total}` : ""}`}>
        {cockpit.isLoading && <Skeleton className="h-40 w-full" />}
        {cockpit.error && <ErrorState message={(cockpit.error as Error).message} />}
        {c && c.linhas.length === 0 && (
          <EmptyState title="Sem movimentações" description="Nenhuma entrada, saída ou transferência neste período." />
        )}
        {c && c.linhas.length > 0 && (
          <ul className="divide-y divide-line-soft">
            {c.linhas.map((m) => {
              const entra = m.valor_cents >= 0;
              const transf = m.kind.startsWith("transferencia");
              return (
                <li key={m.id} className="flex items-start gap-3 py-3">
                  <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${transf ? "bg-info/10 text-info" : entra ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                    {transf ? <ArrowLeftRight className="size-4" aria-hidden /> : entra ? <ArrowDownLeft className="size-4" aria-hidden /> : <ArrowUpRight className="size-4" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ledger-text">
                      {m.contraparte_conta ?? (m.titulos?.[0]?.descricao || m.descricao || TIPO_MOV[m.kind] || "Movimentação")}
                    </p>
                    <p className="truncate text-xs text-ledger-muted">
                      {[
                        TIPO_MOV[m.kind] ?? m.kind,
                        m.pessoas ? (entra ? `pago por ${m.pessoas}` : `pago a ${m.pessoas}`) : null,
                        m.titulos && m.titulos.length > 1 ? `${m.titulos.length} títulos` : m.titulos?.[0]?.numero ? `título ${m.titulos[0].numero}` : null,
                        m.autor ? `por ${m.autor}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold tabular-nums ${entra ? "text-success" : "text-danger"}`}>
                      {entra ? "+ " : "− "}
                      {formatBRLFromCents(Math.abs(m.valor_cents))}
                    </p>
                    <p className="text-xs tabular-nums text-ledger-muted">{dataBR(m.data)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {c && c.total > PAG && (
          <div className="mt-4 flex items-center justify-between text-sm text-ledger-muted">
            <span>
              {pagina * PAG + 1}–{Math.min((pagina + 1) * PAG, c.total)} de {c.total}
            </span>
            <span className="flex gap-2">
              <button type="button" className="admin-btn" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
              <button type="button" className="admin-btn" disabled={(pagina + 1) * PAG >= c.total} onClick={() => setPagina((p) => p + 1)}>Próxima</button>
            </span>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Kpi({ label, v, tom, hint, forte }: { label: string; v: number | undefined; tom?: "success" | "danger"; hint?: string | undefined; forte?: boolean }) {
  return (
    <div className={`rounded-[14px] border p-4 ${forte ? "border-champagne bg-surface" : "border-line-soft bg-cream-2"}`}>
      <p className="text-xs font-semibold tracking-wide text-ledger-muted uppercase">{label}</p>
      <p className={`mt-1 font-display text-xl font-bold tabular-nums ${tom === "success" ? "text-success" : tom === "danger" ? "text-danger" : "text-ledger-text"}`}>
        {v === undefined ? "—" : formatBRLFromCents(v)}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ledger-muted tabular-nums">{hint}</p>}
    </div>
  );
}

function Dados({ id, dados, podeGerir }: { id: string; dados: Record<string, string | boolean | null>; podeGerir: boolean }) {
  const qc = useQueryClient();
  const [editando, setEditando] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>({});
  const abrir = () => {
    setForm(Object.fromEntries(CAMPOS.map((c) => [c.k, String(dados[c.k] ?? "")])));
    setEditando(true);
  };
  const salvar = useMutation({
    mutationFn: (extra?: Record<string, unknown>) => atualizarConta(id, extra ?? form),
    onSuccess: () => {
      toast.success("Dados da conta salvos e registrados na auditoria.");
      setEditando(false);
      void qc.invalidateQueries({ queryKey: ["fin-account-dados", id] });
      void qc.invalidateQueries({ queryKey: ["fin-accounts"] });
      void qc.invalidateQueries({ queryKey: ["fin-account-auditoria", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Panel
      title="Dados da conta"
      action={
        podeGerir && !editando ? (
          <button type="button" className="admin-btn" onClick={abrir}>
            <Pencil aria-hidden className="size-4" /> Editar
          </button>
        ) : undefined
      }
    >
      {editando ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CAMPOS.map((c) => (
              <label key={c.k} className={`space-y-1 ${c.wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>
                <span className="text-xs font-semibold text-ledger-muted">{c.label}</span>
                <input value={form[c.k] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [c.k]: e.target.value }))} className={inputCls} />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="admin-btn-primary" disabled={salvar.isPending} onClick={() => salvar.mutate(undefined)}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="admin-btn" onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAMPOS.map((c) => (
              <div key={c.k} className={c.wide ? "sm:col-span-2 lg:col-span-3" : ""}>
                <dt className="text-xs font-semibold tracking-wide text-ledger-muted uppercase">{c.label}</dt>
                <dd className="mt-0.5 font-medium break-words text-ledger-text">{String(dados[c.k] ?? "") || "—"}</dd>
              </div>
            ))}
          </dl>
          {podeGerir && (
            <button
              type="button"
              className="admin-btn mt-5"
              disabled={salvar.isPending}
              onClick={() => salvar.mutate({ is_active: !dados["is_active"] })}
            >
              {dados["is_active"] ? "Desativar conta" : "Reativar conta"}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

function Transferir({ id }: { id: string }) {
  const qc = useQueryClient();
  const contas = useQuery({ queryKey: ["fin-accounts"], queryFn: fetchFinAccounts });
  const [sentido, setSentido] = React.useState<"enviar" | "receber">("enviar");
  const [outra, setOutra] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [chave, setChave] = React.useState(() => crypto.randomUUID());
  const opcoes = (contas.data ?? [])
    .filter((c) => c.id !== id && c.is_active)
    .map((c) => ({ value: c.id, label: c.nome, hint: formatBRLFromCents(c.saldo_cents) }));

  const transferir = useMutation({
    mutationFn: async () => {
      if (!outra) throw new Error("Escolha a outra conta.");
      const cents = reaisParaCentavos(valor);
      if (!cents || cents <= 0) throw new Error("Informe um valor maior que zero.");
      return transferirEntreContas({
        from_account_id: sentido === "enviar" ? id : outra,
        to_account_id: sentido === "enviar" ? outra : id,
        valor_cents: cents,
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
        idempotency_key: chave,
      });
    },
    onSuccess: () => {
      toast.success("Transferência registrada nas duas contas.");
      setValor("");
      setMotivo("");
      setChave(crypto.randomUUID());
      void qc.invalidateQueries({ queryKey: ["fin-accounts"] });
      void qc.invalidateQueries({ queryKey: ["fin-account-cockpit"] });
      void qc.invalidateQueries({ queryKey: ["fin-account-auditoria"] });
      void qc.invalidateQueries({ queryKey: ["fin-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Panel title="Transferir entre contas">
      <div className="mb-4 inline-flex rounded-full border border-line-soft bg-cream-2 p-1">
        {(["enviar", "receber"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSentido(s)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${sentido === s ? "bg-surface text-ledger-text shadow-sm" : "text-ledger-muted"}`}
          >
            {s === "enviar" ? "Enviar desta conta" : "Trazer para esta conta"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SmartSelect options={opcoes} value={outra} onChange={setOutra} placeholder={sentido === "enviar" ? "Para qual conta" : "De qual conta"} />
        <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="Valor 0,00" className={inputCls} />
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" className={`${inputCls} sm:col-span-2`} />
      </div>
      <button type="button" className="admin-btn-primary mt-4" disabled={transferir.isPending} onClick={() => transferir.mutate()}>
        {transferir.isPending ? "Gravando…" : "Transferir"}
      </button>
    </Panel>
  );
}

function Auditoria({ id }: { id: string }) {
  const aud = useQuery({ queryKey: ["fin-account-auditoria", id], queryFn: () => fetchAuditoriaConta(id) });
  return (
    <Panel title="Auditoria">
      {aud.isLoading && <Skeleton className="h-32 w-full" />}
      {aud.error && <ErrorState message={(aud.error as Error).message} />}
      {aud.data && aud.data.length === 0 && (
        <EmptyState title="Sem registros" description="Nenhuma alteração ou transferência registrada nesta conta ainda." />
      )}
      {aud.data && aud.data.length > 0 && (
        <ul className="divide-y divide-line-soft">
          {aud.data.map((a, i) => (
            <li key={i} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-ledger-text">{ACAO[a.acao] ?? a.acao}</p>
                <p className="text-xs tabular-nums text-ledger-muted">
                  {dataHoraBR(a.quando)}
                  {a.autor ? ` · ${a.autor}` : ""}
                </p>
              </div>
              <DetalheAuditoria acao={a.acao} d={a.detalhe} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DetalheAuditoria({ acao, d }: { acao: string; d: Record<string, unknown> | null }) {
  if (!d) return null;
  if (acao.startsWith("transferencia"))
    return (
      <p className="mt-0.5 text-sm text-ledger-muted">
        {String(d["de"] ?? "")} → {String(d["para"] ?? "")} · {formatBRLFromCents(Number(d["valor_cents"] ?? 0))}
        {d["motivo"] ? ` · ${String(d["motivo"])}` : ""}
      </p>
    );
  const alt = d["alteracoes"] as Record<string, { de: unknown; para: unknown }> | undefined;
  if (!alt) return null;
  const rot = Object.fromEntries(CAMPOS.map((c) => [c.k, c.label]));
  return (
    <ul className="mt-1 space-y-0.5 text-sm text-ledger-muted">
      {Object.entries(alt).map(([k, v]) => (
        <li key={k}>
          <span className="font-semibold">{rot[k] ?? (k === "is_active" ? "Situação" : k)}:</span>{" "}
          {String(v.de ?? "—")} → {String(v.para ?? "—")}
        </li>
      ))}
    </ul>
  );
}

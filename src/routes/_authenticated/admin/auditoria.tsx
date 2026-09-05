import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasAny } from "@/lib/session";
import { useAdminRoles } from "@/components/admin/AdminShell";
import type { DateRange } from "react-day-picker";
import { endOfDay, startOfDay } from "date-fns";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateRangeField } from "@/components/premium/DateRangeField";
import {
  PageHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  formatDateTime,
} from "@/components/admin/ui";

export const Route = createFileRoute("/_authenticated/admin/auditoria")({
  component: AuditoriaPage,
  head: () => ({
    meta: [
      { title: "Auditoria — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const ENTIDADES = [
  "user_roles", "profiles", "products", "product_variants", "categories",
  "collections", "pages", "site_settings", "media_assets", "leads",
  "contact_requests",
];

function AuditoriaPage() {
  const roles = useAdminRoles();
  const permitido = hasAny(roles, ["master", "diretoria"]);
  const [entidade, setEntidade] = useState<string>("todas");
  const [acao, setAcao] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<DateRange | undefined>();

  const logsQuery = useQuery({
    queryKey: [
      "admin-audit",
      entidade,
      acao,
      periodo?.from?.toISOString() ?? null,
      periodo?.to?.toISOString() ?? null,
    ],
    enabled: permitido,
    queryFn: async () => {
      let q = supabase
        .from("audit_logs")
        .select("id, actor_id, action, entity, entity_id, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (entidade !== "todas") q = q.eq("entity", entidade);
      if (acao !== "todas") q = q.eq("action", acao);
      if (periodo?.from) q = q.gte("created_at", startOfDay(periodo.from).toISOString());
      if (periodo?.to) q = q.lte("created_at", endOfDay(periodo.to).toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!permitido) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="TRILHA IMUTÁVEL" title="Auditoria" />
        <div className="ledger-panel">
          <EmptyState
            title="Acesso restrito"
            description="Consulta exclusiva dos perfis Master e Diretoria."
          />
        </div>
      </div>
    );
  }

  const rows = (logsQuery.data ?? []).filter((l) => {
    if (!busca.trim()) return true;
    const b = busca.trim().toLowerCase();
    return [l.action, l.entity, l.entity_id, l.actor_id]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(b));
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="TRILHA IMUTÁVEL"
        title="Auditoria"
        description="Registro imutável: ninguém edita nem apaga estes eventos."
      />

      <div className="ledger-panel flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5">
          <div className="w-52">
            <SmartSelect
              value={entidade}
              onChange={setEntidade}
              placeholder="Entidade"
              searchPlaceholder="Buscar entidade..."
              options={[
                { value: "todas", label: "Todas as entidades" },
                ...ENTIDADES.map((e) => ({ value: e, label: e })),
              ]}
            />
          </div>
          <div className="w-52">
            <SmartSelect
              value={acao}
              onChange={setAcao}
              placeholder="Ação"
              searchPlaceholder="Buscar ação..."
              options={[
                { value: "todas", label: "Todas as ações" },
                ...["insert", "update", "delete", "roles.grant", "roles.revoke", "bootstrap.claim_master"].map(
                  (a) => ({ value: a, label: a }),
                ),
              ]}
            />
          </div>
          <div className="w-64">
            <DateRangeField value={periodo} onChange={setPeriodo} placeholder="Período (dia/mês/ano)" />
          </div>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por texto…"
            className="h-11 w-56 rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25"
          />
        </div>

        {logsQuery.isError ? (
          <ErrorState
            message="Não foi possível carregar a trilha de auditoria."
            onRetry={() => void logsQuery.refetch()}
          />
        ) : logsQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nenhum registro encontrado"
            description="Nenhum evento corresponde aos filtros atuais."
          />
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted/60">
                  <th className="px-4 py-3 text-left text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-bronze">
                    Quando
                  </th>
                  <th className="px-4 py-3 text-left text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-bronze">
                    Ação
                  </th>
                  <th className="px-4 py-3 text-left text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-bronze">
                    Entidade
                  </th>
                  <th className="px-4 py-3 text-left text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-bronze">
                    Registro
                  </th>
                  <th className="px-4 py-3 text-left text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-bronze">
                    Autor
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="border-b border-line-soft last:border-0">
                    <td className="num whitespace-nowrap px-4 py-3.5 font-medium text-ledger-muted">
                      {formatDateTime(l.created_at)}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge tone="neutral">{l.action}</StatusBadge>
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-ledger-text">{l.entity}</td>
                    <td className="max-w-44 truncate px-4 py-3.5 font-mono text-xs text-ledger-muted">
                      {l.entity_id ?? "—"}
                    </td>
                    <td className="max-w-44 truncate px-4 py-3.5 font-mono text-xs text-ledger-muted">
                      {l.actor_id ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

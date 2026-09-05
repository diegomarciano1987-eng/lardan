import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hasAny } from "@/lib/session";
import { useAdminRoles } from "@/components/admin/AdminShell";
import type { DateRange } from "react-day-picker";
import { endOfDay, startOfDay } from "date-fns";
import { Input } from "@/components/ui/input";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateRangeField } from "@/components/premium/DateRangeField";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
      <div className="max-w-xl">
        <h1 className="text-3xl text-foreground">Auditoria</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Consulta exclusiva dos perfis Master e Diretoria.
        </p>
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
    <div className="max-w-5xl">
      <h1 className="text-3xl text-foreground">Auditoria</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Registro imutável: ninguém edita nem apaga estes eventos.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
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
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por texto…"
          className="h-11 w-56 rounded-[10px]"
        />
      </div>

      {logsQuery.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Nenhum registro encontrado.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando (UTC)</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Entidade</TableHead>
                <TableHead>Registro</TableHead>
                <TableHead>Autor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(l.created_at).toISOString().replace("T", " ").slice(0, 19)}
                  </TableCell>
                  <TableCell className="text-xs text-foreground">{l.action}</TableCell>
                  <TableCell className="text-xs text-foreground">{l.entity}</TableCell>
                  <TableCell className="max-w-40 truncate font-mono text-[0.625rem] text-muted-foreground">
                    {l.entity_id ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-40 truncate font-mono text-[0.625rem] text-muted-foreground">
                    {l.actor_id ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

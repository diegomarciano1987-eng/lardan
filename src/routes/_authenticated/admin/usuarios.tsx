import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL, useAdminRoles } from "@/components/admin/AdminShell";
import type { AppRole } from "@/lib/session";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  component: UsuariosPage,
  head: () => ({
    meta: [
      { title: "Usuários e papéis — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const ALL_ROLES = Object.keys(ROLE_LABEL) as AppRole[];

interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  roles: AppRole[];
}

function UsuariosPage() {
  const queryClient = useQueryClient();
  const myRoles = useAdminRoles();
  const souMaster = myRoles.includes("master");

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    enabled: souMaster,
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles, error: e1 }, { data: rolesRows, error: e2 }] =
        await Promise.all([
          supabase.from("profiles").select("id, full_name, email, is_active"),
          supabase.from("user_roles").select("user_id, role"),
        ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const byUser = new Map<string, AppRole[]>();
      for (const r of rolesRows ?? []) {
        const list = byUser.get(r.user_id) ?? [];
        list.push(r.role as AppRole);
        byUser.set(r.user_id, list);
      }
      return (profiles ?? [])
        .map((p) => ({ ...p, roles: byUser.get(p.id) ?? [] }))
        .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
    },
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
      queryClient.invalidateQueries({ queryKey: ["my-roles"] }),
    ]);

  const grant = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.rpc("grant_role", { _user_id: userId, _role: role });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Papel concedido.");
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.rpc("revoke_role", { _user_id: userId, _role: role });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Papel revogado.");
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: active })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Situação da conta atualizada.");
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!souMaster) {
    return (
      <div className="max-w-xl">
        <h1 className="text-3xl text-foreground">Usuários e papéis</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Este módulo é exclusivo do perfil Master.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl text-foreground">Usuários e papéis</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Papéis vivem em tabela separada e toda alteração passa por operação
        autorizada com auditoria. O último Master ativo não pode ser removido.
      </p>

      {usersQuery.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Carregando…</p>
      ) : (usersQuery.data?.length ?? 0) === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Nenhum usuário cadastrado.</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Papéis</TableHead>
                <TableHead>Adicionar papel</TableHead>
                <TableHead className="text-right">Ativa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.data!.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="text-sm text-foreground">{u.full_name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell>
                    <ul className="flex flex-wrap gap-1.5">
                      {u.roles.length === 0 && (
                        <li className="text-xs text-muted-foreground">sem papel</li>
                      )}
                      {u.roles.map((r) => (
                        <li key={r}>
                          <button
                            type="button"
                            title={`Revogar ${ROLE_LABEL[r]}`}
                            onClick={() => revoke.mutate({ userId: u.id, role: r })}
                            className="rounded-full border border-border px-2.5 py-0.5 text-[0.625rem] text-foreground transition-colors hover:border-destructive hover:text-destructive"
                          >
                            {ROLE_LABEL[r]} ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>
                    <Select
                      onValueChange={(v) =>
                        grant.mutate({ userId: u.id, role: v as AppRole })
                      }
                    >
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue placeholder="Conceder…" />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_ROLES.filter((r) => !u.roles.includes(r)).map((r) => (
                          <SelectItem key={r} value={r} className="text-xs">
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={u.is_active}
                      onCheckedChange={(active) =>
                        toggleActive.mutate({ userId: u.id, active })
                      }
                      aria-label="Conta ativa"
                    />
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

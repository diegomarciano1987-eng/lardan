import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BackButton } from "@/components/admin/ui";
import { ROLE_LABEL, useAdminRoles } from "@/components/admin/AdminShell";
import type { AppRole } from "@/lib/session";
import type { Capability } from "@/lib/capabilities";
import { ADMIN_MODULES, moduleAllowed } from "@/lib/admin-modules";
import { substituirPapeis } from "@/lib/acessos.functions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ConvitesPanel } from "@/components/admin/acessos/Convites";
import { PainelSegundoFator } from "@/components/admin/acessos/Autenticador";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  component: UsuariosPage,
  head: () => ({
    meta: [
      { title: "Usuários e convites — Administração LARDAN" },
      { name: "description", content: "Gestão protegida de colaboradores, convites e áreas de acesso do Sistema Lardan." },
      { property: "og:title", content: "Usuários e convites — Administração LARDAN" },
      { property: "og:description", content: "Gestão protegida de colaboradores, convites e áreas de acesso do Sistema Lardan." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  const salvarPapeis = useServerFn(substituirPapeis);
  const [editando, setEditando] = React.useState<UserRow | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    enabled: souMaster,
    queryFn: async (): Promise<UserRow[]> => {
      const [
        { data: profiles, error: e1 },
        { data: rolesRows, error: e2 },
      ] =
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
        .filter((p) => !p.email?.toLowerCase().endsWith("@lardan.test") && !p.full_name?.toUpperCase().startsWith("HOMOLOG"))
        .map((p) => ({ ...p, roles: byUser.get(p.id) ?? [] }))
        .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
    },
  });

  const roleCapabilities = useQuery({
    queryKey: ["role-capabilities-admin"],
    enabled: souMaster,
    queryFn: async () => {
      const { data, error } = await supabase.from("role_capabilities").select("role, capability");
      if (error) throw error;
      const map = new Map<AppRole, Capability[]>();
      for (const row of data ?? []) {
        const role = row.role as AppRole;
        map.set(role, [...(map.get(role) ?? []), row.capability as Capability]);
      }
      return map;
    },
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
      queryClient.invalidateQueries({ queryKey: ["my-roles"] }),
    ]);

  const saveRoles = useMutation({
    mutationFn: async ({ userId, roles }: { userId: string; roles: AppRole[] }) =>
      salvarPapeis({ data: { user_id: userId, roles } }),
    onSuccess: async () => {
      toast.success("Acessos atualizados.");
      setEditando(null);
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

  const concedeveis = useQuery({
    queryKey: ["papeis-concedeveis"],
    enabled: !souMaster,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const r = await Promise.all(ALL_ROLES.map(async (role) => {
        const { data } = await supabase.rpc("access_pode_conceder" as never, { _uid: u.user?.id, _role: role } as never);
        return data ? role : null;
      }));
      return r.filter(Boolean) as AppRole[];
    },
  });

  function areasDe(roles: AppRole[]) {
    const caps = [...new Set(roles.flatMap((role) => roleCapabilities.data?.get(role) ?? []))];
    return ADMIN_MODULES.filter((mod) => mod.path && moduleAllowed(mod, caps, roles)).map((mod) => mod.label);
  }

  if (!souMaster) {
    return (
      <div className="max-w-5xl">
        <div className="flex items-center gap-4"><BackButton /><h1 className="text-3xl text-foreground">Usuários e convites</h1></div>
        {concedeveis.isLoading ? null : (concedeveis.data?.length ?? 0) === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Você não tem autorização do Master para convidar.</p>
        ) : (
          <ConvitesPanel podeConceder={concedeveis.data ?? []} />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-4"><BackButton /><h1 className="text-3xl text-foreground">Usuários e convites</h1></div>
      <p className="mt-2 text-sm text-muted-foreground">Edite uma pessoa para escolher uma ou várias áreas. Toda mudança fica registrada.</p>

      <ConvitesPanel podeConceder={ALL_ROLES} />
      <PainelSegundoFator />
      <h2 className="mt-10 text-xl text-foreground">Usuários com acesso</h2>
      {usersQuery.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Carregando…</p>
      ) : (usersQuery.data?.length ?? 0) === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Nenhum usuário cadastrado.</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Áreas liberadas</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.data?.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="text-sm text-foreground">{u.full_name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-xl">
                    <ul className="flex flex-wrap gap-1.5">
                      {u.roles.length === 0 && (
                        <li className="text-xs text-muted-foreground">Nenhuma área liberada</li>
                      )}
                      {areasDe(u.roles).map((area) => (
                        <li key={area} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground">
                          {area}
                        </li>
                      ))}
                    </ul>
                    {u.roles.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Perfis: {u.roles.map((r) => ROLE_LABEL[r]).join(", ")}</p>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={u.is_active} onCheckedChange={(active) => toggleActive.mutate({ userId: u.id, active })} aria-label={`Conta de ${u.full_name || u.email} ativa`} />
                      <span className="text-xs text-muted-foreground">{u.is_active ? "Ativa" : "Inativa"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button type="button" size="sm" variant="outline" disabled={!u.is_active} onClick={() => setEditando(u)}>
                      <Pencil aria-hidden /> Editar acessos
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <EditarAcessos
        usuario={editando}
        onOpenChange={(open) => { if (!open) setEditando(null); }}
        onSalvar={(roles) => {
          if (editando) saveRoles.mutate({ userId: editando.id, roles });
        }}
        salvando={saveRoles.isPending}
        areasDe={areasDe}
      />
    </div>
  );
}

function EditarAcessos({ usuario, onOpenChange, onSalvar, salvando, areasDe }: {
  usuario: UserRow | null;
  onOpenChange: (open: boolean) => void;
  onSalvar: (roles: AppRole[]) => void;
  salvando: boolean;
  areasDe: (roles: AppRole[]) => string[];
}) {
  const [selecionados, setSelecionados] = React.useState<AppRole[]>([]);

  React.useEffect(() => {
    setSelecionados(usuario?.roles ?? []);
  }, [usuario]);

  const alternar = (role: AppRole) => setSelecionados((atuais) =>
    atuais.includes(role) ? atuais.filter((item) => item !== role) : [...atuais, role],
  );
  const areas = areasDe(selecionados);

  return (
    <Dialog open={Boolean(usuario)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar acessos</DialogTitle>
          <DialogDescription>{usuario?.full_name || usuario?.email}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {ALL_ROLES.map((role) => {
            const marcado = selecionados.includes(role);
            const areasDoPapel = areasDe([role]);
            return (
              <label key={role} className="flex cursor-pointer gap-3 rounded-md border border-border bg-card p-4 hover:bg-muted/40">
                <Checkbox checked={marcado} onCheckedChange={() => alternar(role)} aria-label={ROLE_LABEL[role]} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{ROLE_LABEL[role]}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {areasDoPapel.length ? areasDoPapel.join(" · ") : "Acesso específico fora da operação"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="rounded-md border border-primary/25 bg-primary/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldCheck aria-hidden className="size-4 text-primary" />Resultado do acesso</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {areas.length ? areas.join(" · ") : "Esta pessoa ficará sem acesso às áreas do sistema."}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" disabled={salvando} onClick={() => onSalvar(selecionados)}>
            {salvando ? "Salvando…" : "Salvar acessos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

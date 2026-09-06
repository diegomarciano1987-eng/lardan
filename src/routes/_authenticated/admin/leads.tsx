import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BackButton } from "@/components/admin/ui";
import { hasAny, LEAD_ROLES } from "@/lib/session";
import { useAdminRoles } from "@/components/admin/AdminShell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { convertLeadToConsultant } from "@/lib/registry";
import { useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/leads")({
  component: LeadsPage,
  head: () => ({
    meta: [
      { title: "Candidaturas e contatos — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const LEAD_STATUS = [
  ["novo", "Nova"],
  ["em_analise", "Em análise"],
  ["qualificado", "Qualificada"],
  ["aprovado", "Aprovada"],
  ["recusado", "Recusada"],
  ["arquivado", "Arquivada"],
] as const;

const CONTACT_STATUS = [
  ["novo", "Nova"],
  ["em_atendimento", "Em atendimento"],
  ["respondido", "Respondida"],
  ["arquivado", "Arquivada"],
] as const;

function LeadsPage() {
  const queryClient = useQueryClient();
  const roles = useAdminRoles();
  const permitido = hasAny(roles, LEAD_ROLES);
  const navigate = useNavigate();

  /** Conversão candidata -> consultora: transacional e idempotente no banco. */
  const converter = useMutation({
    mutationFn: (leadId: string) => convertLeadToConsultant(leadId),
    onSuccess: async (partyId) => {
      await queryClient.invalidateQueries({ queryKey: ["registry"] });
      toast.success("Candidata vinculada à ficha de consultora.");
      if (partyId) await navigate({ to: "/admin/cadastros/pessoas/$id", params: { id: String(partyId) } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leadsQuery = useQuery({
    queryKey: ["admin-leads"],
    enabled: permitido,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, protocol, full_name, whatsapp, city, uf, status, marketing_consent, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const contactsQuery = useQuery({
    queryKey: ["admin-contacts"],
    enabled: permitido,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_requests")
        .select("id, protocol, full_name, contact_channel, contact_value, subject, status, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const leadStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("leads")
        .update({ status: status as (typeof LEAD_STATUS)[number][0] })
        .eq("id", id);
      if (error) throw error;
      await supabase.from("lead_events").insert({
        lead_id: id,
        event_type: "status",
        note: `Status alterado para ${status}`,
      });
    },
    onSuccess: async () => {
      toast.success("Status atualizado.");
      await queryClient.invalidateQueries({ queryKey: ["admin-leads"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const contactStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("contact_requests")
        .update({ status: status as (typeof CONTACT_STATUS)[number][0] })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Status atualizado.");
      await queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!permitido) {
    return (
      <div className="max-w-xl">
        <div className="flex items-center gap-4"><BackButton /><h1 className="text-3xl text-foreground">Candidaturas e contatos</h1></div>
        <p className="mt-4 text-sm text-muted-foreground">
          Sem perfil de acesso a este módulo.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-4"><BackButton /><h1 className="text-3xl text-foreground">Candidaturas e contatos</h1></div>
      <p className="mt-2 text-sm text-muted-foreground">
        Dados reais enviados pelo site, com protocolo e consentimento registrados.
      </p>

      <Tabs defaultValue="leads" className="mt-8">
        <TabsList>
          <TabsTrigger value="leads">Candidaturas</TabsTrigger>
          <TabsTrigger value="contatos">Mensagens de contato</TabsTrigger>
        </TabsList>

        <TabsContent value="leads">
          {leadsQuery.isLoading ? (
            <p className="mt-6 text-sm text-muted-foreground">Carregando…</p>
          ) : (leadsQuery.data?.length ?? 0) === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">Nenhuma candidatura até agora.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Protocolo</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>WhatsApp</TableHead>
                    <TableHead>Cidade/UF</TableHead>
                    <TableHead>Marketing</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Cadastro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leadsQuery.data!.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-[0.625rem] text-muted-foreground">
                        {l.protocol}
                      </TableCell>
                      <TableCell className="text-sm text-foreground">{l.full_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.whatsapp}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.city}/{l.uf}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.marketing_consent ? "Aceito" : "Não"}
                      </TableCell>
                      <TableCell>
                        <SmartSelect
                          className="w-40"
                          value={l.status}
                          onChange={(v) => leadStatus.mutate({ id: l.id, status: v })}
                          options={LEAD_STATUS.map(([v, label]) => ({ value: v, label }))}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="admin-btn"
                          disabled={converter.isPending}
                          onClick={() => converter.mutate(l.id)}
                        >
                          Converter em consultora
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="contatos">
          {contactsQuery.isLoading ? (
            <p className="mt-6 text-sm text-muted-foreground">Carregando…</p>
          ) : (contactsQuery.data?.length ?? 0) === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">Nenhuma mensagem até agora.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Protocolo</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Assunto</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contactsQuery.data!.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-[0.625rem] text-muted-foreground">
                        {c.protocol}
                      </TableCell>
                      <TableCell className="text-sm text-foreground">{c.full_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.contact_channel}: {c.contact_value}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.subject}</TableCell>
                      <TableCell>
                        <SmartSelect
                          className="w-40"
                          value={c.status}
                          onChange={(v) => contactStatus.mutate({ id: c.id, status: v })}
                          options={CONTACT_STATUS.map(([v, label]) => ({ value: v, label }))}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

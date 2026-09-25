import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL } from "@/components/admin/AdminShell";
import type { AppRole } from "@/lib/session";
import { criarConvite, reenviarConvite } from "@/lib/acessos.functions";

const PAGINA = 20;
const SITUACAO: Record<string, { rotulo: string; cls: string }> = {
  pendente: { rotulo: "Pendente", cls: "bg-muted text-foreground" },
  aceito: { rotulo: "Aceito", cls: "bg-primary/15 text-foreground" },
  expirado: { rotulo: "Expirado", cls: "bg-muted text-muted-foreground" },
  revogado: { rotulo: "Revogado", cls: "bg-muted text-muted-foreground line-through" },
  falha_envio: { rotulo: "Falha de envio", cls: "bg-destructive/10 text-destructive" },
};

interface Convite {
  id: string; email: string; roles: AppRole[]; status: string; expires_at: string; envios: number;
  ultimo_erro: string | null; created_at: string; parties: { display_name: string } | null;
}

function whats(link: string, nome: string) {
  const txt = `Olá${nome ? `, ${nome.split(" ")[0]}` : ""}! Seu convite de acesso à Lardan: ${link}\nUse o mesmo e-mail do convite; você vai confirmar pelo e-mail.`;
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank", "noopener");
}

export function ConvitesPanel({ podeConceder }: { podeConceder: AppRole[] }) {
  const qc = useQueryClient();
  const criar = useServerFn(criarConvite);
  const reenviar = useServerFn(reenviarConvite);
  const [busca, setBusca] = React.useState("");
  const [filtro, setFiltro] = React.useState("todos");
  const [pagina, setPagina] = React.useState(0);
  const [novo, setNovo] = React.useState(false);

  const lista = useQuery({
    queryKey: ["convites", busca, filtro, pagina],
    queryFn: async () => {
      let q = supabase.from("access_invites" as never)
        .select("id,email,roles,status,expires_at,envios,ultimo_erro,created_at,parties(display_name)", { count: "exact" })
        .order("created_at", { ascending: false }).range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
      const agora = new Date().toISOString();
      if (filtro === "expirado") q = q.in("status", ["pendente", "falha_envio"]).lt("expires_at", agora);
      else if (filtro === "pendente") q = q.eq("status", "pendente").gte("expires_at", agora);
      else if (filtro !== "todos") q = q.eq("status", filtro);
      if (busca.trim()) q = q.ilike("email", `%${busca.trim()}%`);
      const { data, error, count } = await q;
      if (error) throw error;
      return { itens: (data ?? []) as unknown as Convite[], total: count ?? 0 };
    },
  });

  const situ = (c: Convite) =>
    (c.status === "pendente" || c.status === "falha_envio") && new Date(c.expires_at) < new Date() ? "expirado" : c.status;

  async function acaoReenviar(c: Convite) {
    try {
      const r = await reenviar({ data: { id: c.id, origem: window.location.origin } });
      if (r.enviado) toast.success("Novo convite enviado por e-mail. O link anterior deixou de valer.");
      else toast.error(`E-mail não enviado: ${r.erro}. Você pode compartilhar pelo WhatsApp.`);
      if (confirm("Abrir o WhatsApp com o novo link?")) whats(r.link, c.parties?.display_name ?? "");
      void qc.invalidateQueries({ queryKey: ["convites"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha"); }
  }
  async function acaoRevogar(c: Convite) {
    if (!confirm(`Revogar o convite de ${c.email}?`)) return;
    const { error } = await supabase.rpc("access_invite_revoke" as never, { _id: c.id } as never);
    if (error) toast.error(error.message); else { toast.success("Convite revogado."); void qc.invalidateQueries({ queryKey: ["convites"] }); }
  }

  const total = lista.data?.total ?? 0;
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl text-foreground">Convites</h2>
        {podeConceder.length > 0 && (
          <button onClick={() => setNovo((v) => !v)} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">
            {novo ? "Fechar" : "Convidar pessoa"}
          </button>
        )}
      </div>
      {novo && (
        <NovoConvite podeConceder={podeConceder} onFeito={(link, nome, enviado, erro) => {
          setNovo(false);
          if (enviado) toast.success("Convite enviado por e-mail.");
          else toast.error(`Convite criado, mas o e-mail NÃO foi enviado: ${erro}`);
          if (confirm("Compartilhar o link também pelo WhatsApp?")) whats(link, nome);
          void qc.invalidateQueries({ queryKey: ["convites"] });
        }} criar={criar} />
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <input value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} placeholder="Buscar por e-mail"
          className="min-w-[220px] flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm" />
        <div className="flex flex-wrap gap-1">
          {["todos", "pendente", "aceito", "expirado", "revogado", "falha_envio"].map((f) => (
            <button key={f} onClick={() => { setFiltro(f); setPagina(0); }}
              className={`rounded-full px-3 py-1.5 text-xs ${filtro === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {f === "todos" ? "Todos" : SITUACAO[f]?.rotulo}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 divide-y divide-border">
        {lista.isLoading && <p className="py-4 text-sm text-muted-foreground">Carregando…</p>}
        {lista.data?.itens.length === 0 && <p className="py-4 text-sm text-muted-foreground">Sem convites.</p>}
        {lista.data?.itens.map((c) => {
          const s = situ(c);
          const aberto = s === "pendente" || s === "falha_envio" || s === "expirado";
          return (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm text-foreground">{c.parties?.display_name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{c.email} · {c.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")} · {c.envios} envio(s)</p>
                {s === "falha_envio" && c.ultimo_erro && <p className="text-xs text-destructive">{c.ultimo_erro}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs ${SITUACAO[s]?.cls}`}>{SITUACAO[s]?.rotulo ?? s}</span>
                {aberto && c.status !== "revogado" && (
                  <>
                    <button onClick={() => void acaoReenviar(c)} className="rounded-full border border-border px-3 py-1 text-xs">Reenviar</button>
                    <button onClick={() => void acaoRevogar(c)} className="rounded-full border border-border px-3 py-1 text-xs text-destructive">Revogar</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {total > PAGINA && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} className="rounded-full border px-3 py-1 disabled:opacity-40">Anterior</button>
          <span className="text-muted-foreground">{pagina + 1} / {Math.ceil(total / PAGINA)}</span>
          <button disabled={(pagina + 1) * PAGINA >= total} onClick={() => setPagina((p) => p + 1)} className="rounded-full border px-3 py-1 disabled:opacity-40">Próxima</button>
        </div>
      )}
    </section>
  );
}

function NovoConvite({ podeConceder, onFeito, criar }: {
  podeConceder: AppRole[];
  onFeito: (link: string, nome: string, enviado: boolean, erro: string) => void;
  criar: ReturnType<typeof useServerFn<typeof criarConvite>>;
}) {
  const [termo, setTermo] = React.useState("");
  const [pessoa, setPessoa] = React.useState<{ id: string; display_name: string; email: string | null } | null>(null);
  const [email, setEmail] = React.useState("");
  const [papeis, setPapeis] = React.useState<AppRole[]>([]);
  const [conflito, setConflito] = React.useState("");
  const [ocupado, setOcupado] = React.useState(false);

  const busca = useQuery({
    queryKey: ["convite-pessoas", termo],
    enabled: termo.trim().length >= 3 && !pessoa,
    queryFn: async () => {
      const t = termo.trim();
      const { data, error } = await supabase.from("parties").select("id, display_name, contact_points(kind, value)")
        .ilike("display_name", `%${t}%`).limit(10);
      if (error) throw error;
      return ((data ?? []) as unknown as { id: string; display_name: string; contact_points: { kind: string; value: string }[] | null }[])
        .map((p) => ({ id: p.id, display_name: p.display_name, email: p.contact_points?.find((c) => c.kind === "email")?.value ?? null }));
    },
  });

  async function enviar() {
    if (!pessoa) return;
    setOcupado(true);
    setConflito("");
    try {
      const r = await criar({ data: { party_id: pessoa.id, email, roles: papeis, origem: window.location.origin } });
      if (!r.ok) setConflito(r.conflito);
      else onFeito(r.link, pessoa.display_name, r.enviado, r.erro);
    } catch (e) { setConflito(e instanceof Error ? e.message : "Falha"); }
    finally { setOcupado(false); }
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl bg-muted/50 p-4">
      {!pessoa ? (
        <>
          <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar cadastro pelo nome (mín. 3 letras)"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          <p className="text-xs text-muted-foreground">Pessoa nova? Cadastre primeiro em Cadastros e depois convide.</p>
          <div className="divide-y divide-border rounded-xl bg-background">
            {busca.data?.map((p) => (
              <button key={p.id} onClick={() => { setPessoa(p); setEmail(p.email ?? ""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted">
                {p.display_name} <span className="text-xs text-muted-foreground">{p.email ?? "sem e-mail"}</span>
              </button>
            ))}
            {busca.data?.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum cadastro encontrado.</p>}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-foreground">Pessoa: <strong>{pessoa.display_name}</strong>{" "}
            <button onClick={() => setPessoa(null)} className="text-xs text-muted-foreground underline">trocar</button></p>
          <label className="block text-sm"><span className="text-muted-foreground">Confira o e-mail</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          </label>
          <div className="flex flex-wrap gap-2">
            {podeConceder.map((r) => (
              <button key={r} type="button" onClick={() => setPapeis((p) => p.includes(r) ? p.filter((x) => x !== r) : [...p, r])}
                className={`rounded-full px-3 py-1.5 text-xs ${papeis.includes(r) ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground border border-border"}`}>
                {ROLE_LABEL[r] ?? r}
              </button>
            ))}
          </div>
          {conflito && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{conflito}</p>}
          <button disabled={ocupado || !email || papeis.length === 0} onClick={() => void enviar()}
            className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
            {ocupado ? "Enviando…" : "Enviar convite"}
          </button>
        </>
      )}
    </div>
  );
}

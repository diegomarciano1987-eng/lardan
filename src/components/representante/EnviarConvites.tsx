import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Search, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConviteConsultora } from "@/components/admin/acessos/ConviteConsultora";

type Item = { id: string; code: string; nome: string; status: string; cidade: string | null; whatsapp: string | null; conta_email: string | null; convite: string | null };
type Lista = { total: number; com_acesso: number; itens: Item[] };

const SITUACAO = (i: Item) =>
  i.conta_email ? { t: "Já tem acesso", c: "text-success" }
  : i.convite === "pendente" ? { t: "Convite enviado · aguardando senha", c: "text-bronze" }
  : i.convite === "falha_envio" ? { t: "E-mail não saiu · reenvie pelo WhatsApp", c: "text-destructive" }
  : i.convite === "expirado" ? { t: "Convite vencido · envie de novo", c: "text-destructive" }
  : { t: "Ainda sem acesso", c: "text-muted-foreground" };

/** Tela única para o representante convidar as consultoras da própria carteira. */
export function EnviarConvites({ rep }: { rep: string }) {
  const [texto, setTexto] = React.useState("");
  const [busca, setBusca] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setBusca(texto), 300); return () => clearTimeout(t); }, [texto]);
  const [aberta, setAberta] = React.useState<Item | null>(null);
  const q = useQuery({
    queryKey: ["rep", rep, "convites", busca],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rep_convites_lista" as never, { _rep: rep, _busca: busca || null } as never);
      if (error) throw error;
      return data as unknown as Lista;
    },
  });
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 md:p-6" data-testid="enviar-convites">
      <div>
        <h2 className="text-lg font-semibold">Enviar convite</h2>
        <p className="text-sm text-muted-foreground">Toque na consultora, confira o e-mail e mande o link pelo WhatsApp. Ela só cria a senha e já entra.</p>
        {q.data && <p className="mt-1 text-sm"><strong>{q.data.com_acesso}</strong> de <strong>{q.data.total}</strong> consultoras já têm acesso.</p>}
      </div>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nome ou código"
          className="admin-input w-full pl-9" aria-label="Buscar consultora" />
      </label>
      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data && q.data.itens.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma consultora encontrada na sua carteira.</p>}
      <ul className="divide-y divide-border">
        {q.data?.itens.map((i) => {
          const s = SITUACAO(i);
          return (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{i.nome} <span className="text-xs text-muted-foreground">{i.code}</span></p>
                <p className="text-xs text-muted-foreground">{[i.cidade, i.status !== "ativo" ? "inativa" : null].filter(Boolean).join(" · ")}</p>
                <p className={`text-xs font-medium ${s.c}`}>{s.t}</p>
              </div>
              {i.conta_email
                ? <span className="inline-flex items-center gap-1 text-sm text-success"><CheckCircle2 className="size-4" /> Ativo</span>
                : <button type="button" className="admin-btn admin-btn-primary min-h-11" onClick={() => setAberta(i)} data-testid="rep-enviar-convite">
                    {i.convite ? <KeyRound className="size-4" /> : <Send className="size-4" />} {i.convite ? "Reenviar convite" : "Enviar convite"}
                  </button>}
            </li>
          );
        })}
      </ul>
      <Dialog open={!!aberta} onOpenChange={(o) => { if (!o) { setAberta(null); void q.refetch(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Convite para {aberta?.nome}</DialogTitle>
            <DialogDescription>Gere o link e envie pelo WhatsApp. Cada consultora tem login próprio e só vê as maletas dela.</DialogDescription>
          </DialogHeader>
          {aberta && <ConviteConsultora partyId={aberta.id} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

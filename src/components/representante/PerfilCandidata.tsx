/**
 * 0284 — no app do representante: sonho da candidata, perfil DISC, rede (alta/média/baixa) e acompanhamento.
 * Nunca mostra risco de acerto, restrição ou as respostas de organização (regra do documento do Daniel).
 * Daqui ele manda o link do teste no WhatsApp ou faz o teste com ela no próprio celular.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ClipboardCheck, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TesteCandidatura } from "@/components/candidatura-teste/TesteCandidatura";
import { FATORES } from "@/lib/candidatura-teste/perguntas";
import { wa } from "@/components/representante/AcoesRepresentante";

type Perfil = {
  sonho: string | null; sonho_valor_cents: number | null; concluido_em: string | null; disc_perfil: string | null;
  disc_pct: Record<string, number> | null; rede: "alta" | "media" | "baixa" | null; acompanhamento: string | null;
  link_aberto: string | null; link_parte: number | null;
};
const REDE: Record<string, string> = { alta: "Rede alta", media: "Rede média", baixa: "Rede baixa" };
const url = (t: string) => `${window.location.origin}/candidatura/${t}`;

export function PerfilCandidata({ lead, nome, whatsapp }: { lead: string; nome: string; whatsapp: string | null }) {
  const [aberto, setAberto] = React.useState(false);
  const [testeAqui, setTesteAqui] = React.useState(false);
  const qc = useQueryClient();
  const chave = ["rep", "candidata-perfil", lead];
  const q = useQuery({
    queryKey: chave, enabled: aberto,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rep_candidata_perfil", { _lead: lead });
      if (error) throw error;
      return data as unknown as Perfil;
    },
  });
  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("candidatura_teste_gerar", { _lead: lead });
      if (error) throw error;
      return (data as unknown as { token: string }).token;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: chave }),
    onError: (e: Error) => toast.error(e.message.includes("sem_permissao") ? "Esta candidata não está na sua carteira." : e.message),
  });
  const p = q.data;
  const primeiro = nome.split(" ")[0] ?? "";
  const token = p?.link_aberto ?? gerar.data ?? null;

  return (
    <div className="mt-3 rounded-xl border border-border">
      <button type="button" onClick={() => setAberto(!aberto)} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-sm font-medium">
        <span className="flex items-center gap-2"><ClipboardCheck className="size-4" /> Perfil e sonho</span>
        <ChevronDown className={`size-4 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-border p-3 text-sm">
          {q.isLoading && <p className="text-muted-foreground">Carregando…</p>}
          {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
          {p && (
            <>
              <p>{p.sonho ? <>Sonho: <strong>{p.sonho}</strong>{p.sonho_valor_cents ? ` · ${(Number(p.sonho_valor_cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}</> : <span className="text-muted-foreground">Ela ainda não contou o sonho.</span>}</p>
              {p.concluido_em ? (
                <div className="space-y-2">
                  <p><strong>Perfil {p.disc_perfil}</strong>{p.rede ? ` · ${REDE[p.rede]}` : ""}</p>
                  {p.disc_pct && FATORES.map((f) => (
                    <div key={f} className="grid grid-cols-[1.25rem_1fr_2.5rem] items-center gap-2 text-xs">
                      <strong>{f}</strong>
                      <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${p.disc_pct![f] ?? 0}%` }} /></div>
                      <span className="text-right tabular-nums text-muted-foreground">{p.disc_pct![f] ?? 0}%</span>
                    </div>
                  ))}
                  {p.acompanhamento && <p className="whitespace-pre-line text-muted-foreground">{p.acompanhamento}</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground">{p.link_aberto ? `Teste começado (parte ${Math.min(p.link_parte ?? 1, 3)} de 3), ainda sem concluir.` : "Ela ainda não fez o teste de perfil."}</p>
                  {token ? (
                    <div className="grid grid-cols-2 gap-2">
                      <a href={wa(whatsapp, `Olá, ${primeiro}! Aqui é da Lardan Semijoias. Este é o link do seu teste de candidatura, leva uns 10 minutos e fica salvo a cada tela: ${url(token)}`)}
                        target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-2 text-center text-sm font-semibold text-primary-foreground">
                        <MessageCircle className="size-4" /> Mandar no WhatsApp
                      </a>
                      <button type="button" onClick={() => setTesteAqui(true)} className="min-h-11 rounded-xl border border-border px-2 text-sm">Fazer aqui com ela</button>
                    </div>
                  ) : (
                    <button type="button" disabled={gerar.isPending} onClick={() => gerar.mutate()} className="min-h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
                      {gerar.isPending ? "Preparando…" : "Preparar o teste de perfil"}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {token && (
        <Dialog open={testeAqui} onOpenChange={(v) => { setTesteAqui(v); if (!v) void qc.invalidateQueries({ queryKey: chave }); }}>
          <DialogContent className="h-[100dvh] max-h-[100dvh] w-full max-w-none overflow-y-auto rounded-none p-0 sm:h-[92dvh] sm:max-w-2xl sm:rounded-2xl">
            <DialogTitle className="sr-only">Teste de candidatura de {nome}</DialogTitle>
            <DialogDescription className="sr-only">A candidata responde no seu celular; as respostas são dela.</DialogDescription>
            <TesteCandidatura token={token} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

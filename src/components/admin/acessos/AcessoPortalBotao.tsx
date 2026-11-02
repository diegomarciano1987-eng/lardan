import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConviteConsultora } from "./ConviteConsultora";

/**
 * Botão do cabeçalho (ficha e cockpit) para criar/reenviar o acesso da
 * consultora ao Portal e mandar o link pelo WhatsApp, sem procurar abas.
 */
export function AcessoPortalBotao({ partyId, className = "admin-btn" }: { partyId: string; className?: string }) {
  const [aberto, setAberto] = React.useState(false);
  const q = useQuery({
    queryKey: ["acesso-consultora", partyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consultora_acesso_situacao" as never, { _party: partyId } as never);
      if (error) throw error;
      return data as unknown as { conta_email: string | null; convite: { status: string } | null };
    },
  });
  const ativo = !!q.data?.conta_email;
  const pendente = q.data?.convite?.status === "pendente";
  return (
    <>
      <button type="button" className={className} onClick={() => setAberto(true)} data-testid="acesso-portal-botao">
        {ativo ? <ShieldCheck className="size-4" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
        {ativo ? "Acesso ativo" : pendente ? "Convite enviado · reenviar" : "Criar acesso e enviar no WhatsApp"}
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Acesso ao Portal da Consultora</DialogTitle>
            <DialogDescription>
              Gere o link, envie pelo WhatsApp e ela cria a própria senha. Cada consultora tem login próprio e só vê as maletas dela.
            </DialogDescription>
          </DialogHeader>
          <ConviteConsultora partyId={partyId} />
        </DialogContent>
      </Dialog>
    </>
  );
}

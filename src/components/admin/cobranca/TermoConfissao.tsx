import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSignature, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { zapsignConfissao } from "@/lib/zapsign/zapsign.functions";

/** Gera o termo de confissão de dívida do acordo e manda pela ZapSign (código + selfie + documento). */
export function TermoConfissao({ simId }: { simId: string }) {
  const enviar = useServerFn(zapsignConfissao);
  const [ocupado, setOcupado] = React.useState(false);
  const [link, setLink] = React.useState<string | null>(null);
  const ir = async (reenviar: boolean) => {
    setOcupado(true);
    try {
      const r = await enviar({ data: { simulacaoId: simId, reenviar } });
      setLink(r.signUrl);
      toast.success(r.jaExistia ? "Já existe um termo aguardando assinatura." : r.whatsapp ? "Termo enviado pelo WhatsApp da devedora." : "Termo criado. Copie o link e envie.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível gerar o termo."); } finally { setOcupado(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button size="sm" variant="outline" disabled={ocupado} onClick={() => ir(false)}><FileSignature className="size-4" />Termo de confissão (ZapSign)</Button>
      {link && <>
        <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copiado."); }}><Copy className="size-4" />Copiar link</Button>
        <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => { if (confirm("Cancelar o termo pendente e mandar um novo?")) void ir(true); }}>Reenviar novo</Button>
      </>}
    </div>
  );
}

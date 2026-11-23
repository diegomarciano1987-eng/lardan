import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSignature, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { zapsignConfissao } from "@/lib/zapsign/zapsign.functions";
import { dataBR } from "@/lib/cobranca";
import { rotuloTermo } from "@/lib/cobranca-historica";
import { termosConfissao } from "@/lib/termo-confissao";
import { useCobrancaSomenteLeitura } from "@/lib/cobranca-leitura";

export const chaveTermo = (simId: string) => ["cob", "termo", simId] as const;

/** Gera o termo de confissão de dívida do acordo e manda pela ZapSign (código + selfie + documento). */
export function TermoConfissao({ simId, obrigatorio = false }: { simId: string; obrigatorio?: boolean }) {
  const leitura = useCobrancaSomenteLeitura();
  const qc = useQueryClient();
  const enviar = useServerFn(zapsignConfissao);
  const situacao = useQuery({ queryKey: chaveTermo(simId), queryFn: async () => (await termosConfissao([simId])).get(simId) ?? null });
  const [ocupado, setOcupado] = React.useState(false);
  const [link, setLink] = React.useState<string | null>(null);
  const t = situacao.data;
  const r = rotuloTermo(t);
  const url = link ?? t?.sign_url ?? null;
  const ir = async (reenviar: boolean) => {
    setOcupado(true);
    try {
      const x = await enviar({ data: { simulacaoId: simId, reenviar } });
      setLink(x.signUrl);
      toast.success(x.jaExistia ? "Já existe um termo aguardando assinatura." : x.whatsapp ? "Termo enviado pelo WhatsApp da devedora." : "Termo criado. Copie o link e envie.");
      qc.invalidateQueries({ queryKey: ["cob"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível gerar o termo."); } finally { setOcupado(false); }
  };
  const cor = r.tipo === "assinado" ? "bg-success/10 text-success" : r.tipo === "pendente" ? "bg-warning/10 text-warning" : obrigatorio ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground";
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1" data-termo={r.tipo}>
      <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${cor}`}>
        <FileSignature aria-hidden className="size-3.5" />
        {situacao.isLoading ? "Conferindo termo…" : r.tipo === "assinado" ? `Termo assinado${t?.assinado_em ? ` em ${dataBR(t.assinado_em)}` : ""}`
          : r.tipo === "pendente" ? `Termo aguardando assinatura desde ${dataBR(t!.criado_em)}${t!.enviado_whatsapp ? " (enviado no WhatsApp)" : ""}`
          : obrigatorio ? "Sem termo — obrigatório (dívida até 2025)" : "Sem termo de confissão"}
      </span>
      {!leitura && r.tipo === "sem" && <Button size="sm" variant="outline" disabled={ocupado} onClick={() => ir(false)}><FileSignature className="size-4" />Enviar termo de confissão (ZapSign)</Button>}
      {!leitura && r.tipo === "pendente" && url && <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(url); toast.success("Link copiado."); }}><Copy className="size-4" />Copiar link</Button>}
      {!leitura && r.tipo === "pendente" && <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => { if (confirm("Cancelar o termo pendente e mandar um novo?")) void ir(true); }}>Reenviar novo</Button>}
    </div>
  );
}

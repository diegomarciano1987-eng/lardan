/**
 * Aba "Documentos assinados" do cadastro (0228): tudo que esta pessoa assinou
 * — contrato e promissória enviados pelo sistema, termo da maleta (Clicksign)
 * e documentos criados direto no painel da ZapSign (acordos, termos).
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSignature } from "lucide-react";
import { Panel, Skeleton, StatusBadge, type StatusTone } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { documentoAssinadoLink } from "@/lib/zapsign/zapsign.functions";

interface Doc {
  fonte: "zapsign" | "clicksign"; id: string; tipo: string; origem: string; titulo: string;
  status: "pendente" | "assinado" | "recusado" | "cancelado" | "erro"; ambiente: string; maleta: string | null;
  valor_cents: number | null; assinante: string | null; data: string; criado_em: string; assinado_em: string | null; tem_copia: boolean; sign_url: string | null;
}
const TIPO: Record<string, string> = { contrato: "Contrato", promissoria: "Promissória", avulso: "Documento (painel ZapSign)", termo_maleta: "Termo da maleta" };
const STATUS: Record<Doc["status"], { rotulo: string; tom: StatusTone }> = {
  assinado: { rotulo: "Assinado", tom: "success" }, pendente: { rotulo: "Aguardando assinatura", tom: "warning" },
  recusado: { rotulo: "Recusado", tom: "danger" }, cancelado: { rotulo: "Cancelado", tom: "neutral" }, erro: { rotulo: "Erro", tom: "danger" },
};
const data = (s: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—");
const brl = (c: number | null) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export function DocumentosAssinados({ partyId }: { partyId: string }) {
  const linkFn = useServerFn(documentoAssinadoLink);
  const q = useQuery({
    queryKey: ["documentos-assinados", partyId],
    queryFn: async () => {
      const { data: d, error } = await supabase.rpc("documentos_assinados_da_pessoa" as never, { _party: partyId } as never);
      if (error) throw error;
      return d as unknown as Doc[];
    },
  });
  const abrir = async (d: Doc) => {
    try {
      const r = await linkFn({ data: { fonte: d.fonte, id: d.id } });
      if (r.url) window.open(r.url, "_blank", "noopener,noreferrer"); else toast.error("Arquivo ainda não disponível.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
  };
  const docs = q.data ?? [];
  const assinados = docs.filter((d) => d.status === "assinado").length;
  return (
    <Panel title={`Documentos assinados (${assinados} de ${docs.length})`}>
      {q.isLoading && <Skeleton className="h-16 w-full" />}
      {q.error && <p className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Sem permissão."}</p>}
      {q.data && docs.length === 0 && <p className="text-sm text-ledger-muted">Nenhum documento enviado para assinatura desta pessoa.</p>}
      <ul className="divide-y divide-line-soft">
        {docs.map((d) => (
          <li key={`${d.fonte}-${d.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold text-ledger-text"><FileSignature aria-hidden className="size-4" /> {d.titulo}</p>
              <p className="text-xs text-ledger-muted">
                {TIPO[d.tipo] ?? d.tipo}{d.maleta ? ` · maleta ${d.maleta}` : ""}{d.valor_cents ? ` · ${brl(d.valor_cents)}` : ""}
                {` · enviado ${data(d.criado_em)}`}{d.assinado_em ? ` · assinado ${data(d.assinado_em)}` : ""}
                {d.assinante ? ` · por ${d.assinante}` : ""}{d.ambiente === "sandbox" ? " · teste" : ""}
                {d.status === "assinado" && !d.tem_copia ? " · cópia será guardada ao abrir" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone={STATUS[d.status].tom}>{STATUS[d.status].rotulo}</StatusBadge>
              <button type="button" className="admin-btn h-9 px-3 text-xs" onClick={() => void abrir(d)}>{d.status === "assinado" ? "Abrir assinado" : "Abrir"}</button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

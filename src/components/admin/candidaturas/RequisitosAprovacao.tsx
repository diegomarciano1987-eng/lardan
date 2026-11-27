/**
 * 0412 — O que falta para aprovar (teste DISC, consulta Assertiva, documentos). A regra vale no banco:
 * "Marcar ganho", o quadro e o app do representante recusam enquanto faltar qualquer um dos três.
 */
import { useQuery } from "@tanstack/react-query";
import { Check, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Req = { teste: boolean; credito: boolean; documentos: boolean; isenta: boolean };

export function useRequisitosAprovacao(leadId: string, enabled = true) {
  return useQuery({
    queryKey: ["crm", "captacao-decisao", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("captacao_decisao_ver" as never, { _lead: leadId } as never);
      if (error) throw error;
      return data as unknown as { requisitos?: Req; falta?: string[] };
    },
    enabled,
    refetchInterval: 30_000,
  });
}

export function RequisitosAprovacao({ leadId, compacto = false }: { leadId: string; compacto?: boolean }) {
  const q = useRequisitosAprovacao(leadId);
  const r = q.data?.requisitos;
  if (q.isPending) return <p role="status" className="px-4 py-3 text-sm text-ledger-muted">Conferindo requisitos para aprovação…</p>;
  if (q.error || !r) return <p role="alert" className="px-4 py-3 text-sm text-danger">Não foi possível conferir os requisitos. Tente novamente antes de aprovar.</p>;
  if (r.isenta) {
    return compacto ? null : (
      <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ledger-muted">
        Aprovada antes da regra nova ou já com maleta: fica fora da exigência de teste, consulta e documentos.
      </p>
    );
  }
  const itens: [string, boolean, string][] = [
    ["Teste DISC", r.teste, "a candidata responde pelo link do teste"],
    ["Consulta Assertiva", r.credito, "sai sozinha quando ela conclui o teste"],
    ["Documentos (4 fotos)", r.documentos, "o link aparece logo depois do teste"],
  ];
  const ok = itens.every((i) => i[1]);
  return (
    <section className={cn("rounded-lg border px-4 py-3", ok ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5")} aria-label="Requisitos para aprovar">
      <p className="text-sm font-semibold text-ledger-text">{ok ? "Tudo pronto para a decisão" : "Para aprovar ainda falta"}</p>
      <ul className={cn("mt-2 grid gap-1.5 text-sm", !compacto && "sm:grid-cols-3")}>
        {itens.map(([rotulo, feito, dica]) => (
          <li key={rotulo} className="flex items-start gap-2">
            {feito ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />}
            <span>
              <span className={feito ? "text-ledger-text" : "font-medium text-ledger-text"}>{rotulo}</span>
              {!feito && <span className="block text-xs text-ledger-muted">{dica}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

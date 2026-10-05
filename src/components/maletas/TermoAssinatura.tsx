import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileSignature } from "lucide-react";
import { toast } from "sonner";
import { linkTermo } from "@/lib/clicksign.functions";
import { situacaoAssinatura, type TermoMaleta } from "@/lib/maletas";

const ESTADO: Record<TermoMaleta["estado"], { rotulo: string; tom: string }> = {
  preparado: { rotulo: "Termo gerado", tom: "text-ledger-muted" },
  enviado: { rotulo: "Aguardando assinatura", tom: "text-warning" },
  assinado: { rotulo: "Assinado — guardando o arquivo", tom: "text-warning" },
  finalizado: { rotulo: "Assinado e maleta liberada", tom: "text-success" },
  recusado: { rotulo: "Assinatura recusada", tom: "text-destructive" },
  cancelado: { rotulo: "Cancelado", tom: "text-ledger-muted" },
  expirado: { rotulo: "Prazo vencido", tom: "text-destructive" },
  falha: { rotulo: "Falha no envio", tom: "text-destructive" },
};
const dt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null);

export function useSituacaoTermo(cycleId: string | null) {
  return useQuery({
    queryKey: ["termo-maleta", cycleId],
    queryFn: () => situacaoAssinatura(cycleId!),
    enabled: !!cycleId,
    refetchInterval: (q) => (q.state.data?.termos.some((t) => t.estado === "enviado" || t.estado === "assinado") ? 15000 : false),
  });
}

/** Linha do tempo dos termos da maleta, com acesso aos arquivos. */
export function TermosMaleta({ cycleId, titulo = "Termo de recebimento" }: { cycleId: string; titulo?: string }) {
  const q = useSituacaoTermo(cycleId);
  const abrir = useServerFn(linkTermo);
  const link = useMutation({
    mutationFn: (v: { requestId: string; tipo: "original" | "assinado" }) => abrir({ data: v }),
    onSuccess: (r) => (r.ok ? window.open(r.url, "_blank", "noopener") : toast.error(r.erro)),
  });
  if (!q.data || q.data.termos.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 font-semibold">
        <FileSignature className="size-4" /> {titulo}
      </p>
      {q.data.termos.map((t) => {
        const e = ESTADO[t.estado];
        return (
          <div key={t.id} className="rounded-xl border border-line-soft p-4 text-sm">
            <p className={`font-semibold ${e.tom}`}>{e.rotulo}</p>
            <p className="mt-1 text-ledger-muted">
              {t.total_aceito} aceitas · {t.total_divergente} divergentes · versão {t.versao}
              {t.modo === "sandbox" ? " · ambiente de testes" : ""}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-ledger-muted">
              {dt(t.criado_em) && <li>Gerado em {dt(t.criado_em)}</li>}
              {dt(t.enviado_em) && <li>Enviado em {dt(t.enviado_em)}</li>}
              {dt(t.assinado_em) && <li>Assinado em {dt(t.assinado_em)}</li>}
              {dt(t.finalizado_em) && <li>Maleta liberada em {dt(t.finalizado_em)}</li>}
              {t.motivo && <li>Motivo: {t.motivo}</li>}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {t.tem_pdf && (
                <button type="button" className="admin-btn min-h-10" onClick={() => link.mutate({ requestId: t.id, tipo: "original" })}>
                  Ver termo gerado
                </button>
              )}
              {t.tem_assinado && (
                <button type="button" className="admin-btn admin-btn-primary min-h-10" onClick={() => link.mutate({ requestId: t.id, tipo: "assinado" })}>
                  Ver termo assinado
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

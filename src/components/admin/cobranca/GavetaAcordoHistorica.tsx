/**
 * 18/11/2026 (Larissa/Diego): gerar acordo parcelado direto na aba "Histórica até 2025".
 * Abre o mesmo simulador oficial da ficha (cob_simulacoes → cobranças do acordo no Asaas), já com as parcelas antigas
 * marcadas e o quadro de avisos do Asaas no topo. Nada novo de dinheiro: a baixa continua pelo acordo (mais antiga primeiro).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { brl, dataBR, devedor } from "@/lib/cobranca";
import { situacaoHistorica, type DevedorHistorico } from "@/lib/cobranca-historica";
import { SimuladorAcordo } from "./SimuladorAcordo";

export function GavetaAcordoHistorica({ alvo, onClose }: { alvo: DevedorHistorico | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["cob", "devedor", alvo?.party_id], queryFn: () => devedor(alvo!.party_id), enabled: !!alvo });
  const s = alvo ? situacaoHistorica(alvo) : null;
  return (
    <Sheet open={!!alvo} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[min(1100px,95vw)]" data-gaveta-acordo>
        {alvo && (
          <>
            <SheetHeader className="space-y-1 pr-8">
              <SheetTitle className="font-display text-xl">Gerar acordo — {alvo.nome}</SheetTitle>
              <SheetDescription>
                {alvo.codigo ? `Cód. ${alvo.codigo} · ` : ""}{alvo.parcelas} parcela(s) antiga(s) de {dataBR(alvo.venc_min)}{alvo.venc_max !== alvo.venc_min ? ` a ${dataBR(alvo.venc_max)}` : ""} · saldo antigo {brl(Number(alvo.saldo_cents))}
                {alvo.tem_recente ? " · também deve em 2026 (marque se quiser incluir)" : ""}
              </SheetDescription>
              <Link to="/admin/cobranca/$id" params={{ id: alvo.party_id }} className="inline-flex items-center gap-1 text-xs font-semibold text-bronze underline">
                Abrir ficha completa <ExternalLink aria-hidden className="size-3" />
              </Link>
            </SheetHeader>
            <div className="mt-4 space-y-4 pb-8">
              {s && s.tipo === "asaas" && (
                <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                  {s.rotulo}. O sistema não deixa gerar o acordo enquanto houver cobrança aberta no Asaas nessas dívidas (para ela não pagar duas vezes).
                </p>
              )}
              {s && (s.tipo === "faturada" || s.tipo === "acordo") && (
                <p className="rounded-lg border border-line bg-warm-ivory p-3 text-sm">
                  {s.rotulo}. Ele aparece em “Simulações e acordos”, abaixo. Para trocar por um parcelado, cancele o atual primeiro.
                </p>
              )}
              {q.isLoading && <p className="text-sm text-ledger-muted">Carregando dívidas…</p>}
              {q.error && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
              {q.data && <SimuladorAcordo key={alvo.party_id} partyId={alvo.party_id} parcelas={q.data.parcelas} selecaoInicial={alvo.installment_ids} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

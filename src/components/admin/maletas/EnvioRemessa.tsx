/**
 * 0157 — como a maleta vai: pessoalmente ou pelo correio.
 * No correio, o pedido de consignação mostra "Postar a maleta até" (acerto − prazo do correio).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { dataBR, definirEnvioRemessa, lerEnvioRemessa, type TipoEnvio } from "@/lib/remessas";
import { traduzir } from "@/lib/maletas";

export function EnvioRemessa({ remessaId, podeAlterar }: { remessaId: string; podeAlterar: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["remessas", "envio", remessaId], queryFn: () => lerEnvioRemessa(remessaId) });
  const m = useMutation({
    mutationFn: (t: TipoEnvio) => definirEnvioRemessa(remessaId, t),
    onSuccess: (r) => {
      toast.success(r.tipo_envio === "correio" ? "Remessa pelo correio: o pedido mostra a data de postagem." : "Remessa entregue pessoalmente.");
      void qc.invalidateQueries({ queryKey: ["remessas", "envio", remessaId] });
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const d = q.data;
  if (!d) return null;
  const opcao = (t: TipoEnvio, rotulo: string, Icone: typeof Truck) => (
    <button type="button" disabled={!podeAlterar || m.isPending || d.tipo_envio === t} onClick={() => m.mutate(t)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${d.tipo_envio === t ? "border-champagne bg-champagne-soft text-ledger-text" : "border-line text-ledger-muted"}`}>
      <Icone aria-hidden className="size-3.5" /> {rotulo}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="ledger-eyebrow">Envio</span>
      {opcao("pessoal", "Pessoalmente", UserRound)}
      {opcao("correio", "Pelo correio", Truck)}
      {d.tipo_envio === "correio" && (
        <span className="text-ledger-muted">
          Postar até <strong className="text-ledger-text">{dataBR(d.postar_ate)}</strong> ({d.prazo_correio_dias} dias antes do acerto)
        </span>
      )}
    </div>
  );
}

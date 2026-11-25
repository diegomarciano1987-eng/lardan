import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Scale, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatBRLFromCents, Skeleton } from "@/components/admin/ui";
import { alvarasMesa, conciliarAlvaraMesa, type AlvaraMesa } from "@/lib/mesa-conciliacao";
import { alvaraConfere } from "@/lib/forma-extrato";
import { reaisParaCentavos } from "@/lib/financeiro";
import type { LinhaExtratoRow } from "@/lib/conciliacao";

const dataBR = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

export function AlvarasMesa({ linha, pode, nomeSugerido, onFeito }: {
  linha: LinhaExtratoRow; pode: boolean; nomeSugerido: string | null; onFeito: () => void;
}) {
  const [busca, setBusca] = useState(nomeSugerido ?? "");
  const [lenta, setLenta] = useState(nomeSugerido ?? "");
  const [selecionado, setSelecionado] = useState<AlvaraMesa | null>(null);
  const [juros, setJuros] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLenta(busca.trim()), 350); return () => clearTimeout(t); }, [busca]);
  const q = useQuery({ queryKey: ["mesa-alvaras", linha.id, lenta], queryFn: () => alvarasMesa(linha.id, lenta), enabled: pode });
  const recebido = (linha.valor_cents ?? 0) - linha.conciliado_cents;
  const jurosCents = reaisParaCentavos(juros) ?? 0;
  const confere = selecionado !== null && alvaraConfere(recebido, selecionado.valor_cents, jurosCents);
  const escolher = (a: AlvaraMesa) => {
    setSelecionado(a);
    setJuros("");
    setConfirmado(false);
  };
  const aplicar = useMutation({
    mutationFn: async () => {
      if (!selecionado || !confere || !confirmado) throw new Error("Confira a cliente, o alvará e os juros antes de confirmar.");
      return conciliarAlvaraMesa(linha.id, selecionado.acordo_id, selecionado.numero, jurosCents);
    },
    onSuccess: () => { toast.success("Alvará recebido e conciliado no acordo."); onFeito(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6" aria-label="Alvarás do acordo judicial">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ledger-text"><Scale className="size-5 text-bronze" /> Alvarás do acordo judicial</h2>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" aria-hidden />
        <input aria-label="Buscar devedora do alvará" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou código da devedora"
          className="h-12 w-full rounded-lg border border-line bg-surface pl-10 pr-3 text-base text-ledger-text outline-none focus:border-champagne" />
      </div>
      {q.isLoading && <Skeleton className="h-24 w-full" />}
      {q.error && <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {!q.isLoading && !q.error && q.data?.length === 0 && <p className="text-sm text-ledger-muted">Nenhum alvará pendente encontrado.</p>}
      {(q.data ?? []).map((a) => (
        <Button key={`${a.acordo_id}:${a.numero}`} variant="outline" aria-pressed={selecionado?.acordo_id === a.acordo_id && selecionado.numero === a.numero}
          onClick={() => escolher(a)} className="h-auto w-full justify-between gap-3 whitespace-normal p-4 text-left">
          <span className="min-w-0"><span className="block font-semibold">{a.party_code ? `[Cód. ${a.party_code}] ` : ""}{a.party_nome}</span>
            <span className="mt-1 block text-xs text-ledger-muted">Acordo de {dataBR(a.data_acordo)} · alvará {a.numero} · {dataBR(a.data)}</span></span>
          <span className="shrink-0 font-semibold tabular-nums">{formatBRLFromCents(a.valor_cents)}</span>
        </Button>
      ))}
      {selecionado && (
        <div className="space-y-4 border-t border-line pt-4">
          <dl className="space-y-2 text-sm text-ledger-text">
            <div className="flex justify-between gap-3"><dt>Alvará {selecionado.numero}</dt><dd className="font-semibold tabular-nums">{formatBRLFromCents(selecionado.valor_cents)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Recebimento no extrato</dt><dd className="font-semibold tabular-nums">{formatBRLFromCents(recebido)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Diferença</dt><dd className="font-semibold tabular-nums">{formatBRLFromCents(recebido - selecionado.valor_cents)}</dd></div>
          </dl>
          <label className="block text-sm font-semibold text-ledger-text">Juros confirmados (R$)
            <input value={juros} onChange={(e) => { setJuros(e.target.value); setConfirmado(false); }} inputMode="decimal" placeholder="0,00" aria-label="Juros confirmados do alvará"
              className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 tabular-nums outline-none focus:border-champagne" />
          </label>
          <label className="flex items-start gap-3 text-sm text-ledger-text">
            <Checkbox checked={confirmado} onCheckedChange={(v) => setConfirmado(v === true)} className="mt-0.5" aria-label="Confirmar cliente, alvará e juros" />
            <span>Confirmo {selecionado.party_nome}, o alvará {selecionado.numero} e os juros de {formatBRLFromCents(jurosCents)}.</span>
          </label>
          {!confere && <p className="text-sm font-semibold text-destructive">O alvará mais os juros precisa fechar o valor do extrato.</p>}
          <Button disabled={!pode || !confere || !confirmado || aplicar.isPending} onClick={() => aplicar.mutate()} className="h-12 w-full">
            <Check /> {aplicar.isPending ? "Conciliando…" : "Receber alvará e conciliar"}
          </Button>
        </div>
      )}
    </section>
  );
}
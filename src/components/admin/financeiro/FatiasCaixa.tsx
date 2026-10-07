import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { useCapabilities } from "@/lib/capabilities";
import { buscarContrapartes, reaisParaCentavos } from "@/lib/financeiro";
import { fetchFatias, lancarFatia } from "@/lib/financeiro-cheques";

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

/** De quem é cada fatia do dinheiro desta conta. O restante é caixa livre da Lardan. */
export function FatiasCaixa({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const podeGerir = useCapabilities().includes("finance.bank.manage");
  const q = useQuery({ queryKey: ["fin-fatias", accountId], queryFn: () => fetchFatias(accountId) });
  const [termo, setTermo] = React.useState("");
  const pessoas = useQuery({ queryKey: ["contrapartes", termo], queryFn: () => buscarContrapartes(termo) });
  const [party, setParty] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [motivo, setMotivo] = React.useState("");

  const lancar = useMutation({
    mutationFn: async (sinal: 1 | -1) => {
      const c = reaisParaCentavos(valor);
      if (!party) throw new Error("Escolha a pessoa.");
      if (!c || c <= 0) throw new Error("Informe um valor maior que zero.");
      return lancarFatia({ account_id: accountId, party_id: party, valor_cents: sinal * c, motivo });
    },
    onSuccess: () => {
      toast.success("Fatia atualizada.");
      setValor("");
      setMotivo("");
      void qc.invalidateQueries({ queryKey: ["fin-fatias", accountId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.error || !q.data) return <ErrorState message="Não foi possível carregar as fatias desta conta." />;
  const d = q.data;
  const livre = d.saldo_cents - d.reservado_cents;

  return (
    <div className="space-y-6">
      <Panel title="De quem é o dinheiro desta conta (hoje)">
        <ul className="divide-y divide-line-soft">
          {d.fatias.map((f) => (
            <li key={f.party_id} className="flex items-center justify-between py-3">
              <span className="font-semibold text-ledger-text">{f.nome}</span>
              <span className="tabular-nums font-semibold">{formatBRLFromCents(f.valor_cents)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between py-3">
            <span className="font-semibold text-ledger-text">Caixa livre da Lardan</span>
            <span className={`tabular-nums font-semibold ${livre < 0 ? "text-destructive" : ""}`}>
              {formatBRLFromCents(livre)}
            </span>
          </li>
          <li className="flex items-center justify-between py-3 text-sm text-ledger-muted">
            <span>Saldo total da conta</span>
            <span className="tabular-nums">{formatBRLFromCents(d.saldo_cents)}</span>
          </li>
        </ul>
        {livre < 0 && (
          <p className="mt-2 text-sm text-destructive">
            O saldo da conta ficou menor que as fatias separadas. Confira se alguém retirou dinheiro sem baixar a fatia.
          </p>
        )}
      </Panel>

      {podeGerir && (
        <Panel title="Separar ou devolver uma fatia">
          <p className="mb-3 text-sm text-ledger-muted">
            Separar não tira dinheiro da conta: só marca que aquela parte é de alguém (ex.: comissão guardada).
            Quando a pessoa receber, use "Baixar fatia" e lance o pagamento normalmente.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <SmartSelect
              options={(pessoas.data ?? []).map((p) => ({ value: p.id, label: p.nome }))}
              value={party}
              onChange={setParty}
              onSearch={setTermo}
              loading={pessoas.isFetching}
              placeholder="Pessoa (cadastro)"
            />
            <input className={inputCls} inputMode="decimal" placeholder="Valor 0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
            <input className={inputCls} placeholder="Motivo (obrigatório)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="admin-btn-primary" disabled={lancar.isPending} onClick={() => lancar.mutate(1)}>
              Separar fatia
            </button>
            <button type="button" className="admin-btn-secondary" disabled={lancar.isPending} onClick={() => lancar.mutate(-1)}>
              Baixar fatia
            </button>
          </div>
        </Panel>
      )}

      {d.historico.length > 0 && (
        <Panel title="Histórico das fatias">
          <ul className="divide-y divide-line-soft text-sm">
            {d.historico.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <strong>{h.nome}</strong> · {h.motivo}
                  <span className="ml-2 text-ledger-muted">
                    {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(h.quando))}
                  </span>
                </span>
                <span className="tabular-nums">{formatBRLFromCents(h.valor_cents)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

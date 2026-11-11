/**
 * 0279 — transferir a maleta de uma consultora para outra (ou deixar como ABERTURA com o representante),
 * em dois momentos: depois da montagem e antes da nota, ou já na rua a caminho dela com nota e promissória.
 * A prévia do banco mostra o que trava e o que vai acontecer; a troca roda numa transação só.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRightLeft, CircleAlert, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { consultorasDaPraca } from "@/lib/remessas";
import { maletaTransferir } from "@/lib/maletas-transferir.functions";
import { avisosTransferencia } from "@/lib/transferencia-avisos";
import { traduzir } from "@/lib/maletas";

export interface PreviaTransferencia {
  cycle_id: string; maleta: string | null; status: string; remessa_id: string | null;
  consultora_party_id: string | null; consultora: string | null;
  representante_party_id: string | null; representante: string | null; abertura_numero: number | null;
  entrega_pendente: boolean; ja_recebeu: boolean; promissoria: "pendente" | "assinada" | null; nota_numero: string | null;
  momento: "antes_da_nota" | "com_nota"; bloqueio: string | null;
}

/** Status em que a transferência pode aparecer (o banco decide o resto). */
export const STATUS_TRANSFERIR = ["rascunho", "montagem", "conferida", "expedida", "transito", "recebida"];

const ABERTURA = "__abertura__";

export function TransferirForm({ cycleId, pracaId, onFeito }: { cycleId: string; pracaId: string | null; onFeito?: () => void }) {
  const qc = useQueryClient();
  const transferirFn = useServerFn(maletaTransferir);
  const [busca, setBusca] = React.useState("");
  const [destino, setDestino] = React.useState<string | undefined>(undefined);
  const [motivo, setMotivo] = React.useState("");
  const [confirmar, setConfirmar] = React.useState(false);

  const previa = useQuery({
    queryKey: ["maletas", "transferir-previa", cycleId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("maleta_transferir_previa" as never, { _cycle: cycleId } as never);
      if (error) throw error;
      return data as unknown as PreviaTransferencia;
    },
  });
  const p = previa.data;
  const consultoras = useQuery({
    queryKey: ["remessas", "consultoras", pracaId, busca],
    queryFn: () => consultorasDaPraca(pracaId!, busca),
    enabled: !!pracaId,
  });
  const opcoes = React.useMemo(() => {
    const lista = (consultoras.data ?? []).filter((o) => o.value !== p?.consultora_party_id);
    if (p?.representante && p.consultora_party_id) {
      return [{ value: ABERTURA, label: `Deixar como ABERTURA com o representante ${p.representante}`, hint: "Sem consultora: ele passa para uma candidata" }, ...lista];
    }
    return lista;
  }, [consultoras.data, p?.consultora_party_id, p?.representante]);

  const transferir = useMutation({
    mutationFn: () => {
      if (!destino) throw new Error("Escolha para quem vai a maleta.");
      if (motivo.trim().length < 5) throw new Error("Escreva o motivo (mínimo 5 letras).");
      return transferirFn({ data: { cycleId, modo: "equipe", consultoraId: destino === ABERTURA ? null : destino, motivo: motivo.trim() } });
    },
    onSuccess: (r) => {
      toast.success(r.consultora_nova ? `Maleta transferida para ${r.consultora_nova}.` : `Maleta virou ABERTURA ${String(r.abertura_numero ?? "").padStart(2, "0")} com o representante.`);
      for (const aviso of avisosTransferencia(r)) toast.info(aviso, { duration: 10000 });
      setConfirmar(false); setDestino(undefined); setMotivo("");
      void qc.invalidateQueries({ queryKey: ["maletas"] });
      void qc.invalidateQueries({ queryKey: ["remessas"] });
      onFeito?.();
    },
    onError: (e) => { setConfirmar(false); toast.error(traduzir(e)); void previa.refetch(); },
  });

  if (previa.isLoading) return <p className="text-sm text-ledger-muted">Conferindo a maleta…</p>;
  if (previa.isError || !p) return <p className="text-sm text-destructive">{traduzir(previa.error)}</p>;

  const nomeDestino = destino === ABERTURA ? `ABERTURA com ${p.representante}` : opcoes.find((o) => o.value === destino)?.label;
  const efeitos: string[] = [];
  if (p.consultora) efeitos.push(`A maleta sai do app de ${p.consultora} na hora.`);
  if (p.ja_recebeu) efeitos.push(`${p.consultora} já confirmou que recebeu (sem aceite): a maleta volta para a custódia de ${p.representante ?? "do representante"}, que busca com ela.`);
  if (p.entrega_pendente) efeitos.push(`A entrega em mãos para ${p.consultora}, ainda sem confirmação dela, é cancelada.`);
  if (p.promissoria === "pendente") efeitos.push("A promissória pendente é cancelada na ZapSign e a nova vai para quem ficar com a maleta.");
  if (p.promissoria === "assinada") efeitos.push(`A promissória assinada por ${p.consultora} fica guardada como prova, marcada como substituída (nunca é cobrada), e a nova vai para quem ficar com a maleta.`);
  if (p.nota_numero) efeitos.push(`A nota fiscal nº ${p.nota_numero} está em nome de ${p.consultora}: vira pendência fiscal nesta remessa (devolução da nota antiga + nota nova).`);
  else if (p.consultora) efeitos.push("Ainda não tem nota fiscal: a nota sai direto no nome de quem ficar com a maleta.");
  if (["transito", "recebida"].includes(p.status) && p.representante) efeitos.push(`Quem entrega em mãos continua sendo ${p.representante}.`);

  return (
    <div className="space-y-4" data-transferir-maleta="">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex h-7 items-center rounded-full bg-primary/10 px-3 font-semibold text-primary">
          {p.momento === "com_nota" ? "Na rua, com nota" : "Antes da nota"}
        </span>
        {p.consultora && <span className="text-ledger-muted">Hoje com: <strong className="text-ledger-text">{p.consultora}</strong></span>}
      </div>

      {p.bloqueio ? (
        <div className="flex gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-ledger-text" role="alert">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" /> {p.bloqueio}
        </div>
      ) : (
        <>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-ledger-text">Para quem vai a maleta</span>
            <SmartSelect value={destino} onChange={(v) => { setDestino(v); setConfirmar(false); }} options={opcoes} onSearch={setBusca}
              loading={consultoras.isFetching} searchPlaceholder="Buscar por código, nome ou CPF"
              placeholder={pracaId ? "Escolher consultora da praça" : "Maleta fora de remessa"} disabled={!pracaId && !p.representante} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-ledger-text">Motivo</span>
            <input className="admin-input w-full" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: consultora desistiu; representante deixou com outra" />
          </label>
          {efeitos.length > 0 && (
            <div className="rounded-xl border border-line-soft bg-surface p-4">
              <p className="ledger-eyebrow mb-2">O que vai acontecer</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ledger-muted">{efeitos.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          {!confirmar ? (
            <button type="button" className="admin-btn admin-btn-primary w-full justify-center" disabled={!destino || motivo.trim().length < 5}
              onClick={() => setConfirmar(true)}>
              {destino === ABERTURA ? <UserRound aria-hidden className="size-4" /> : <ArrowRightLeft aria-hidden className="size-4" />} Transferir maleta
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-4">
              <p className="text-sm text-ledger-text">
                Confirmar: maleta {p.maleta ?? ""} {p.consultora ? `de ${p.consultora} ` : ""}vai para <strong>{nomeDestino}</strong>?
              </p>
              <div className="flex gap-2">
                <button type="button" className="admin-btn flex-1 justify-center" onClick={() => setConfirmar(false)}>Voltar</button>
                <button type="button" className="admin-btn admin-btn-primary flex-1 justify-center" disabled={transferir.isPending} onClick={() => transferir.mutate()}>
                  {transferir.isPending ? "Transferindo…" : "Sim, transferir"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Botão da linha da remessa: abre a transferência numa janela, sem sair da lista. */
export function TransferirMaletaBotao({ cycleId, pracaId, rotulo }: { cycleId: string; pracaId: string | null; rotulo: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <button type="button" className="admin-btn h-9 px-3 text-xs" onClick={() => setAberto(true)} aria-label={`Transferir a maleta de ${rotulo}`}>
        <ArrowRightLeft aria-hidden className="size-3.5" /> Transferir
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Transferir maleta — {rotulo}</DialogTitle>
            <DialogDescription>Para outra consultora da praça ou como abertura do representante. Fica registrado quem fez e o motivo.</DialogDescription>
          </DialogHeader>
          {aberto && <TransferirForm cycleId={cycleId} pracaId={pracaId} onFeito={() => setAberto(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

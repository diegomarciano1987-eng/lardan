import * as React from "react";
import { CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { FotoPeca } from "@/components/FotoPeca";
import { brl, conferir, traduzir, type ItemComposicao } from "@/lib/maletas";
import { TIPO_PECA_LABEL, type TipoPeca } from "@/lib/remessa";
import { useTiposPeca } from "@/lib/tipo-peca";

const ORDEM: TipoPeca[] = ["brinco", "anel", "colar", "pulseira", "tornozeleira", "outro"];

/**
 * Tela de conferência da remessa: tudo que foi bipado, totais por tipo de peça
 * e o botão verde "Conferência feita" com confirmação antes de gravar.
 */
export function ConferenciaMaleta({
  cycleId,
  titulo,
  composicao,
  aoConcluir,
  aoVoltar,
}: {
  cycleId: string;
  titulo: string;
  composicao: ItemComposicao[];
  /** Chamada depois que a conferência é gravada no banco (vai para os documentos). */
  aoConcluir: () => void;
  /** Volta para a bipagem sem gravar nada. */
  aoVoltar: () => void;
}) {
  const [confirmando, setConfirmando] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);

  const tipoDe = useTiposPeca(composicao.map((c) => c.variant_id));
  const totais = React.useMemo(() => {
    const porTipo: Record<TipoPeca, number> = {
      brinco: 0,
      anel: 0,
      colar: 0,
      pulseira: 0,
      tornozeleira: 0,
      outro: 0,
    };
    let pecas = 0;
    let valor = 0;
    for (const c of composicao) {
      porTipo[tipoDe(c.variant_id, c.sku, c.produto)] += c.quantidade;
      pecas += c.quantidade;
      valor += c.quantidade * c.valor_unitario;
    }
    return { porTipo, pecas, valor };
  }, [composicao, tipoDe]);

  async function gravar() {
    setGravando(true);
    try {
      const r = await conferir(cycleId, "Conferência feita na tela de conferência da remessa");
      toast.success(r.repetida ? "Esta maleta já estava conferida." : "Conferência gravada e estoque reservado.");
      aoConcluir();
    } catch (e) {
      toast.error(traduzir(e));
      setGravando(false);
      setConfirmando(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Conferência da remessa" className="fixed inset-0 z-[100] overflow-auto bg-background">
      <div className="mx-auto max-w-[1500px] space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="ledger-eyebrow">Conferência</p>
            <p className="font-display text-2xl font-bold text-ledger-text">{titulo}</p>
          </div>
          <button type="button" className="admin-btn" onClick={aoVoltar}>
            <X aria-hidden className="size-4" /> Voltar à bipagem
          </button>
        </div>

        {/* Cards de totais */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
          <div className="ledger-panel p-5 text-center">
            <p className="ledger-eyebrow">Peças</p>
            <p className="mt-1 font-display text-4xl font-bold tabular-nums text-ledger-text">{totais.pecas}</p>
          </div>
          <div className="ledger-panel p-5 text-center">
            <p className="ledger-eyebrow">Valor total</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ledger-text">{brl(totais.valor)}</p>
          </div>
          {ORDEM.map((t) => (
            <div key={t} className="ledger-panel p-5 text-center">
              <p className="ledger-eyebrow">{TIPO_PECA_LABEL[t]}</p>
              <p className="mt-1 font-display text-4xl font-bold tabular-nums text-ledger-text">
                {totais.porTipo[t]}
              </p>
            </div>
          ))}
        </div>

        {/* Tudo que foi bipado */}
        <div className="ledger-panel p-6">
          <p className="ledger-eyebrow mb-3">Tudo que foi bipado</p>
          {composicao.length === 0 ? (
            <p className="text-sm text-ledger-muted">Sem dados.</p>
          ) : (
            <ul className="max-h-[46vh] divide-y divide-line overflow-auto text-sm">
              {[...composicao]
                .sort((a, b) => a.produto.localeCompare(b.produto))
                .map((c) => (
                  <li key={c.variant_id} className="flex items-center gap-3 py-2">
                    <FotoPeca mediaId={c.media_id} variantId={c.variant_id} className="size-10 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1 truncate">
                      {c.produto}
                      {c.variante ? ` · ${c.variante}` : ""}
                      {c.sku ? <span className="text-ledger-muted"> · {c.sku}</span> : null}
                    </span>
                    <span className="tabular-nums text-ledger-muted">{brl(c.valor_unitario * c.quantidade)}</span>
                    <strong className="tabular-nums">{c.quantidade} un</strong>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {/* Botão verde grande */}
        <button
          type="button"
          disabled={gravando || composicao.length === 0}
          onClick={() => setConfirmando(true)}
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-success py-6 font-display text-2xl font-bold text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
        >
          <CheckCircle2 aria-hidden className="size-8" />
          {gravando ? "Gravando…" : "Conferência feita"}
        </button>
      </div>

      {confirmando && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/50 p-4">
          <div role="alertdialog" aria-modal="true" aria-label="Confirmar conferência" className="w-full max-w-md rounded-2xl border border-line-soft bg-surface p-6 shadow-2xl">
            <p className="font-display text-xl font-bold text-ledger-text">Você conferiu a quantidade?</p>
            <p className="mt-2 text-sm text-ledger-muted">
              São <strong className="text-ledger-text">{totais.pecas} peças</strong> no valor de{" "}
              <strong className="text-ledger-text">{brl(totais.valor)}</strong>. É isso mesmo? Ao
              confirmar, a conferência é gravada e o estoque fica reservado para esta maleta.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="admin-btn admin-btn-primary flex-1 justify-center py-3"
                disabled={gravando}
                onClick={() => void gravar()}
              >
                {gravando ? "Gravando…" : "Sim, está certo"}
              </button>
              <button type="button" className="admin-btn" disabled={gravando} onClick={() => setConfirmando(false)}>
                Revisar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 0280 — ficha da maleta: (1) trocar a remessa/representante responsável sem mexer na consultora
 * nem nas peças; (2) devolução da maleta para a empresa (antes do aceite): pedir, cancelar ou
 * confirmar a chegada — as peças voltam ao estoque na confirmação.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, PackageCheck, Undo2 } from "lucide-react";
import { Panel } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import {
  cancelarDevolucao, devolucoesAbertas, mudarRemessa, pedirDevolucao, receberDevolucao, remessasDestino,
} from "@/lib/maleta-devolucao";

const MUDAR = ["rascunho", "montagem", "conferida", "expedida", "transito", "recebida"];
const DEVOLVER = ["expedida", "transito", "recebida"];
const dataBr = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");

export function RemessaDevolucaoMaleta({ cycleId, status }: { cycleId: string; status: string }) {
  const qc = useQueryClient();
  const [modo, setModo] = React.useState<"" | "remessa" | "devolver">("");
  const [destino, setDestino] = React.useState("");
  const [repDestino, setRepDestino] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const podeMudar = MUDAR.includes(status);
  const podeDevolver = DEVOLVER.includes(status);
  const remessas = useQuery({ queryKey: ["maletas", "remessas-destino", cycleId], queryFn: () => remessasDestino(cycleId), enabled: modo === "remessa" });
  const devol = useQuery({ queryKey: ["maletas", "devolucoes"], queryFn: () => devolucoesAbertas(null), enabled: podeDevolver });
  const pedida = devol.data?.find((d) => d.cycle_id === cycleId) ?? null;
  const fim = () => { setModo(""); setDestino(""); setRepDestino(""); setMotivo(""); void qc.invalidateQueries({ queryKey: ["maletas"] }); };

  const mudar = useMutation({
    mutationFn: () => mudarRemessa(cycleId, destino, motivo),
    onSuccess: (r) => { toast.success(`Maleta passou para a remessa ${r.remessa}.${r.custodia_mudou ? " Ela agora está com o novo representante." : ""}`); fim(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const pedir = useMutation({
    mutationFn: () => pedirDevolucao(cycleId, motivo),
    onSuccess: () => { toast.success("Devolução registrada. Confirme aqui quando a maleta chegar."); fim(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const receber = useMutation({
    mutationFn: () => receberDevolucao(pedida!.id),
    onSuccess: (r) => {
      toast.success(r.repetida ? "Esta devolução já estava confirmada." : `Maleta recebida: ${r.pecas} peças voltaram ao estoque.`);
      if (r.pendencia_fiscal) toast.info("A maleta tinha nota de remessa: ficou uma pendência na remessa para fazer a nota de devolução.", { duration: 9000 });
      fim();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const cancelar = useMutation({
    mutationFn: () => cancelarDevolucao(pedida!.id, "Cancelado pela equipe"),
    onSuccess: () => { toast.success("Pedido de devolução cancelado."); fim(); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!podeMudar && !podeDevolver) return null;
  // 0281: primeiro o representante, depois a remessa dele (inclui remessas finalizadas)
  const SEM = "sem-representante";
  const todas = remessas.data ?? [];
  const reps = Array.from(new Map(todas.map((r) => [r.representante_party_id ?? SEM, r.representante ?? "Sem representante"])).entries())
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
    .map(([value, label]) => ({ value, label, hint: `${todas.filter((r) => (r.representante_party_id ?? SEM) === value).length} remessa(s)` }));
  const opcoes = todas.filter((r) => !repDestino || (r.representante_party_id ?? SEM) === repDestino).map((r) => ({
    value: r.id, label: `Remessa ${r.numero}${r.praca ? ` · ${r.praca}` : ""}`,
    hint: `${r.status === "fechada" ? "Finalizada · " : ""}acerto ${dataBr(r.data_acerto)}${repDestino ? "" : ` · ${r.representante ?? "sem representante"}`}`,
  }));

  return (
    <Panel title="Remessa e devolução">
      <div className="space-y-3 text-sm">
        {pedida && (
          <div className="space-y-2 rounded-xl border border-warning/50 bg-warning/10 p-3">
            <p className="font-semibold">Devolução para a empresa pedida</p>
            <p className="text-xs text-ledger-muted">
              {pedida.origem === "representante" ? `Pedida por ${pedida.representante ?? "representante"}` : "Pedida pela equipe"} em{" "}
              {new Date(pedida.pedido_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {pedida.motivo}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="admin-btn admin-btn-primary" disabled={receber.isPending}
                onClick={() => { if (window.confirm(`Confirmar que a maleta ${pedida.maleta} chegou na empresa? As ${pedida.pecas} peças voltam ao estoque e a maleta é encerrada como devolvida.`)) receber.mutate(); }}>
                <PackageCheck aria-hidden className="size-4" /> {receber.isPending ? "Confirmando…" : "Confirmar chegada e devolver ao estoque"}
              </button>
              <button type="button" className="admin-btn" disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar pedido</button>
            </div>
          </div>
        )}
        {modo === "" && (
          <>
            {podeMudar && (
              <button type="button" className="admin-btn w-full" onClick={() => setModo("remessa")}>
                <ArrowLeftRight aria-hidden className="size-4" /> Mudar remessa e representante
              </button>
            )}
            {podeDevolver && !pedida && (
              <button type="button" className="admin-btn w-full" onClick={() => setModo("devolver")}>
                <Undo2 aria-hidden className="size-4" /> Devolver a maleta para a empresa
              </button>
            )}
          </>
        )}
        {modo !== "" && (
          <div className="space-y-3">
            <p className="text-ledger-muted">
              {modo === "remessa"
                ? "A consultora e as peças continuam as mesmas. Só muda a remessa e o representante responsável; a maleta passa a aparecer no app dele. Se a maleta já está com o representante, ela passa para o novo."
                : "Use quando a consultora não ficou com a maleta e ela vai voltar para a empresa. A entrega para ela é cancelada; quando a maleta chegar, confirme aqui e as peças voltam ao estoque."}
            </p>
            {modo === "remessa" && (
              <>
                <label className="block">
                  <span className="ledger-eyebrow">1. Representante responsável</span>
                  <SmartSelect options={reps} value={repDestino} onChange={(v) => { setRepDestino(v); setDestino(""); }} loading={remessas.isLoading}
                    placeholder="Escolha o representante" searchPlaceholder="Nome do representante" emptyLabel="Nenhuma remessa disponível." />
                </label>
                <label className="block">
                  <span className="ledger-eyebrow">2. Remessa de destino</span>
                  <SmartSelect options={opcoes} value={destino} onChange={setDestino} loading={remessas.isLoading}
                    placeholder={repDestino ? "Escolha a remessa" : "Escolha o representante primeiro (ou digite o número)"}
                    searchPlaceholder="Digite o número da remessa ou a praça" emptyLabel="Nenhuma remessa deste representante." />
                </label>
              </>
            )}
            <label className="block">
              <span className="ledger-eyebrow">Motivo</span>
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                className="mt-1 w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm" />
            </label>
            <div className="flex gap-2">
              <button type="button" className="admin-btn" onClick={() => { setModo(""); setMotivo(""); setDestino(""); setRepDestino(""); }}>Voltar</button>
              <button type="button" className="admin-btn admin-btn-primary flex-1"
                disabled={motivo.trim().length < 5 || (modo === "remessa" && !destino) || mudar.isPending || pedir.isPending}
                onClick={() => (modo === "remessa" ? mudar.mutate() : pedir.mutate())}>
                {modo === "remessa" ? "Mudar remessa" : "Registrar devolução"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

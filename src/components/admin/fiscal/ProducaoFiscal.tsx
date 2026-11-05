/**
 * Emissão REAL (produção) da NF-e pela maleta — painel do Master (0216).
 * Ligar exige o token de produção no Lovable, uma maleta piloto (ou liberar
 * todas) e a confirmação digitada. A trava de série desliga sozinha se a SEFAZ
 * autorizar fora da série configurada.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { focusProducaoDefinir, focusProducaoEstado } from "@/lib/focus/focus.functions";

interface Estado {
  ativa: boolean;
  emissao_ligada: boolean;
  ambiente: string;
  piloto: { cycle_id: string; kit: string; consultora: string | null; status: string; remessa: number | null } | null;
  todas: boolean;
  automatico: boolean;
  serie: string;
  email_copia: string | null;
  observacao: string | null;
  fila: { pendentes: number; com_erro: number; erros: { etapa: string; erro: string | null; consultora: string | null }[] };
  notas_producao: number;
  emails_pendentes: number;
  tokenProducao: boolean;
  faltando: string[];
  podeEmitir: boolean;
}
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Falha.");

export function ProducaoFiscal() {
  const qc = useQueryClient();
  const estadoFn = useServerFn(focusProducaoEstado);
  const definirFn = useServerFn(focusProducaoDefinir);
  const q = useQuery({ queryKey: ["fiscal", "producao"], queryFn: () => estadoFn() as Promise<Estado>, retry: false, refetchInterval: 30_000 });
  const s = q.data;

  const [piloto, setPiloto] = React.useState("");
  const [todas, setTodas] = React.useState(false);
  const [automatico, setAutomatico] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [confirmacao, setConfirmacao] = React.useState("");
  React.useEffect(() => {
    if (!s) return;
    setPiloto(s.piloto?.kit ?? "");
    setTodas(s.todas);
    setAutomatico(s.automatico);
    setEmail(s.email_copia ?? "");
  }, [s?.piloto?.kit, s?.todas, s?.automatico, s?.email_copia]); // eslint-disable-line react-hooks/exhaustive-deps

  const definir = useMutation({
    mutationFn: (ligar: boolean) => definirFn({ data: { ligar, pilotoKit: piloto.trim() || null, todas, automatico, email: email.trim() || null, confirmacao } }),
    onSuccess: (_r, ligar) => {
      toast.success(ligar ? "Emissão real atualizada." : "Emissão real desligada.");
      setConfirmacao("");
      void qc.invalidateQueries({ queryKey: ["fiscal", "producao"] });
      void qc.invalidateQueries({ queryKey: ["fiscal-prontidao"] });
    },
    onError: (e) => toast.error(msgErro(e)),
  });

  if (q.isError) return null; // sem permissão
  return (
    <Panel title="Emissão real da NF-e (produção)">
      {!s ? <Skeleton className="h-24 w-full" /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={s.ativa ? "success" : "neutral"}>{s.ativa ? "Ligada — notas com valor fiscal" : "Desligada — tudo em teste"}</StatusBadge>
            <span className="text-ledger-muted">Série {s.serie} · {s.notas_producao} nota(s) real(is) autorizada(s)</span>
            {!s.tokenProducao && <span className="text-warning">Falta no Lovable: {s.faltando.join(", ")}</span>}
          </div>
          {s.observacao && /desligada automaticamente/i.test(s.observacao) && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-destructive">{s.observacao.split("\n").filter((l) => /desligada automaticamente/i.test(l)).at(-1)}</p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="ledger-eyebrow">Maleta piloto (código, ex.: MAL-00123)</span>
              <input className="admin-input" value={piloto} onChange={(e) => setPiloto(e.target.value)} disabled={!s.podeEmitir} placeholder="MAL-00000" />
              <span className="text-xs text-ledger-muted">
                {s.piloto ? `Atual: ${s.piloto.kit} · ${s.piloto.consultora ?? "sem consultora"} · remessa ${s.piloto.remessa ?? "—"} · ${s.piloto.status}` : "Só esta maleta emite nota real enquanto 'todas' estiver desmarcado."}
              </span>
            </label>
            <label className="grid gap-1.5">
              <span className="ledger-eyebrow">Cópia do XML e DANFE para o escritório</span>
              <input className="admin-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!s.podeEmitir} placeholder="fiscal2@on4.com.br" />
              <span className="text-xs text-ledger-muted">{s.emails_pendentes} nota(s) real(is) aguardando cópia (o sistema reenvia a cada minuto).</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} disabled={!s.podeEmitir} />
              Liberar todas as maletas (depois que o escritório aprovar a nota da piloto)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={automatico} onChange={(e) => setAutomatico(e.target.checked)} disabled={!s.podeEmitir} />
              Automático: remessa ao conferir a maleta e notas do acerto ao encerrar
            </label>
          </div>

          {s.podeEmitir && (
            <div className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-4">
              {!s.emissao_ligada && (
                <label className="grid gap-1.5">
                  <span className="ledger-eyebrow">Para ligar, digite LIGAR PRODUCAO</span>
                  <input className="admin-input" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} placeholder="LIGAR PRODUCAO" />
                </label>
              )}
              <button type="button" className="admin-btn admin-btn-primary" disabled={definir.isPending || !s.tokenProducao || (!s.emissao_ligada && confirmacao !== "LIGAR PRODUCAO")}
                onClick={() => definir.mutate(true)}>
                {s.emissao_ligada ? "Salvar regras" : "Ligar emissão real"}
              </button>
              {s.emissao_ligada && (
                <button type="button" className="admin-btn" disabled={definir.isPending} onClick={() => definir.mutate(false)}>Desligar emissão real</button>
              )}
            </div>
          )}

          <div className="rounded-xl border border-line-soft p-3">
            <p className="ledger-eyebrow">Fila automática</p>
            <p className="mt-1 text-ledger-text">{s.fila.pendentes} aguardando · {s.fila.com_erro} com erro</p>
            {s.fila.erros.map((e, i) => (
              <p key={i} className="mt-1 text-xs text-destructive">{e.consultora ?? "—"} · {e.etapa}: {e.erro}</p>
            ))}
            {s.fila.com_erro > 0 && <p className="mt-1 text-xs text-ledger-muted">Corrija o motivo e use o botão da maleta na tela da remessa para emitir.</p>}
          </div>
        </div>
      )}
    </Panel>
  );
}

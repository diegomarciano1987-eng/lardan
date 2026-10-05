import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ModulePlaceholder } from "@/components/admin/AdminShell";
import { Panel } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { reprocessarAssinados, situacaoClicksign } from "@/lib/clicksign.functions";

export const Route = createFileRoute("/_authenticated/admin/integracoes")({
  component: Integracoes,
  head: () => ({
    meta: [
      { title: "Integrações — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const MODOS = [
  { id: "desligado", rotulo: "Desligado", desc: "Aceite da maleta funciona como hoje, sem termo." },
  { id: "sandbox", rotulo: "Testes (sandbox)", desc: "Exige termo assinado no ambiente de testes da Clicksign." },
  { id: "producao", rotulo: "Produção", desc: "Exige termo assinado de verdade. Só com texto aprovado pelo jurídico." },
] as const;

function Integracoes() {
  const qc = useQueryClient();
  const ler = useServerFn(situacaoClicksign);
  const reproc = useServerFn(reprocessarAssinados);
  const q = useQuery({ queryKey: ["clicksign-situacao"], queryFn: () => ler() });
  const mudar = useMutation({
    mutationFn: async (modo: string) => {
      const { error } = await supabase.rpc("clicksign_modo_definir", { _modo: modo });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Modo da assinatura atualizado.");
      qc.invalidateQueries({ queryKey: ["clicksign-situacao"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const repro = useMutation({
    mutationFn: () => reproc(),
    onSuccess: (r) => toast.success(r.ok ? `Reprocessados ${r.processados}, liberados ${r.finalizados}.` : r.erro),
  });
  const urlAviso = typeof window !== "undefined" ? `${window.location.origin}/api/public/clicksign/webhook` : "";
  const s = q.data;

  return (
    <div className="space-y-6">
      <Panel title="Clicksign — termo de recebimento da maleta">
        {!s ? (
          <p className="text-sm text-ledger-muted">Carregando…</p>
        ) : (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="ledger-eyebrow">Modo atual</p>
                <p className="mt-1 text-lg font-semibold">{MODOS.find((m) => m.id === s.modo)?.rotulo}</p>
              </div>
              <div>
                <p className="ledger-eyebrow">Testes</p>
                <p className="mt-1 font-semibold">{s.sandboxPronto ? "Configurado" : "Clicksign não configurada"}</p>
              </div>
              <div>
                <p className="ledger-eyebrow">Produção</p>
                <p className="mt-1 font-semibold">{s.producaoPronto ? "Configurado" : "Clicksign não configurada"}</p>
              </div>
              <div>
                <p className="ledger-eyebrow">Texto do termo</p>
                <p className="mt-1 font-semibold">{s.aprovado ? `Aprovado (${s.versao})` : `Rascunho pendente de revisão jurídica (${s.versao})`}</p>
              </div>
            </div>
            {s.master && s.faltando.length > 0 && (
              <p className="text-ledger-muted">Falta configurar: {s.faltando.join(", ")}.</p>
            )}
            <div>
              <p className="ledger-eyebrow">Endereço de aviso (cadastrar na Clicksign)</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-lg border border-line-soft px-3 py-2">{urlAviso}</code>
                <button type="button" className="admin-btn min-h-10" onClick={() => navigator.clipboard.writeText(urlAviso).then(() => toast.success("Copiado."))}>
                  Copiar
                </button>
              </div>
            </div>
            {s.master && (
              <div className="grid gap-3 md:grid-cols-3">
                {MODOS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={mudar.isPending || s.modo === m.id}
                    onClick={() => {
                      if (m.id !== "desligado" && !confirm(`Ativar "${m.rotulo}"? A partir daí, nenhuma maleta é liberada sem termo assinado.`)) return;
                      mudar.mutate(m.id);
                    }}
                    className={`rounded-xl border p-4 text-left ${s.modo === m.id ? "border-primary bg-surface" : "border-line-soft"}`}
                  >
                    <p className="font-semibold">{m.rotulo}</p>
                    <p className="mt-1 text-xs text-ledger-muted">{m.desc}</p>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="admin-btn min-h-10" disabled={repro.isPending} onClick={() => repro.mutate()}>
              Reprocessar termos assinados pendentes
            </button>
          </div>
        )}
      </Panel>
      <ModulePlaceholder slug="integracoes" />
    </div>
  );
}

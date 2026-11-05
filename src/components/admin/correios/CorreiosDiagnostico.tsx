/**
 * Integrações › Correios (etapa 1): testa a conexão com o contrato, lista os
 * serviços do contrato e mostra preço e prazo da caixa padrão da maleta
 * (40×30×10 cm, 1 kg) até um CEP. Só Master. Nada é postado nem cobrado.
 */
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel, StatusBadge } from "@/components/admin/ui";
import { correiosDiagnostico, correiosRastro } from "@/lib/correios/correios.functions";

type Resultado = Awaited<ReturnType<typeof correiosDiagnostico>>;
const json = (v: unknown) => JSON.stringify(v, null, 2);

export function CorreiosDiagnostico({ master }: { master: boolean }) {
  const diagFn = useServerFn(correiosDiagnostico);
  const rastroFn = useServerFn(correiosRastro);
  const [cep, setCep] = React.useState("15520011");
  const [codigos, setCodigos] = React.useState("");
  const [objeto, setObjeto] = React.useState("");
  const diag = useMutation({
    mutationFn: () => diagFn({ data: { cepDestino: cep, codigos: codigos.split(/[\s,;]+/).filter(Boolean) } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha."),
  });
  const rastro = useMutation({
    mutationFn: () => rastroFn({ data: { codigo: objeto } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha."),
  });
  if (!master) return null;
  const r = diag.data as (Resultado & Record<string, unknown>) | undefined;

  return (
    <Panel title="Correios — conexão com o contrato (etapa 1)">
      <div className="space-y-4 text-sm">
        <p className="text-ledger-muted">Confere o contrato e descobre os códigos reais do PAC (ida) e do PAC reverso (volta), com preço e prazo da caixa padrão. Não posta nada e não gera cobrança.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1"><span className="ledger-eyebrow">CEP de destino</span>
            <input className="admin-input w-36" value={cep} onChange={(e) => setCep(e.target.value)} /></label>
          <label className="grid gap-1"><span className="ledger-eyebrow">Códigos extras (opcional)</span>
            <input className="admin-input w-56" value={codigos} onChange={(e) => setCodigos(e.target.value)} placeholder="03298, 03301" /></label>
          <Button type="button" disabled={diag.isPending} onClick={() => diag.mutate()}>
            {diag.isPending ? "Testando…" : "Testar conexão"}
          </Button>
        </div>
        {r && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone={r.ok ? "success" : "danger"}>{r.ok ? "Conectado" : `Falhou em: ${String(r["etapa"])}`}</StatusBadge>
              <span className="text-ledger-muted">Ambiente: {String(r["ambiente"])} · origem {String(r["cepOrigem"])}</span>
            </div>
            {Array.isArray(r["faltando"]) && (r["faltando"] as string[]).length > 0 && <p className="text-warning">Falta no Lovable: {(r["faltando"] as string[]).join(", ")}</p>}
            {r["erro"] ? <p className="text-destructive">{String(r["erro"])}</p> : null}
            <pre className="max-h-96 overflow-auto rounded-md bg-surface-muted p-3 text-xs">{json(r)}</pre>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-3">
          <label className="grid gap-1"><span className="ledger-eyebrow">Rastrear um objeto</span>
            <input className="admin-input w-48" value={objeto} onChange={(e) => setObjeto(e.target.value)} placeholder="AB123456789BR" /></label>
          <Button type="button" variant="outline" disabled={rastro.isPending} onClick={() => rastro.mutate()}>Rastrear</Button>
        </div>
        {rastro.data != null && <pre className="max-h-72 overflow-auto rounded-md bg-surface-muted p-3 text-xs">{json(rastro.data)}</pre>}
      </div>
    </Panel>
  );
}

/**
 * Integrações › Assinatura digital (ZapSign) — 0224.
 * Mostra se a ZapSign está configurada, o endereço do aviso para cadastrar
 * lá, e deixa o Master editar os textos do contrato e da promissória.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { zapsignEstado, zapsignModeloSalvar } from "@/lib/zapsign/zapsign.functions";

interface Modelo { tipo: "contrato" | "promissoria"; titulo: string; texto: string; revisado: boolean; atualizado_em: string }
const CAMPOS = "{{nome}} {{cpf}} {{codigo}} {{endereco}} {{bairro}} {{cidade}} {{cep}} {{whatsapp}} {{representante}} {{praca}} {{maleta}} {{remessa}} {{valor}} {{valor_extenso}} {{vencimento}} {{vencimento_extenso}} {{hoje}} {{hoje_extenso}}";

export function AssinaturaConfig({ master }: { master: boolean }) {
  const estadoFn = useServerFn(zapsignEstado);
  const estado = useQuery({ queryKey: ["zapsign", "estado"], queryFn: () => estadoFn(), retry: false });
  const modelos = useQuery({
    queryKey: ["zapsign", "modelos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("assinatura_modelos_ler" as never);
      if (error) throw error;
      return data as unknown as Modelo[];
    },
    retry: false,
  });
  if (modelos.isError && estado.isError) return null;
  const s = estado.data;
  const url = typeof window !== "undefined" ? `${window.location.origin}/api/public/zapsign/webhook?chave=SEU_ZAPSIGN_WEBHOOK_SECRET` : "";
  return (
    <Panel title="Assinatura digital (ZapSign) — contrato e promissória">
      {!s ? <Skeleton className="h-16 w-full" /> : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={s.pronto ? "success" : "warning"}>{s.pronto ? `Configurada · ${s.ambiente === "sandbox" ? "testes (sandbox)" : "produção"}` : "Não configurada"}</StatusBadge>
            {s.faltando.length > 0 && <span className="text-warning">Falta no Lovable: {s.faltando.join(", ")}</span>}
          </div>
          <div className="rounded-xl border border-line-soft p-3">
            <p className="ledger-eyebrow">Aviso automático (cadastrar na ZapSign › Configurações › Integração › Webhooks)</p>
            <p className="mt-1 break-all font-mono text-xs">{url}</p>
            <p className="mt-1 text-xs text-ledger-muted">Troque SEU_ZAPSIGN_WEBHOOK_SECRET pelo valor do segredo ZAPSIGN_WEBHOOK_SECRET. Sem o aviso, a situação atualiza quando alguém abre o documento assinado.</p>
          </div>
          {(modelos.data ?? []).map((m) => <EditorModelo key={m.tipo} m={m} master={master} />)}
          <p className="text-xs text-ledger-muted">Campos disponíveis: {CAMPOS}</p>
        </div>
      )}
    </Panel>
  );
}

function EditorModelo({ m, master }: { m: Modelo; master: boolean }) {
  const qc = useQueryClient();
  const salvarFn = useServerFn(zapsignModeloSalvar);
  const [titulo, setTitulo] = React.useState(m.titulo);
  const [texto, setTexto] = React.useState(m.texto);
  const [revisado, setRevisado] = React.useState(m.revisado);
  const salvar = useMutation({
    mutationFn: () => salvarFn({ data: { tipo: m.tipo, titulo, texto, revisado } }),
    onSuccess: () => { toast.success("Modelo salvo."); void qc.invalidateQueries({ queryKey: ["zapsign", "modelos"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha."),
  });
  return (
    <div className="space-y-2 rounded-xl border border-line-soft p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ledger-text">{m.tipo === "contrato" ? "Contrato de consignação" : "Nota promissória"}</p>
        <StatusBadge tone={m.revisado ? "success" : "warning"}>{m.revisado ? "Revisado" : "Rascunho — revisar com o jurídico"}</StatusBadge>
      </div>
      <input className="admin-input w-full" value={titulo} onChange={(e) => setTitulo(e.target.value)} disabled={!master} />
      <textarea className="admin-input min-h-56 w-full font-mono text-xs" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!master} />
      {master && (
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} /> Texto revisado pelo jurídico</label>
          <button type="button" className="admin-btn admin-btn-primary" disabled={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</button>
        </div>
      )}
    </div>
  );
}

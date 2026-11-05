/**
 * Maleta pelos Correios (0236): ida por PAC com valor declarado, rastreio, 30 dias contando da
 * entrega e "Liberar volta" (reversa PAC) depois do acerto fechado, com o código por WhatsApp.
 * Toda chamada à API acontece no servidor; aqui só a tela.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Package, Truck } from "lucide-react";
import { Panel, StatusBadge, type StatusTone } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import {
  correiosCancelarEnvio, correiosEnviarMaleta, correiosEtiqueta, correiosPreviaEnvio, correiosRastrearMaleta,
} from "@/lib/correios/correios.functions";

interface Envio {
  id: string; direcao: "ida" | "volta"; status: string; codigo_objeto: string | null; frete_cents: number | null;
  valor_declarado_cents: number; previsto_entrega: string | null; postado_em: string | null; entregue_em: string | null;
  codigo_enviado_em: string | null; limite_postagem: string | null; tem_rotulo: boolean; erro: string | null; ambiente: string;
  ultimo_evento: string | null; consultora: string | null; debito_liberado_motivo: string | null; whatsapp: string | null;
}
const STATUS: Record<string, { r: string; t: StatusTone }> = {
  criando: { r: "Gerando", t: "neutral" }, pre_postada: { r: "Etiqueta gerada", t: "warning" }, postada: { r: "Postada", t: "info" },
  em_transito: { r: "Em trânsito", t: "info" }, entregue: { r: "Entregue", t: "success" }, erro: { r: "Erro", t: "danger" },
  cancelada: { r: "Cancelada", t: "neutral" }, expirada: { r: "Expirada", t: "neutral" },
};
const brl = (c: number | null | undefined) => (c == null ? "—" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dt = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("pt-BR") : "—");
const RASTREIO = (c: string) => `https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(c)}`;

function textoWhatsapp(e: Envio, limite: string) {
  return `Olá${e.consultora ? `, ${e.consultora.split(" ")[0]}` : ""}! Seu acerto foi fechado. Para devolver a maleta pelos Correios, ` +
    `leve a caixa fechada a uma agência e informe o código de postagem ${e.codigo_objeto}. ` +
    `Você não paga nada. Prazo para postar: até ${limite}. Qualquer dúvida, fale com a gente.`;
}

export function CorreiosMaleta({ cycleId, status }: { cycleId: string; status: string }) {
  const qc = useQueryClient();
  const previaFn = useServerFn(correiosPreviaEnvio);
  const enviarFn = useServerFn(correiosEnviarMaleta);
  const etiquetaFn = useServerFn(correiosEtiqueta);
  const rastroFn = useServerFn(correiosRastrearMaleta);
  const cancelarFn = useServerFn(correiosCancelarEnvio);
  const [direcao, setDirecao] = React.useState<"ida" | "volta" | null>(null);
  const [liberar, setLiberar] = React.useState("");

  const painel = useQuery({
    queryKey: ["correios-painel", cycleId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("correios_painel" as never, { _cycle: cycleId } as never);
      if (error) throw error;
      return data as unknown as { envios: Envio[] };
    },
  });
  const previa = useQuery({
    queryKey: ["correios-previa", cycleId, direcao],
    enabled: !!direcao,
    queryFn: () => previaFn({ data: { cycleId, direcao: direcao! } }),
    retry: false,
  });
  const atualizar = () => { void qc.invalidateQueries({ queryKey: ["correios-painel", cycleId] }); };
  const enviar = useMutation({
    mutationFn: () => enviarFn({ data: { cycleId, direcao: direcao!, liberarDebito: liberar || null } }),
    onSuccess: (r) => {
      toast.success(`Pré-postagem criada: ${r.codigoObjeto}`);
      if (r.rotulo) window.open(r.rotulo, "_blank", "noopener,noreferrer"); else if (r.aviso) toast.warning(r.aviso);
      setDirecao(null); setLiberar(""); atualizar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha."),
  });
  const etiqueta = useMutation({
    mutationFn: (id: string) => etiquetaFn({ data: { envioId: id } }),
    onSuccess: (r) => { window.open(r.url, "_blank", "noopener,noreferrer"); atualizar(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha."),
  });
  const rastrear = useMutation({
    mutationFn: () => rastroFn({ data: { cycleId } }),
    onSuccess: (r) => { toast.success(r.consultados ? `Rastreio atualizado (${r.consultados}).` : "Nada para rastrear."); atualizar(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha."),
  });
  const cancelar = useMutation({
    mutationFn: (p: { id: string; motivo: string }) => cancelarFn({ data: { envioId: p.id, motivo: p.motivo } }),
    onSuccess: () => { toast.success("Envio cancelado."); atualizar(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha."),
  });
  const codigoEnviado = useMutation({
    mutationFn: async (e: Envio) => {
      const { data, error } = await supabase.rpc("correios_volta_codigo_enviado" as never, { _id: e.id } as never);
      if (error) throw error;
      return { e, r: data as unknown as { limite_postagem: string } };
    },
    onSuccess: ({ e, r }) => {
      const fone = (e.whatsapp ?? "").replace(/\D/g, "");
      const url = `https://wa.me/${fone ? (fone.startsWith("55") ? fone : `55${fone}`) : ""}?text=${encodeURIComponent(textoWhatsapp(e, dt(r.limite_postagem)))}`;
      window.open(url, "_blank", "noopener,noreferrer");
      atualizar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha."),
  });

  const envios = painel.data?.envios ?? [];
  const viva = (d: "ida" | "volta") => envios.find((e) => e.direcao === d && !["erro", "cancelada", "expirada"].includes(e.status));
  const podeIda = ["conferida", "expedida"].includes(status) && !viva("ida");
  const podeVolta = ["acerto", "operacao", "encerrada"].includes(status) && !viva("volta");
  const p = previa.data;
  const temDebito = (p?.debito_vencido_cents ?? 0) > 0 && direcao === "ida";
  const bloqueio = p ? p.pendencias.filter((x) => !x.startsWith("peça sem custo")) : [];

  return (
    <Panel title="Correios">
      <div className="space-y-4 text-sm">
        {envios.length === 0 && !direcao && <p className="text-ledger-muted">Nenhum envio pelos Correios nesta maleta.</p>}
        {envios.map((e) => (
          <div key={e.id} className="space-y-2 rounded-xl border border-line-soft p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-semibold">
                {e.direcao === "ida" ? <Truck aria-hidden className="size-4" /> : <Package aria-hidden className="size-4" />}
                {e.direcao === "ida" ? "Ida (PAC)" : "Volta (PAC reverso)"}
                {e.codigo_objeto && <a className="admin-link font-mono" href={RASTREIO(e.codigo_objeto)} target="_blank" rel="noreferrer">{e.codigo_objeto}</a>}
              </p>
              <StatusBadge tone={STATUS[e.status]?.t ?? "neutral"}>{STATUS[e.status]?.r ?? e.status}</StatusBadge>
            </div>
            <p className="text-xs text-ledger-muted">
              Frete {brl(e.frete_cents)} · valor declarado {brl(e.valor_declarado_cents)}
              {e.postado_em ? ` · postada ${dt(e.postado_em)}` : ""}{e.entregue_em ? ` · entregue ${dt(e.entregue_em)}` : ""}
              {e.direcao === "ida" && e.entregue_em ? " · 30 dias de venda contam da entrega" : ""}
              {e.limite_postagem ? ` · postar até ${dt(e.limite_postagem)}` : ""}{e.ambiente !== "producao" ? " · homologação" : ""}
            </p>
            {e.ultimo_evento && <p className="text-xs">Último evento: {e.ultimo_evento}</p>}
            {e.debito_liberado_motivo && <p className="text-xs text-warning">Liberada com débito: {e.debito_liberado_motivo}</p>}
            {e.erro && <p className="text-xs text-destructive">{e.erro}</p>}
            <div className="flex flex-wrap gap-2">
              {e.codigo_objeto && e.status !== "cancelada" && (
                <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={etiqueta.isPending} onClick={() => etiqueta.mutate(e.id)}>Baixar etiqueta</button>
              )}
              {e.direcao === "volta" && e.codigo_objeto && e.status === "pre_postada" && (
                <button type="button" className="admin-btn admin-btn-primary h-9 px-3 text-xs" disabled={codigoEnviado.isPending}
                  onClick={() => codigoEnviado.mutate(e)}>{e.codigo_enviado_em ? "Mandar código de novo (WhatsApp)" : "Mandar código no WhatsApp"}</button>
              )}
              {["pre_postada", "criando"].includes(e.status) && (
                <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={cancelar.isPending}
                  onClick={() => { const m = window.prompt("Motivo do cancelamento:"); if (m && m.trim().length >= 3) cancelar.mutate({ id: e.id, motivo: m }); }}>Cancelar envio</button>
              )}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          {podeIda && <button type="button" className="admin-btn admin-btn-primary" onClick={() => setDirecao("ida")}>Enviar pelos Correios</button>}
          {podeVolta && <button type="button" className="admin-btn admin-btn-primary" onClick={() => setDirecao("volta")}>Liberar volta</button>}
          {envios.some((e) => e.codigo_objeto && ["pre_postada", "postada", "em_transito"].includes(e.status)) && (
            <button type="button" className="admin-btn" disabled={rastrear.isPending} onClick={() => rastrear.mutate()}>{rastrear.isPending ? "Rastreando…" : "Atualizar rastreio"}</button>
          )}
        </div>

        {direcao && (
          <div className="space-y-3 rounded-xl bg-surface-muted p-4">
            <p className="font-semibold">{direcao === "ida" ? "Enviar a maleta (PAC, caixa 40×30×10 cm, 1 kg)" : "Liberar a volta (logística reversa PAC)"}</p>
            {previa.isLoading && <p className="text-ledger-muted">Conferindo dados e cotando…</p>}
            {previa.error && <p className="text-destructive">{(previa.error as Error).message}</p>}
            {p && (
              <>
                <ul className="space-y-1">
                  <li>Para: <strong>{p.destinatario?.nome}</strong> — {p.destinatario?.logradouro}, {p.destinatario?.numero} · {p.destinatario?.bairro} · {p.destinatario?.cidade}/{p.destinatario?.uf} · CEP {p.destinatario?.cep}</li>
                  <li>Valor declarado (custo das peças): <strong>{brl(p.valor_declarado_cents)}</strong></li>
                  <li>Frete estimado: <strong>{brl(p.cotacao.frete_cents)}</strong>{p.cotacao.prazo_dias ? ` · ${p.cotacao.prazo_dias} dias úteis` : ""}{p.ambiente !== "producao" ? " · homologação" : ""}</li>
                  {direcao === "volta" && <li>A consultora recebe o código e tem 5 dias para postar, contados do envio do código.</li>}
                </ul>
                {p.pendencias.length > 0 && <p className="text-warning">Atenção: {p.pendencias.join("; ")}.</p>}
                {temDebito && (
                  <div className="space-y-2 rounded-lg border border-destructive/40 p-3">
                    <p className="text-destructive">Consultora com débito vencido de <strong>{brl(p.debito_vencido_cents)}</strong>. A maleta não sai pelo correio.</p>
                    <label className="grid gap-1"><span className="ledger-eyebrow">Liberar mesmo assim (Daniel ou Master) — motivo</span>
                      <input className="admin-input" value={liberar} onChange={(e) => setLiberar(e.target.value)} placeholder="Ex.: acordo assinado em 05/11" /></label>
                  </div>
                )}
                {!p.configurado && <p className="text-destructive">Correios não configurado no servidor.</p>}
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="admin-btn admin-btn-primary"
                disabled={!p || !p.configurado || bloqueio.length > 0 || enviar.isPending || (temDebito && liberar.trim().length < 3)}
                onClick={() => enviar.mutate()}>
                {enviar.isPending ? "Gerando etiqueta…" : direcao === "ida" ? "Gerar etiqueta de envio" : "Gerar código da volta"}
              </button>
              <button type="button" className="admin-btn" onClick={() => { setDirecao(null); setLiberar(""); }}>Voltar</button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

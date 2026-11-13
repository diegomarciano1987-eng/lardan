/**
 * 0306 — situação do cadastro da cliente no Asaas (espelho do Lardan): igual, atualizando ou com pontos para conferir.
 * Botão azul Asaas "Atualizar cadastro no Asaas" (confere agora). Desde 13/11/2026 só vale o Lardan: não há mais
 * "Usar o do Lardan" — o que difere vai sozinho; só CPF diferente fica para uma pessoa.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { espelharClienteAgora } from "@/lib/asaas/cliente-espelho.functions";
import { ROTULO, resumoEspelho, type Diferenca } from "@/lib/asaas/cliente-espelho";
import { dataBR } from "@/lib/cobranca";

type Situacao = {
  vinculadas: number;
  clientes: { external_id: string; estado: string; diferencas: Diferenca[]; erro: string | null; conferido_em: string | null; enviado_em: string | null }[];
  ultimas: { external_id: string; campos: Record<string, { de: string | null; para: string | null }>; origem: string; criado_em: string }[];
};

const ACAO: Record<string, string> = { so_no_asaas: "Só no Asaas", conferir: "Conferir", recusado: "Asaas recusou", enviar: "Enviado do Lardan" };

export function EspelhoAsaasCadastro({ partyId }: { partyId: string }) {
  const qc = useQueryClient();
  const fn = useServerFn(espelharClienteAgora);
  const [rodando, setRodando] = React.useState(false);
  const q = useQuery({
    queryKey: ["cob", "espelho-asaas", partyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("asaas_cliente_espelho_situacao" as never, { _party: partyId } as never);
      if (error) throw error;
      return data as unknown as Situacao;
    },
  });
  const s = q.data;
  if (q.isLoading || !s) return null;
  if (!s.vinculadas) return null;

  const difs = s.clientes.flatMap((c) => c.diferencas ?? []);
  const estados = s.clientes.map((c) => c.estado);
  const estado = estados.find((e) => e === "erro") ?? estados.find((e) => e === "pendente" || e === "processando")
    ?? estados.find((e) => e === "diferente") ?? estados[0] ?? null;
  const r = resumoEspelho(estado, difs);
  const ultimo = s.clientes.map((c) => c.conferido_em).filter(Boolean).sort().pop();

  const rodar = async () => {
    setRodando(true);
    try {
      const x = await fn({ data: { partyId, forcar: false } });
      if (x.semCadastro) toast.error("Esta cliente não tem cadastro ligado no Asaas.");
      else if (x.erros) toast.error("O Asaas não respondeu agora. A rotina tenta de novo sozinha em alguns minutos.");
      else if (x.atualizadas) toast.success("Cadastro atualizado no Asaas e conferido de novo.");
      else if (x.diferentes) toast.warning("Conferido: há pontos para você olhar abaixo.");
      else toast.success("Conferido: o Asaas já está igual ao Lardan.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar no Asaas.");
    } finally {
      setRodando(false);
      void qc.invalidateQueries({ queryKey: ["cob", "espelho-asaas", partyId] });
    }
  };

  const Icone = r.tom === "ok" ? CheckCircle2 : r.tom === "espera" ? Clock : AlertTriangle;
  return (
    <section className="space-y-3 rounded-xl border border-asaas/40 bg-asaas/5 p-4" data-espelho-asaas="">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Icone aria-hidden className={`size-4 ${r.tom === "ok" ? "text-success" : r.tom === "erro" ? "text-danger" : "text-asaas"}`} />
          <span className="font-semibold">Cadastro no Asaas:</span> <span>{r.texto}</span>
          {ultimo && <span className="text-xs text-muted-foreground">· conferido em {dataBR(ultimo.slice(0, 10))}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => rodar()} disabled={rodando}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-asaas px-3 text-xs font-semibold text-asaas-foreground disabled:opacity-60">
            <RefreshCw aria-hidden className={`size-3.5 ${rodando ? "animate-spin" : ""}`} />{rodando ? "Conferindo…" : "Atualizar cadastro no Asaas"}
          </button>
        </div>
      </div>
      {difs.filter((x) => x.acao !== "enviar" || estado === "erro").length > 0 && (
        <ul className="space-y-1.5 px-1 text-sm">
          {difs.filter((x) => x.acao !== "enviar" || estado === "erro").map((x, i) => (
            <li key={`${x.campo}-${i}`} className="flex flex-wrap gap-x-2">
              <span className="rounded bg-card px-1.5 text-xs font-semibold">{ACAO[x.acao] ?? x.acao}</span>
              <span className="font-medium">{ROTULO[x.campo]}:</span>
              {x.campo !== "avisos" && <><span>Lardan {x.lardan ?? "vazio"}</span><span className="text-muted-foreground">· Asaas {x.asaas ?? "vazio"}</span></>}
              {x.nota && <span className="w-full text-xs text-muted-foreground">{x.nota}</span>}
            </li>
          ))}
        </ul>
      )}
      {s.ultimas.length > 0 && (
        <details className="px-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Últimas atualizações enviadas ao Asaas</summary>
          <ul className="mt-2 space-y-1">
            {s.ultimas.map((u, i) => (
              <li key={i}>{dataBR(u.criado_em.slice(0, 10))} · {u.origem === "botao" ? "pelo botão" : "automático"} · {Object.entries(u.campos).map(([k, v]) => `${ROTULO[k as keyof typeof ROTULO] ?? k}: ${v.de ?? "vazio"} → ${v.para ?? "vazio"}`).join("; ")}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

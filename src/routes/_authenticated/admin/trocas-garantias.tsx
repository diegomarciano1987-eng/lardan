import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/admin/ui";
import { useAdminRoles } from "@/components/admin/AdminShell";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { supabase } from "@/integrations/supabase/client";
import { traduzir } from "@/lib/maletas";
export const Route = createFileRoute("/_authenticated/admin/trocas-garantias")({ component: Analise, head: () => ({ meta: [
  { title: "Trocas e garantias — LARDAN Cloud" }, { name: "description", content: "Análise auditada de trocas e garantias das consultoras Lardan." }, { property: "og:title", content: "Trocas e garantias — LARDAN" }, { property: "og:description", content: "Solicitações de pós-venda e acompanhamento da análise." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" },
] }) });
const STATUS = { aberta: "Aberta", em_analise: "Em análise", aprovada: "Aprovada", recusada: "Recusada", resolvida: "Resolvida" };
function Analise() {
  const roles = useAdminRoles(); const pode = roles.includes("master") || roles.includes("qualidade");
  const qc = useQueryClient(); const [status, setStatus] = React.useState("aberta");
  const q = useQuery({ queryKey: ["admin", "pos-venda", status], enabled: pode, queryFn: async () => { const { data, error } = await supabase.from("consultora_pos_venda").select("*").eq("status", status).order("created_at", { ascending: true }).limit(100); if (error) throw error; return data; } });
  const [selecionada, setSelecionada] = React.useState(""); const [resposta, setResposta] = React.useState(""); const [destino, setDestino] = React.useState("em_analise");
  const [fotos, setFotos] = React.useState<string[]>([]);
  const r = q.data?.find((i) => i.id === selecionada);
  const historico = useQuery({ queryKey: ["admin", "pos-venda-eventos", r?.id], enabled: pode && !!r, queryFn: async () => { const { data, error } = await supabase.from("consultora_pos_venda_eventos").select("id,status,resposta,created_at").eq("request_id", r?.id ?? "").order("created_at"); if (error) throw error; return data; } });
  const m = useMutation({ mutationFn: async () => { if (!r) throw new Error("Selecione a solicitação."); const { error } = await supabase.rpc("consultora_pos_venda_analisar", { _id: r.id, _status: destino, _resposta: resposta }); if (error) throw error; }, onSuccess: () => { toast.success("Análise registrada com histórico."); setSelecionada(""); setResposta(""); setFotos([]); void qc.invalidateQueries({ queryKey: ["admin", "pos-venda"] }); }, onError: (e) => toast.error(traduzir(e)) });
  const verFotos = useMutation({ mutationFn: async () => { if (!r || !Array.isArray(r.fotos)) return []; const urls: string[] = []; for (const p of r.fotos) { if (typeof p !== "string") continue; const { data, error } = await supabase.storage.from("consultora-pos-venda").createSignedUrl(p, 300); if (error) throw error; urls.push(data.signedUrl); } return urls; }, onSuccess: setFotos, onError: (e) => toast.error(traduzir(e)) });
  if (!pode) return <p role="alert">Acesso não liberado para análise de trocas e garantias.</p>;
  const snap = r?.snapshot as { produto?: string; cliente?: string; pedido?: string; quantidade?: number } | undefined;
  return <div className="space-y-6"><PageHeader title="Trocas e garantias" subtitle="Pós-venda" /><SmartSelect value={status} onChange={(v) => { setStatus(v); setSelecionada(""); setFotos([]); }} options={Object.entries(STATUS).map(([value, label]) => ({ value, label }))} />
    {q.isLoading && <p>Carregando solicitações…</p>}{q.isError && <p role="alert">{traduzir(q.error)}</p>}{q.data?.length === 0 && <p>Sem solicitações nesta situação.</p>}
    <div className="grid gap-6 xl:grid-cols-2"><ul className="space-y-3">{q.data?.map((i) => <li key={i.id}><Button variant={selecionada === i.id ? "default" : "outline"} className="h-auto w-full justify-start whitespace-normal px-5 py-4 text-left" onClick={() => { setSelecionada(i.id); setFotos([]); setResposta(""); setDestino(i.status === "aberta" ? "em_analise" : i.status === "aprovada" ? "resolvida" : "aprovada"); }}>TG-{String(i.protocolo).padStart(6, "0")} · {i.tipo} · {i.motivo}{i.excecao ? " · Exceção solicitada" : ""}</Button></li>)}</ul>
      {r && <Panel title={`TG-${String(r.protocolo).padStart(6, "0")}`}><div className="space-y-4"><p>{snap?.produto} · {snap?.quantidade} peças</p><p>{snap?.cliente} · Pedido {snap?.pedido}</p><p>Compra: {r.compra_em} · Solução solicitada: {r.solucao}</p><p>{r.motivo}{r.observacao ? ` · ${r.observacao}` : ""}</p>{r.excecao && <p className="font-semibold text-warning">Fora do prazo; exceção depende de análise.</p>}<Button variant="outline" disabled={verFotos.isPending} onClick={() => verFotos.mutate()}>Ver fotos privadas</Button><div className="grid grid-cols-3 gap-2">{fotos.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Foto da peça enviada para análise" className="aspect-square w-full object-contain" /></a>)}</div><ul className="divide-y divide-border">{historico.data?.map((e) => <li key={e.id} className="py-3">{STATUS[e.status as keyof typeof STATUS] ?? e.status} · {new Date(e.created_at).toLocaleString("pt-BR")}{e.resposta && <p>{e.resposta}</p>}</li>)}</ul>
      {!["recusada", "resolvida"].includes(r.status) && <><SmartSelect value={destino} onChange={setDestino} options={(r.status === "aberta" ? ["em_analise"] : r.status === "em_analise" ? ["aprovada", "recusada"] : ["resolvida"]).map((value) => ({ value, label: STATUS[value as keyof typeof STATUS] }))} /><label htmlFor="resposta-pos-venda">Resposta e encaminhamento</label><textarea id="resposta-pos-venda" className="admin-input min-h-28" value={resposta} maxLength={2000} onChange={(e) => setResposta(e.target.value)} /><Button disabled={m.isPending || resposta.trim().length < 5} onClick={() => m.mutate()}>Registrar análise</Button></>}</div></Panel>}
    </div></div>;
}
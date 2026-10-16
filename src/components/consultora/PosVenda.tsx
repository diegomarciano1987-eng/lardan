import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { supabase } from "@/integrations/supabase/client";
import { detalhePedido, traduzir } from "@/lib/maletas";
import { dentroPrazoTroca, fimGarantia } from "@/lib/consultora-regras";

export function AbrirPosVenda({ pedido }: { pedido: string }) {
  const [aberto, setAberto] = React.useState(false);
  return <><Button variant="outline" className="h-auto min-h-12" onClick={() => setAberto(true)}>Troca ou garantia</Button><Dialog open={aberto} onOpenChange={setAberto}><DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Troca ou garantia</DialogTitle><DialogDescription>Troca em até 45 dias · garantia de dois anos seguindo o manual</DialogDescription></DialogHeader>{aberto && <Formulario pedido={pedido} />}</DialogContent></Dialog></>;
}
function Formulario({ pedido }: { pedido: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["consultora", "pedido", pedido], queryFn: () => detalhePedido(pedido) });
  const [passo, setPasso] = React.useState(1);
  const [item, setItem] = React.useState("");
  const [tipo, setTipo] = React.useState("troca");
  const [motivo, setMotivo] = React.useState("");
  const [obs, setObs] = React.useState("");
  const [solucao, setSolucao] = React.useState("reposicao");
  const [fotos, setFotos] = React.useState<File[]>([]);
  const [excecao, setExcecao] = React.useState(false);
  const [protocolo, setProtocolo] = React.useState("");
  const [chave] = React.useState(() => crypto.randomUUID());
  const compra = q.data?.pedido.created_at.slice(0, 10) ?? "";
  const hoje = new Date().toISOString().slice(0, 10);
  const dentro = compra ? tipo === "troca" ? dentroPrazoTroca(compra, hoje) : hoje <= fimGarantia(compra) : false;
  const m = useMutation({ mutationFn: async () => {
    const { data: auth, error: authErro } = await supabase.auth.getUser();
    if (authErro || !auth.user) throw new Error("Entre novamente para continuar.");
    const paths: string[] = [];
    for (let i = 0; i < fotos.length; i++) {
      const f = fotos[i]; if (!f) continue;
      const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
      const path = `${auth.user.id}/${chave}/${i}.${ext}`;
      const { error } = await supabase.storage.from("consultora-pos-venda").upload(path, f, { contentType: f.type, upsert: false });
      if (error && error.message !== "The resource already exists") throw error;
      paths.push(path);
    }
    const { data, error } = await supabase.rpc("consultora_pos_venda_abrir", { _item: item, _tipo: tipo, _motivo: motivo, _observacao: obs, _solucao: solucao, _fotos: paths, _excecao: excecao, _chave: chave });
    if (error) throw error; return data as { protocolo?: string };
  }, onSuccess: (r) => { setProtocolo(r.protocolo ?? ""); void qc.invalidateQueries({ queryKey: ["consultora", "pos-venda"] }); }, onError: (e) => toast.error(traduzir(e)) });
  if (q.isLoading) return <p>Carregando compra…</p>;
  if (q.isError) return <p role="alert">{traduzir(q.error)}</p>;
  if (protocolo) return <div role="status" className="py-6 text-center"><h3 className="text-2xl font-semibold">Solicitação enviada</h3><p className="mt-3 text-xl">{protocolo}</p><p className="mt-3">Aguardando análise da Lardan. Nenhum crédito ou troca de estoque foi feito.</p></div>;
  return <div className="space-y-4"><p className="font-semibold">Etapa {passo} de 4</p>
    {passo === 1 && <><h3 className="text-xl">Qual peça?</h3><SmartSelect value={item} onChange={setItem} placeholder="Escolha a peça comprada" options={(q.data?.itens ?? []).map((i) => ({ value: i.id, label: `${i.quantity}× ${i.product_name}` }))} /><p>Compra registrada em {compra ? new Date(compra + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</p></>}
    {passo === 2 && <><div className="grid grid-cols-2 gap-3">{["troca", "garantia"].map((t) => <Button key={t} variant={tipo === t ? "default" : "outline"} onClick={() => { setTipo(t); setMotivo(""); setExcecao(false); }}>{t === "troca" ? "Troca" : "Garantia"}</Button>)}</div><SmartSelect value={motivo} onChange={setMotivo} placeholder="Motivo" options={(tipo === "troca" ? ["Tamanho ou aro", "Não gostou", "Presente"] : ["Escureceu ou descascou", "Fecho quebrado", "Pedra caiu", "Peça quebrou"]).map((v) => ({ value: v, label: v }))} /><p className={dentro ? "text-success" : "text-destructive"}>{dentro ? "Dentro do prazo" : "Fora do prazo"}</p>{!dentro && <Button variant={excecao ? "default" : "outline"} aria-pressed={excecao} onClick={() => setExcecao(!excecao)}>Pedir exceção</Button>}</>}
    {passo === 3 && <><label className="block" htmlFor="fotos-garantia">Até três fotos {tipo === "garantia" ? "(obrigatórias)" : "(opcionais)"}</label><input id="fotos-garantia" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length > 3 || fs.some((f) => f.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(f.type))) { toast.error("Envie até três fotos JPG, PNG ou WEBP de até 5 MB."); return; } setFotos(fs); }} /><p>{fotos.length} fotos selecionadas</p><label className="block" htmlFor="obs-garantia">Observação</label><textarea id="obs-garantia" className="admin-input min-h-24" value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)} /></>}
    {passo === 4 && <><h3 className="text-xl">Qual solução você solicita?</h3><SmartSelect value={solucao} onChange={setSolucao} options={[{ value: "troca", label: "Troca por outra peça" }, { value: "reposicao", label: "Aguardar reposição" }, { value: "credito", label: "Crédito para a cliente" }]} /><p>A solução depende de aprovação. Estoque e valores só mudam pelo procedimento oficial da Lardan.</p><Button className="min-h-12 w-full" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Enviando…" : "Confirmar solicitação"}</Button></>}
    <div className="flex gap-3">{passo > 1 && <Button variant="outline" onClick={() => setPasso(passo - 1)}>Voltar</Button>}{passo < 4 && <Button disabled={passo === 1 ? !item : passo === 2 ? !motivo || (!dentro && !excecao) : tipo === "garantia" && fotos.length === 0} onClick={() => setPasso(passo + 1)}>Continuar</Button>}</div>
  </div>;
}
export function ListaPosVenda() {
  const q = useQuery({ queryKey: ["consultora", "pos-venda"], queryFn: async () => { const { data, error } = await supabase.from("consultora_pos_venda").select("id,protocolo,tipo,status,motivo,resposta,created_at").order("created_at", { ascending: false }).limit(100); if (error) throw error; return data; } });
  return <section className="border-t border-border py-5"><h2 className="mb-4 text-xl font-semibold">Trocas e garantias</h2>{q.isLoading && <p>Carregando solicitações…</p>}{q.isError && <p role="alert">Não foi possível carregar.</p>}{q.data?.length === 0 && <p>Sem solicitações.</p>}<ul className="divide-y divide-border">{q.data?.map((r) => <li key={r.id} className="py-4"><p className="font-semibold">TG-{String(r.protocolo).padStart(6, "0")} · {r.status.replaceAll("_", " ")}</p><p>{r.tipo} · {r.motivo}</p>{r.resposta && <p>{r.resposta}</p>}<Button asChild variant="outline" className="mt-3 min-h-12"><a target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Olá! Sua solicitação TG-${String(r.protocolo).padStart(6, "0")} está ${r.status.replaceAll("_", " ")}.${r.resposta ? " " + r.resposta : ""}`)}`}>Avisar cliente no WhatsApp</a></Button></li>)}</ul></section>;
}
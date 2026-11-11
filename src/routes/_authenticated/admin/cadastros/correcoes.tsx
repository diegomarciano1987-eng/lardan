/**
 * 0283 — Correções do administrador (só Master): vincular o histórico de vendas de um cadastro a outro,
 * excluir venda de teste e cancelar remessa vazia. Tudo pede motivo e fica na auditoria.
 */
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Trash2, Ban } from "lucide-react";
import { PageHeader, Panel } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/cadastros/correcoes")({
  component: Correcoes,
  head: () => ({
    meta: [
      { title: "Correções do administrador — LARDAN Cloud" },
      { name: "description", content: "Ferramentas do Master para corrigir cadastros, vendas de teste e remessas vazias, com motivo e auditoria." },
      { property: "og:title", content: "Correções do administrador — LARDAN" },
      { property: "og:description", content: "Correções seguras e auditadas para o Master." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Pessoa = { id: string; codigo: string | null; nome: string; cpf: string | null; status: string };
const brl = (c: number) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const erro = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));

function BuscaPessoa({ rotulo, valor, onEscolher }: { rotulo: string; valor: Pessoa | null; onEscolher: (p: Pessoa | null) => void }) {
  const [termo, setTermo] = React.useState("");
  const [t, setT] = React.useState("");
  React.useEffect(() => { const x = setTimeout(() => setT(termo.trim()), 300); return () => clearTimeout(x); }, [termo]);
  const q = useQuery({
    queryKey: ["correcoes", "pessoa", t], enabled: t.length >= 2,
    queryFn: async () => { const { data, error } = await supabase.rpc("qualidade_buscar_consultora", { _termo: t }); if (error) throw error; return (data ?? []) as unknown as Pessoa[]; },
  });
  if (valor) return (
    <div className="grid gap-1.5 text-sm">
      <span className="font-semibold text-ledger-text">{rotulo}</span>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-line-soft bg-surface p-3">
        <span><strong>[Cód. {valor.codigo ?? "—"}] {valor.nome}</strong>{valor.cpf ? <span className="text-ledger-muted"> · CPF {valor.cpf}</span> : null}</span>
        <button type="button" className="admin-btn h-8 px-3 text-xs" onClick={() => onEscolher(null)}>Trocar</button>
      </div>
    </div>
  );
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-semibold text-ledger-text">{rotulo}</span>
      <input className="admin-input w-full" value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar por nome, código ou CPF" />
      {t.length >= 2 && (
        <div className="max-h-56 overflow-auto rounded-xl border border-line-soft">
          {q.isFetching && <p className="p-3 text-xs text-ledger-muted">Buscando…</p>}
          {!q.isFetching && (q.data?.length ?? 0) === 0 && <p className="p-3 text-xs text-ledger-muted">Ninguém encontrado.</p>}
          {q.data?.map((p) => (
            <button key={p.id} type="button" onClick={() => onEscolher(p)} className="flex w-full justify-between gap-2 border-b border-line-soft px-3 py-2 text-left last:border-0 hover:bg-muted">
              <span>[Cód. {p.codigo ?? "—"}] {p.nome}</span><span className="text-xs text-ledger-muted">{p.cpf ?? ""} · {p.status}</span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

function VincularHistorico() {
  const qc = useQueryClient();
  const [destino, setDestino] = React.useState<Pessoa | null>(null);
  const [origem, setOrigem] = React.useState<Pessoa | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const previa = useQuery({
    queryKey: ["correcoes", "previa", destino?.id, origem?.id], enabled: !!destino && !!origem && destino.id !== origem.id, retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consultora_historico_vincular", { _destino: destino!.id, _origem: origem!.id, _motivo: "", _executar: false });
      if (error) throw error;
      return data as unknown as { codigos_antigos: number[]; acertos_antigos: number; acertos_lardan: number };
    },
  });
  const lista = useQuery({
    queryKey: ["correcoes", "vinculos"], retry: false,
    queryFn: async () => { const { data, error } = await supabase.rpc("consultora_historico_vinculos_lista"); if (error) throw error;
      return (data ?? []) as unknown as { id: string; destino: string; destino_codigo: string | null; origem: string; origem_codigo: string | null; motivo: string; criado_em: string }[]; },
  });
  const aplicar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("consultora_historico_vincular", { _destino: destino!.id, _origem: origem!.id, _motivo: motivo, _executar: true });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Histórico vinculado. As vendas antigas já aparecem no cadastro dela."); setOrigem(null); setMotivo(""); void qc.invalidateQueries({ queryKey: ["correcoes"] }); },
    onError: (e) => toast.error(erro(e)),
  });
  const desfazer = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc("consultora_historico_desvincular", { _id: id }); if (error) throw error; },
    onSuccess: () => { toast.success("Vínculo desfeito."); void qc.invalidateQueries({ queryKey: ["correcoes"] }); },
    onError: (e) => toast.error(erro(e)),
  });
  return (
    <Panel title="Vincular histórico de vendas de um cadastro a outro">
      <div className="space-y-4 text-sm">
        <p className="max-w-3xl text-ledger-muted">Ex.: a consultora fez o primeiro cadastro no nome do marido. O histórico de vendas, acertos, Liga e objetivo do cadastro antigo passa a contar no cadastro dela. As dívidas e notas continuam no nome de quem era (CPF de cada um), nada é apagado e dá para desfazer.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <BuscaPessoa rotulo="Cadastro certo (dela)" valor={destino} onEscolher={setDestino} />
          <BuscaPessoa rotulo="Cadastro antigo (ex.: do marido)" valor={origem} onEscolher={setOrigem} />
        </div>
        {previa.isError && <p role="alert" className="text-destructive">{erro(previa.error)}</p>}
        {previa.data && (
          <div className="rounded-xl border border-line-soft bg-surface p-4">
            <p className="ledger-eyebrow mb-1">Prévia</p>
            <p>Vai passar a contar no cadastro dela: <strong>{previa.data.acertos_antigos}</strong> acertos do sistema antigo (códigos {previa.data.codigos_antigos.join(", ") || "nenhum"}) e <strong>{previa.data.acertos_lardan}</strong> acertos do Lardan.</p>
          </div>
        )}
        {previa.data && (
          <div className="flex flex-wrap items-center gap-2">
            <input className="admin-input w-96 max-w-full" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (ex.: primeiro cadastro no nome do marido)" />
            <button type="button" className="admin-btn admin-btn-primary" disabled={motivo.trim().length < 5 || aplicar.isPending}
              onClick={() => { if (window.confirm(`Vincular o histórico de ${origem!.nome} ao cadastro de ${destino!.nome}?`)) aplicar.mutate(); }}>
              <Link2 aria-hidden className="size-4" /> Vincular histórico
            </button>
          </div>
        )}
        {(lista.data?.length ?? 0) > 0 && (
          <div>
            <p className="ledger-eyebrow mb-2">Vínculos ativos</p>
            <ul className="space-y-2">
              {lista.data!.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft p-3">
                  <span><strong>[Cód. {v.origem_codigo ?? "—"}] {v.origem}</strong> → <strong>[Cód. {v.destino_codigo ?? "—"}] {v.destino}</strong><span className="block text-xs text-ledger-muted">{v.motivo} · {new Date(v.criado_em).toLocaleDateString("pt-BR")}</span></span>
                  <button type="button" className="admin-btn h-8 px-3 text-xs" disabled={desfazer.isPending} onClick={() => { if (window.confirm("Desfazer este vínculo?")) desfazer.mutate(v.id); }}>Desfazer</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

type Venda = { id: string; codigo: string; cliente: string | null; consultora: string | null; status: string; pagamento: string; total_cents: number; itens: number; criado_em: string; canal: string };
function VendaTeste() {
  const qc = useQueryClient();
  const [termo, setTermo] = React.useState("");
  const [t, setT] = React.useState("");
  React.useEffect(() => { const x = setTimeout(() => setT(termo.trim()), 300); return () => clearTimeout(x); }, [termo]);
  const q = useQuery({
    queryKey: ["correcoes", "vendas", t], enabled: t.length >= 2, retry: false,
    queryFn: async () => { const { data, error } = await supabase.rpc("venda_teste_buscar", { _codigo: t }); if (error) throw error; return (data ?? []) as unknown as Venda[]; },
  });
  const excluir = useMutation({
    mutationFn: async (v: Venda) => {
      const motivo = window.prompt(`Excluir a venda ${v.codigo} (${v.cliente ?? "sem cliente"})? Ela fica cancelada e sai de vendas, vitrine e acertos. Motivo:`, "Cliente de teste");
      if (motivo === null) return false;
      const { error } = await supabase.rpc("venda_teste_excluir", { _order: v.id, _motivo: motivo });
      if (error) throw error;
      return true;
    },
    onSuccess: (ok) => { if (ok) { toast.success("Venda de teste excluída."); void qc.invalidateQueries({ queryKey: ["correcoes", "vendas"] }); } },
    onError: (e) => toast.error(erro(e)),
  });
  return (
    <Panel title="Excluir venda de teste">
      <div className="space-y-3 text-sm">
        <p className="max-w-3xl text-ledger-muted">Para vendas feitas com cliente de teste. A venda fica cancelada com o motivo (não some da auditoria) e deixa de contar em vendas, vitrine e acerto. Venda paga para a Lardan ou com acerto já fechado não sai por aqui.</p>
        <input className="admin-input w-96 max-w-full" value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Código da venda ou nome da cliente" />
        {q.isError && <p role="alert" className="text-destructive">{erro(q.error)}</p>}
        {t.length >= 2 && !q.isFetching && (q.data?.length ?? 0) === 0 && <p className="text-ledger-muted">Nenhuma venda encontrada.</p>}
        <ul className="space-y-2">
          {q.data?.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft p-3">
              <span><strong>{v.codigo}</strong> · {v.cliente ?? "sem cliente"} · consultora {v.consultora ?? "—"}
                <span className="block text-xs text-ledger-muted">{new Date(v.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {v.itens} peça(s) · {brl(v.total_cents)} · {v.status} · pagamento {v.pagamento}</span></span>
              {v.status !== "cancelado" ? (
                <button type="button" className="admin-btn h-8 px-3 text-xs" disabled={excluir.isPending} onClick={() => excluir.mutate(v)}><Trash2 aria-hidden className="size-3.5" /> Excluir</button>
              ) : <span className="text-xs text-ledger-muted">Cancelada</span>}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function RemessaVazia() {
  const [numero, setNumero] = React.useState("");
  const cancelar = useMutation({
    mutationFn: async () => {
      const n = Number(numero);
      if (!Number.isInteger(n) || n <= 0) throw new Error("Digite o número da remessa.");
      const { data: r, error: e1 } = await supabase.from("remessas").select("id, numero, status").eq("numero", n).maybeSingle();
      if (e1) throw e1;
      if (!r) throw new Error(`Remessa ${n} não encontrada.`);
      const motivo = window.prompt(`Cancelar a remessa ${n}? Só funciona se ela não tiver nenhuma maleta. Motivo:`, "Remessa criada por engano");
      if (motivo === null) return null;
      const { error } = await supabase.rpc("remessa_cancelar_vazia", { _remessa: r.id, _motivo: motivo });
      if (error) throw error;
      return n;
    },
    onSuccess: (n) => { if (n) { toast.success(`Remessa ${n} cancelada.`); setNumero(""); } },
    onError: (e) => toast.error(erro(e)),
  });
  return (
    <Panel title="Cancelar remessa criada por engano">
      <div className="space-y-3 text-sm">
        <p className="max-w-3xl text-ledger-muted">Só cancela remessa sem maleta. Se tiver maleta, primeiro mude a maleta de remessa ou devolva.</p>
        <div className="flex flex-wrap gap-2">
          <input className="admin-input w-40" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))} placeholder="Nº da remessa" />
          <button type="button" className="admin-btn" disabled={!numero || cancelar.isPending} onClick={() => cancelar.mutate()}><Ban aria-hidden className="size-4" /> Cancelar remessa</button>
        </div>
      </div>
    </Panel>
  );
}

function Correcoes() {
  const master = useQuery({
    queryKey: ["eu", "master"], staleTime: 300_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "master" });
      return data === true;
    },
  });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Base operacional · Cadastros" title="Correções do administrador"
        description="Ferramentas rápidas do Master para consertar erros. Tudo pede motivo e fica registrado na auditoria." />
      {master.isLoading ? <p className="text-sm text-ledger-muted">Conferindo acesso…</p>
        : !master.data ? <p role="alert" className="text-sm">Somente o Master usa estas correções.</p>
        : (<><VincularHistorico /><VendaTeste /><RemessaVazia /></>)}
    </div>
  );
}

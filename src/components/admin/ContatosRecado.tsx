/**
 * 0315 — telefone de recado e contato de referência (nome, parentesco, telefone). Opcionais.
 * Grava só por party_referencias_salvar (banco confere quem pode: equipe com cadastro ou o representante dela).
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface ContatoRef { nome: string; parentesco: string; telefone: string }
export interface ContatosRef { recado: ContatoRef; referencia: ContatoRef }
export const CONTATOS_VAZIOS: ContatosRef = { recado: { nome: "", parentesco: "", telefone: "" }, referencia: { nome: "", parentesco: "", telefone: "" } };

const so = (v: string) => v.replace(/\D/g, "").slice(0, 11);
export const mascaraFone = (v: string) => {
  const d = so(v);
  return d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
};
const preenchido = (c: ContatoRef) => Boolean(c.nome.trim() || c.parentesco.trim() || c.telefone.trim());
export const contatosPreenchidos = (v: ContatosRef) => preenchido(v.recado) || preenchido(v.referencia);

/** Confere antes de gravar o cadastro (telefone com DDD), para não criar a pessoa e falhar depois. */
export function conferirContatos(v: ContatosRef): string | null {
  for (const [rot, c] of [["recado", v.recado], ["referência", v.referencia]] as const) {
    const n = so(c.telefone).length;
    if (n > 0 && n !== 10 && n !== 11) return `Telefone de ${rot}: informe DDD + número.`;
  }
  return null;
}

export async function salvarContatosRef(party: string, v: ContatosRef) {
  const itens = (["recado", "referencia"] as const).map((tipo) => ({ tipo, ...v[tipo], telefone: so(v[tipo].telefone) }));
  const { error } = await supabase.rpc("party_referencias_salvar" as never, { _party: party, _itens: itens } as never);
  if (error) throw new Error(error.message);
}

export async function lerContatosRef(party: string): Promise<ContatosRef> {
  const { data, error } = await supabase.rpc("party_referencias_ler" as never, { _party: party } as never);
  if (error) throw new Error(error.message);
  const v: ContatosRef = { recado: { ...CONTATOS_VAZIOS.recado }, referencia: { ...CONTATOS_VAZIOS.referencia } };
  for (const x of (data ?? []) as unknown as { tipo: "recado" | "referencia"; nome: string | null; parentesco: string | null; telefone: string | null }[]) {
    v[x.tipo] = { nome: x.nome ?? "", parentesco: x.parentesco ?? "", telefone: mascaraFone(x.telefone ?? "") };
  }
  return v;
}

/** Campos (sem gravar). `inputClass` segue o visual da tela que usa. */
export function CamposContatosRef({ value, onChange, inputClass, labelClass }: {
  value: ContatosRef; onChange: (v: ContatosRef) => void; inputClass: string; labelClass?: string;
}) {
  const set = (tipo: keyof ContatosRef, campo: keyof ContatoRef) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [tipo]: { ...value[tipo], [campo]: campo === "telefone" ? mascaraFone(e.target.value) : e.target.value } });
  const lc = labelClass ?? "mb-1.5 block text-xs font-medium text-muted-foreground";
  const bloco = (tipo: keyof ContatosRef, titulo: string, exemploNome: string) => (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{titulo} <span className="font-normal text-muted-foreground">(opcional)</span></legend>
      <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1.2fr]">
        <label><span className={lc}>Nome</span><input className={inputClass} value={value[tipo].nome} onChange={set(tipo, "nome")} placeholder={exemploNome} autoComplete="off" /></label>
        <label><span className={lc}>Parentesco / quem é</span><input className={inputClass} value={value[tipo].parentesco} onChange={set(tipo, "parentesco")} placeholder="Mãe, irmã, vizinha…" autoComplete="off" /></label>
        <label><span className={lc}>Telefone</span><input className={inputClass} inputMode="tel" value={value[tipo].telefone} onChange={set(tipo, "telefone")} placeholder="(43) 99999-9999" /></label>
      </div>
    </fieldset>
  );
  return (
    <div className="space-y-4">
      {bloco("recado", "Telefone de recado", "Quem atende o recado")}
      {bloco("referencia", "Contato de referência", "Pessoa de referência")}
    </div>
  );
}

/** Ficha da pessoa: mostra e edita (só quem pode editar cadastro). */
export function ContatosRefFicha({ partyId, podeEditar, inputClass }: { partyId: string; podeEditar: boolean; inputClass: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["registry", "referencias", partyId], queryFn: () => lerContatosRef(partyId) });
  const [edit, setEdit] = React.useState<ContatosRef | null>(null);
  const salvar = useMutation({
    mutationFn: async (v: ContatosRef) => {
      const erro = conferirContatos(v);
      if (erro) throw new Error(erro);
      await salvarContatosRef(partyId, v);
    },
    onSuccess: async () => { toast.success("Recado e referência salvos."); setEdit(null); await qc.invalidateQueries({ queryKey: ["registry", "referencias", partyId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <p className="text-sm text-ledger-muted">Carregando recado e referência…</p>;
  if (q.isError) return <p className="text-sm text-danger">{(q.error as Error).message}</p>;
  const v = q.data!;
  if (edit) {
    return (
      <div className="space-y-3">
        <CamposContatosRef value={edit} onChange={setEdit} inputClass={inputClass} />
        <div className="flex justify-end gap-2">
          <button type="button" className="admin-btn" onClick={() => setEdit(null)}>Cancelar</button>
          <button type="button" className="admin-btn-primary" disabled={salvar.isPending} onClick={() => salvar.mutate(edit)}>{salvar.isPending ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    );
  }
  const linha = (titulo: string, c: ContatoRef) => (
    <li className="flex items-start gap-3 rounded-lg border border-line-soft bg-surface px-3 py-2.5">
      <Phone aria-hidden className="mt-0.5 size-4 text-bronze" />
      <span className="flex-1">
        <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-bronze">{titulo}</span>
        {preenchido(c) ? (
          <span className="block text-sm text-ledger-text">
            {c.nome || "Sem nome"}{c.parentesco ? ` (${c.parentesco})` : ""}{c.telefone ? ` · ${c.telefone}` : ""}
          </span>
        ) : <span className="block text-sm text-ledger-muted">Não informado</span>}
      </span>
    </li>
  );
  return (
    <div className="space-y-2">
      <ul className="space-y-2">{linha("Telefone de recado", v.recado)}{linha("Contato de referência", v.referencia)}</ul>
      {podeEditar && <button type="button" className="admin-btn" onClick={() => setEdit(v)}>Editar recado e referência</button>}
    </div>
  );
}

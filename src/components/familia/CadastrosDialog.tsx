/* ============================================================
 * FINANCEIRO DA FAMÍLIA — Gerenciar categorias, contas e projetos
 * ============================================================ */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Campo, Ponto } from "./componentes";
import {
  excluirCategoria, excluirConta, excluirProjeto, salvarCategoria, salvarConta, salvarProjeto,
} from "@/lib/familia/api";
import {
  PALETA_CADASTRO, TIPOS_CONTA, type Categoria, type Conta, type Projeto, type TipoCategoria, type TipoConta,
} from "@/lib/familia/tipos";
import type { AbaCadastro } from "./dialogos";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  aba: AbaCadastro;
  onAba: (a: AbaCadastro) => void;
  categorias: Categoria[];
  contas: Conta[];
  projetos: Projeto[];
}

type Editando =
  | { aba: "categorias"; id?: string; nome: string; cor: string; tipo: TipoCategoria }
  | { aba: "contas"; id?: string; nome: string; cor: string; tipo: TipoConta; instituicao: string; ativa: boolean }
  | { aba: "projetos"; id?: string; nome: string; cor: string; ativo: boolean };

type Excluindo = { aba: AbaCadastro; id: string; nome: string } | null;

function SeletorCor({ valor, onChange }: { valor: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PALETA_CADASTRO.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Cor ${c}`}
          onClick={() => onChange(c)}
          className={cn("grid h-7 w-7 place-items-center rounded-full ring-offset-2 ring-offset-background transition", valor.toUpperCase() === c && "ring-2 ring-primary")}
          style={{ background: c }}
        >
          {valor.toUpperCase() === c && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
        </button>
      ))}
    </div>
  );
}

export function CadastrosDialog({ open, onOpenChange, aba, onAba, categorias, contas, projetos }: Props) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Editando | null>(null);
  const [excluindo, setExcluindo] = useState<Excluindo>(null);
  const [tipoCat, setTipoCat] = useState<TipoCategoria>("despesa");

  useEffect(() => { if (!open) setEditando(null); }, [open]);

  const invalidar = () => qc.invalidateQueries({ queryKey: ["familia"] });

  const salvar = useMutation({
    mutationFn: async (e: Editando) => {
      if (!e.nome.trim()) throw new Error("Informe um nome");
      if (e.aba === "categorias") return salvarCategoria({ ...(e.id ? { id: e.id } : {}), nome: e.nome, tipo: e.tipo, cor: e.cor });
      if (e.aba === "contas") return salvarConta({ ...(e.id ? { id: e.id } : {}), nome: e.nome, tipo: e.tipo, instituicao: e.instituicao, cor: e.cor, ativa: e.ativa });
      return salvarProjeto({ ...(e.id ? { id: e.id } : {}), nome: e.nome, cor: e.cor, ativo: e.ativo });
    },
    onSuccess: () => { toast.success("Salvo"); setEditando(null); invalidar(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const remover = useMutation({
    mutationFn: async (x: NonNullable<Excluindo>) => {
      if (x.aba === "categorias") return excluirCategoria(x.id);
      if (x.aba === "contas") return excluirConta(x.id);
      return excluirProjeto(x.id);
    },
    onSuccess: () => { toast.success("Excluído"); setExcluindo(null); invalidar(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const novo = (): Editando => {
    const cor = PALETA_CADASTRO[Math.floor(Math.random() * PALETA_CADASTRO.length)] ?? "#0EA5E9";
    if (aba === "categorias") return { aba, nome: "", cor, tipo: tipoCat };
    if (aba === "contas") return { aba, nome: "", cor, tipo: "conta_corrente", instituicao: "", ativa: true };
    return { aba, nome: "", cor, ativo: true };
  };

  // Funções de render (não componentes): evita remontar o formulário a cada tecla.
  const linha = ({ key, cor, nome, sub, inativo, onEditar, onExcluir }: {
    key: string; cor: string; nome: string; sub?: string | undefined; inativo?: boolean | undefined; onEditar: () => void; onExcluir: () => void;
  }) => (
    <div key={key} className={cn("flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2", inativo && "opacity-60")}>
      <Ponto cor={cor} className="h-3 w-3" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{nome}</p>
        {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
      </div>
      <Button type="button" variant="ghost" size="icon" className="size-10" onClick={onEditar} aria-label={`Editar ${nome}`}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-10" onClick={onExcluir} aria-label={`Excluir ${nome}`}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );

  const formulario = (e: Editando) => (
    <form
      className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
      onSubmit={(ev) => { ev.preventDefault(); salvar.mutate(e); }}
    >
      <Campo rotulo="Nome" obrigatorio>
        <Input autoFocus className="h-11 text-base" value={e.nome} maxLength={60} onChange={(ev) => setEditando({ ...e, nome: ev.target.value })} />
      </Campo>
      {e.aba === "categorias" && (
        <Campo rotulo="Tipo">
          <Select value={e.tipo} onValueChange={(v) => setEditando({ ...e, tipo: v as TipoCategoria })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="despesa">Despesa</SelectItem>
              <SelectItem value="receita">Receita</SelectItem>
            </SelectContent>
          </Select>
        </Campo>
      )}
      {e.aba === "contas" && (
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Tipo">
            <Select value={e.tipo} onValueChange={(v) => setEditando({ ...e, tipo: v as TipoConta })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TIPOS_CONTA.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}</SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Banco / instituição">
            <Input value={e.instituicao} maxLength={60} onChange={(ev) => setEditando({ ...e, instituicao: ev.target.value })} placeholder="Ex: Nubank" />
          </Campo>
        </div>
      )}
      <Campo rotulo="Cor"><SeletorCor valor={e.cor} onChange={(cor) => setEditando({ ...e, cor })} /></Campo>
      {e.aba === "contas" && (
        <label className="flex items-center gap-2 text-sm"><Switch checked={e.ativa} onCheckedChange={(v) => setEditando({ ...e, ativa: v })} /> Conta ativa</label>
      )}
      {e.aba === "projetos" && (
        <label className="flex items-center gap-2 text-sm"><Switch checked={e.ativo} onCheckedChange={(v) => setEditando({ ...e, ativo: v })} /> Projeto ativo</label>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditando(null)}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={!e.nome.trim() || salvar.isPending}>{e.id ? "Salvar" : "Adicionar"}</Button>
      </div>
    </form>
  );

  const catsVisiveis = categorias.filter((c) => c.tipo === tipoCat);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[94dvh] w-[calc(100vw-1rem)] max-w-[520px] overflow-y-auto rounded-2xl">
          <DialogHeader className="text-left">
            <DialogTitle className="pr-8 font-display text-xl font-bold">Cadastros da família</DialogTitle>
            <DialogDescription>Categorias, contas e projetos usados nos lançamentos. Só você vê.</DialogDescription>
          </DialogHeader>
          <Tabs value={aba} onValueChange={(v) => { onAba(v as AbaCadastro); setEditando(null); }}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="categorias">Categorias</TabsTrigger>
              <TabsTrigger value="contas">Contas</TabsTrigger>
              <TabsTrigger value="projetos">Projetos</TabsTrigger>
            </TabsList>

            <TabsContent value="categorias" className="space-y-3">
              <div className="inline-flex rounded-lg border border-border p-0.5">
                {(["despesa", "receita"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setTipoCat(t); setEditando(null); }}
                    className={cn("rounded-md px-3 py-1 text-xs font-semibold", tipoCat === t ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                  >
                    {t === "despesa" ? "Despesas" : "Receitas"}
                  </button>
                ))}
              </div>
              {editando?.aba === "categorias" && formulario(editando)}
              <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                {catsVisiveis.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma categoria.</p>}
                {catsVisiveis.map((c) => (
                  linha({
                    key: c.id, cor: c.cor, nome: c.nome,
                    onEditar: () => setEditando({ aba: "categorias", id: c.id, nome: c.nome, cor: c.cor, tipo: c.tipo }),
                    onExcluir: () => setExcluindo({ aba: "categorias", id: c.id, nome: c.nome }),
                  })
                ))}
              </div>
            </TabsContent>

            <TabsContent value="contas" className="space-y-3">
              {editando?.aba === "contas" && formulario(editando)}
              <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                {contas.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma conta. Cadastre banco, cartão ou carteira.</p>}
                {contas.map((c) => (
                  linha({
                    key: c.id, cor: c.cor, nome: c.nome, inativo: !c.ativa,
                    sub: [TIPOS_CONTA.find((t) => t.valor === c.tipo)?.rotulo, c.instituicao, !c.ativa ? "inativa" : null].filter(Boolean).join(" · "),
                    onEditar: () => setEditando({ aba: "contas", id: c.id, nome: c.nome, cor: c.cor, tipo: c.tipo, instituicao: c.instituicao ?? "", ativa: c.ativa }),
                    onExcluir: () => setExcluindo({ aba: "contas", id: c.id, nome: c.nome }),
                  })
                ))}
              </div>
            </TabsContent>

            <TabsContent value="projetos" className="space-y-3">
              {editando?.aba === "projetos" && formulario(editando)}
              <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                {projetos.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum projeto. Ex: Reforma, Viagem de férias, Casamento.</p>}
                {projetos.map((p) => (
                  linha({
                    key: p.id, cor: p.cor, nome: p.nome, inativo: !p.ativo, sub: !p.ativo ? "inativo" : undefined,
                    onEditar: () => setEditando({ aba: "projetos", id: p.id, nome: p.nome, cor: p.cor, ativo: p.ativo }),
                    onExcluir: () => setExcluindo({ aba: "projetos", id: p.id, nome: p.nome }),
                  })
                ))}
              </div>
            </TabsContent>
          </Tabs>
          {!editando && (
            <div className="flex justify-end">
              <Button type="button" onClick={() => setEditando(novo())}>
                <Plus className="mr-1 h-4 w-4" />
                {aba === "categorias" ? "Nova categoria" : aba === "contas" ? "Nova conta" : "Novo projeto"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!excluindo} onOpenChange={(o) => !o && setExcluindo(null)}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-[420px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {excluindo?.aba === "categorias" ? "categoria" : excluindo?.aba === "contas" ? "conta" : "projeto"}?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block font-semibold text-foreground">{excluindo?.nome}</span>
              Os lançamentos continuam existindo; só ficam sem esse vínculo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={remover.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remover.isPending}
              onClick={(ev) => { ev.preventDefault(); if (excluindo) remover.mutate(excluindo); }}
            >
              {remover.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ============================================================
 * FINANCEIRO DA FAMÍLIA — modais (mesmo padrão do sistema antigo)
 * Adicionar Despesa Fixa · Adicionar Despesa Variável ·
 * Adicionar Receita · Pagar · Reajustar · Encerrar · Escopo
 * ============================================================ */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatBRL } from "@/lib/familia/dinheiro";
import { hojeISO } from "@/lib/familia/datas";
import { cn } from "@/lib/utils";
import {
  Campo, CampoData, CampoValor, SelectCategoria, SelectConta, SelectForma, SelectProjeto, SeletorMesPopover, ToggleTipo,
  rotuloMesCurto,
} from "./componentes";
import {
  atualizarReceita, atualizarVariavel, criarReceita, criarVariavel, encerrarFixa, marcarFixaPaga,
  reajustarFixa, salvarFixa,
} from "@/lib/familia/api";
import type { OcorrenciaFixa } from "@/lib/familia/motor";
import type {
  Categoria, Conta, DespesaFixa, DespesaVariavel, EscopoEdicao, FormaPagamento, Projeto, Receita,
} from "@/lib/familia/tipos";

export type AbaCadastro = "categorias" | "contas" | "projetos";

interface Cadastros {
  categorias: Categoria[];
  contas: Conta[];
  projetos: Projeto[];
  onGerenciar: (aba: AbaCadastro) => void;
}

const CHAVE_DADOS = ["familia"] as const;

/** Data padrão de um lançamento no mês que o usuário está vendo. */
export function dataPadraoNoMes(mes: string): string {
  const hoje = hojeISO();
  return hoje.slice(0, 7) === mes ? hoje : `${mes}-01`;
}

/* --------------------------------------------------------------------------
 * Casca do modal: título, corpo rolável e rodapé fixo (Cancelar / Ação).
 * ------------------------------------------------------------------------ */
function Modal({
  open, onOpenChange, titulo, descricao, children, acao, acaoDesabilitada, salvando, onAcao, largura = "max-w-[480px]",
}: {
  open: boolean; onOpenChange: (v: boolean) => void; titulo: string; descricao?: string; children: ReactNode;
  acao: string; acaoDesabilitada?: boolean; salvando?: boolean; onAcao: () => void; largura?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[94dvh] w-[calc(100vw-1rem)] gap-0 rounded-2xl p-0", largura)}>
        <DialogHeader className="px-5 pb-2 pt-6 pr-12 text-left sm:px-6">
          <DialogTitle className="font-display text-xl font-bold tracking-tight">{titulo}</DialogTitle>
          {descricao ? <DialogDescription>{descricao}</DialogDescription> : <DialogDescription className="sr-only">{titulo}</DialogDescription>}
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => { e.preventDefault(); if (!acaoDesabilitada && !salvando) onAcao(); }}
        >
          <div className="max-h-[66dvh] space-y-4 overflow-y-auto px-5 py-3 sm:px-6">{children}</div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={salvando}>Cancelar</Button>
            <Button type="submit" disabled={acaoDesabilitada || salvando} className="h-11 min-w-[110px]">
              {salvando ? "Salvando…" : acao}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SeletorEscopo({ valor, onChange, rotulo = "Aplicar em" }: { valor: EscopoEdicao; onChange: (v: EscopoEdicao) => void; rotulo?: string }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <Label className="text-xs font-semibold uppercase tracking-wider text-primary">{rotulo}</Label>
      <RadioGroup value={valor} onValueChange={(v) => onChange(v as EscopoEdicao)} className="mt-2 flex flex-wrap gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="esta" /> Somente esta</label>
        <label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="proximas" /> Esta e as próximas</label>
      </RadioGroup>
    </div>
  );
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: CHAVE_DADOS });
}

/* ==========================================================================
 * Adicionar / editar DESPESA FIXA
 * ======================================================================== */
export function DespesaFixaDialog({
  open, onOpenChange, fixa, mesPadrao, categorias, contas, projetos, onGerenciar,
}: { open: boolean; onOpenChange: (v: boolean) => void; fixa?: DespesaFixa | null; mesPadrao: string } & Cadastros) {
  const invalidar = useInvalidar();
  const editando = !!fixa;
  const [nome, setNome] = useState("");
  const [dia, setDia] = useState(1);
  const [mesInicio, setMesInicio] = useState(mesPadrao);
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [valor, setValor] = useState(0);
  const [forma, setForma] = useState<FormaPagamento>("debito");
  const [projetoId, setProjetoId] = useState<string | null>(null);
  const [contaId, setContaId] = useState<string | null>(null);
  const [recorrencia, setRecorrencia] = useState<"mensal" | "anual">("mensal");
  const [parcelado, setParcelado] = useState(false);
  const [parcelas, setParcelas] = useState(12);

  useEffect(() => {
    if (!open) return;
    setNome(fixa?.nome ?? "");
    setDia(fixa?.dia_vencimento ?? 1);
    setMesInicio(fixa ? fixa.mes_inicio.slice(0, 7) : mesPadrao);
    setCategoriaId(fixa?.categoria_id ?? null);
    setValor(fixa ? Number(fixa.valor) : 0);
    setForma(fixa?.forma_pagamento ?? "debito");
    setProjetoId(fixa?.projeto_id ?? null);
    setContaId(fixa?.conta_id ?? null);
    setRecorrencia(fixa?.recorrencia ?? "mensal");
    setParcelado(fixa?.parcelado ?? false);
    setParcelas(fixa?.parcelas_total ?? 12);
  }, [open, fixa, mesPadrao]);

  const valido = nome.trim().length > 0 && valor > 0 && (!parcelado || (parcelas >= 2 && parcelas <= 360));

  const salvar = useMutation({
    mutationFn: () => salvarFixa({
      nome, valor, dia_vencimento: dia, mes_inicio: `${mesInicio}-01`, recorrencia, parcelado,
      parcelas_total: parcelado ? parcelas : null, categoria_id: categoriaId, forma_pagamento: forma,
      projeto_id: projetoId, conta_id: contaId, observacoes: fixa?.observacoes ?? null,
      // Ao editar, mantém o encerramento; se o início passou a ser depois dele, reabre.
      encerrada_em: fixa?.encerrada_em && fixa.encerrada_em >= `${mesInicio}-01` ? fixa.encerrada_em : null,
    }, fixa?.id),
    onSuccess: () => { toast.success(editando ? "Despesa fixa atualizada" : "Despesa fixa adicionada"); invalidar(); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      titulo={editando ? "Editar Despesa Fixa" : "Adicionar Despesa Fixa"}
      acao={editando ? "Salvar alterações" : "Adicionar"}
      acaoDesabilitada={!valido}
      salvando={salvar.isPending}
      onAcao={() => salvar.mutate()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome da Despesa" htmlFor="fx-nome">
          <Input id="fx-nome" className="h-11 text-base" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="ex: Aluguel, Energia" />
        </Campo>
        <Campo rotulo="Dia de Vencimento">
          <Select value={String(dia)} onValueChange={(v) => setDia(Number(v))}>
            <SelectTrigger className="h-11" aria-label="Dia de vencimento"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-64">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <SelectItem key={d} value={String(d)}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      </div>
      {dia > 28 && (
        <p className="-mt-2 text-[11px] text-muted-foreground">Em meses mais curtos, vence no último dia do mês.</p>
      )}

      <Campo rotulo="Mês de Início">
        <SeletorMesPopover valor={mesInicio} onChange={setMesInicio} />
      </Campo>

      <Campo rotulo="Categoria" onGerenciar={() => onGerenciar("categorias")}>
        <SelectCategoria categorias={categorias} tipo="despesa" valor={categoriaId} onChange={setCategoriaId} />
      </Campo>

      <Campo rotulo="Valor" obrigatorio>
        <CampoValor valor={valor} onChange={setValor} />
      </Campo>

      <Campo rotulo="Forma de Pagamento">
        <SelectForma valor={forma} onChange={setForma} />
      </Campo>

      <Campo rotulo="Projeto (opcional)" onGerenciar={() => onGerenciar("projetos")}>
        <SelectProjeto projetos={projetos} valor={projetoId} onChange={setProjetoId} />
      </Campo>

      <Campo rotulo="Conta vinculada" onGerenciar={() => onGerenciar("contas")}>
        <SelectConta contas={contas} valor={contaId} onChange={setContaId} />
      </Campo>

      <Campo rotulo="Recorrência">
        <RadioGroup value={recorrencia} onValueChange={(v) => setRecorrencia(v as "mensal" | "anual")} className="flex gap-6 pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="mensal" /> Mensal</label>
          <label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="anual" /> Anual</label>
        </RadioGroup>
      </Campo>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox checked={parcelado} onCheckedChange={(v) => setParcelado(v === true)} />
          Pagamento parcelado
        </label>
        {parcelado && (
          <div className="grid grid-cols-2 items-end gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <Campo rotulo="Número de parcelas">
              <Input
                type="number"
                inputMode="numeric"
                min={2}
                max={360}
                value={parcelas}
                onChange={(e) => setParcelas(Math.max(0, Math.min(360, Math.trunc(Number(e.target.value) || 0))))}
              />
            </Campo>
            <p className="pb-2 text-xs text-muted-foreground">
              {parcelas >= 2 && valor > 0 ? `${parcelas}× de ${formatBRL(valor)} = ${formatBRL(valor * parcelas)}` : "Mínimo 2 parcelas"}
            </p>
          </div>
        )}
      </div>

      {editando && (
        <p className="rounded-md bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Mudanças aqui valem para todos os meses ainda não pagos. Para mudar o valor só daqui para frente,
          use <strong className="text-foreground">Reajustar valor</strong> no menu da despesa.
        </p>
      )}
    </Modal>
  );
}

/* ==========================================================================
 * Adicionar / editar DESPESA VARIÁVEL
 * ======================================================================== */
export function DespesaVariavelDialog({
  open, onOpenChange, despesa, mesPadrao, categorias, contas, projetos, onGerenciar,
}: { open: boolean; onOpenChange: (v: boolean) => void; despesa?: DespesaVariavel | null; mesPadrao: string } & Cadastros) {
  const invalidar = useInvalidar();
  const editando = !!despesa;
  const categoriaOutros = useMemo(
    () => categorias.find((c) => c.tipo === "despesa" && c.nome.toLowerCase() === "outros")?.id ?? null,
    [categorias],
  );
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState(0);
  const [recorrente, setRecorrente] = useState(false);
  const [meses, setMeses] = useState(12);
  const [data, setData] = useState(() => dataPadraoNoMes(mesPadrao));
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [forma, setForma] = useState<FormaPagamento>("debito");
  const [projetoId, setProjetoId] = useState<string | null>(null);
  const [contaId, setContaId] = useState<string | null>(null);
  const [dataPagamento, setDataPagamento] = useState("");
  const [obs, setObs] = useState("");
  const [escopo, setEscopo] = useState<EscopoEdicao>("esta");

  useEffect(() => {
    if (!open) return;
    setDescricao(despesa?.descricao ?? "");
    setValor(despesa ? Number(despesa.valor) : 0);
    setRecorrente(false);
    setMeses(12);
    setData(despesa?.data ?? dataPadraoNoMes(mesPadrao));
    setCategoriaId(despesa ? despesa.categoria_id : categoriaOutros);
    setForma(despesa?.forma_pagamento ?? "debito");
    setProjetoId(despesa?.projeto_id ?? null);
    setContaId(despesa?.conta_id ?? null);
    setDataPagamento(despesa?.data_pagamento ?? "");
    setObs(despesa?.observacoes ?? "");
    setEscopo("esta");
  }, [open, despesa, mesPadrao, categoriaOutros]);

  const valido = descricao.trim().length > 0 && valor > 0 && !!data && (!recorrente || (meses >= 2 && meses <= 120));

  const salvar = useMutation({
    mutationFn: async () => {
      const comum = {
        descricao, valor, data, categoria_id: categoriaId, forma_pagamento: forma, projeto_id: projetoId,
        conta_id: contaId, data_pagamento: dataPagamento || null, observacoes: obs || null,
      };
      if (despesa) { await atualizarVariavel(despesa, comum, escopo); return 1; }
      return criarVariavel(comum, recorrente ? meses : 1);
    },
    onSuccess: (n) => {
      toast.success(editando ? "Despesa atualizada" : n > 1 ? `${n} lançamentos mensais criados` : "Despesa adicionada");
      invalidar();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      titulo={editando ? "Editar Despesa Variável" : "Adicionar Despesa Variável"}
      acao={editando ? "Salvar alterações" : "Adicionar"}
      acaoDesabilitada={!valido}
      salvando={salvar.isPending}
      onAcao={() => salvar.mutate()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Descrição" obrigatorio htmlFor="dv-desc">
          <Input id="dv-desc" className="h-11 text-base" autoFocus value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={200} placeholder="Detalhes adicionais sobre a despesa" />
        </Campo>
        <Campo rotulo="Valor" obrigatorio>
          <CampoValor valor={valor} onChange={setValor} />
        </Campo>
      </div>

      {editando ? (
        despesa?.grupo_id && (
          <SeletorEscopo
            valor={escopo}
            onChange={setEscopo}
            rotulo={`Lançamento ${despesa.ocorrencia_numero}/${despesa.ocorrencias_total} — aplicar em`}
          />
        )
      ) : (
        <Campo rotulo="Tipo de despesa">
          <ToggleTipo recorrente={recorrente} onChange={setRecorrente} />
        </Campo>
      )}

      {!editando && recorrente && (
        <Campo rotulo="Repetir por quantos meses?">
          <div className="flex items-center gap-3">
            <Input
              type="number" inputMode="numeric" min={2} max={120} className="w-28"
              value={meses} onChange={(e) => setMeses(Math.max(0, Math.min(120, Math.trunc(Number(e.target.value) || 0))))}
            />
            <span className="text-xs text-muted-foreground">
              {meses >= 2 ? `Um lançamento por mês, de ${rotuloMesCurto(data.slice(0, 7))} em diante.` : "Mínimo 2 meses"}
            </span>
          </div>
        </Campo>
      )}

      <Campo rotulo={!editando && recorrente ? "Data do 1º lançamento" : "Data"}>
        <CampoData valor={data} onChange={setData} />
      </Campo>

      <Campo rotulo="Categoria" onGerenciar={() => onGerenciar("categorias")}>
        <SelectCategoria categorias={categorias} tipo="despesa" valor={categoriaId} onChange={setCategoriaId} />
      </Campo>

      <Campo rotulo="Forma de Pagamento">
        <SelectForma valor={forma} onChange={setForma} />
      </Campo>

      <Campo rotulo="Projeto (opcional)" onGerenciar={() => onGerenciar("projetos")}>
        <SelectProjeto projetos={projetos} valor={projetoId} onChange={setProjetoId} />
      </Campo>

      <Campo rotulo="Conta vinculada (opcional)" onGerenciar={() => onGerenciar("contas")}>
        <SelectConta contas={contas} valor={contaId} onChange={setContaId} />
      </Campo>

      <Campo rotulo="Data de Pagamento (opcional)">
        <CampoData valor={dataPagamento} onChange={setDataPagamento} obrigatoria={false} rotuloVazio="Data de pagamento (vazio = ainda não paga)" />
      </Campo>

      <Campo rotulo="Observações (opcional)">
        <Textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} placeholder="Observações (opcional)" />
      </Campo>
    </Modal>
  );
}

/* ==========================================================================
 * Adicionar / editar RECEITA
 * ======================================================================== */
export function ReceitaDialog({
  open, onOpenChange, receita, mesPadrao, categorias, onGerenciar,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; receita?: Receita | null; mesPadrao: string;
  categorias: Categoria[]; onGerenciar: (aba: AbaCadastro) => void;
}) {
  const invalidar = useInvalidar();
  const editando = !!receita;
  const categoriaSalario = useMemo(
    () => categorias.find((c) => c.tipo === "receita" && c.nome.toLowerCase() === "salário")?.id ?? null,
    [categorias],
  );
  const [fonte, setFonte] = useState("");
  const [valor, setValor] = useState(0);
  const [recorrente, setRecorrente] = useState(false);
  const [meses, setMeses] = useState(12);
  const [data, setData] = useState(() => dataPadraoNoMes(mesPadrao));
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [forma, setForma] = useState<FormaPagamento>("debito");
  const [obs, setObs] = useState("");
  const [escopo, setEscopo] = useState<EscopoEdicao>("esta");

  useEffect(() => {
    if (!open) return;
    setFonte(receita?.fonte ?? "");
    setValor(receita ? Number(receita.valor) : 0);
    setRecorrente(false);
    setMeses(12);
    setData(receita?.data ?? dataPadraoNoMes(mesPadrao));
    setCategoriaId(receita ? receita.categoria_id : categoriaSalario);
    setForma(receita?.forma_pagamento ?? "debito");
    setObs(receita?.observacoes ?? "");
    setEscopo("esta");
  }, [open, receita, mesPadrao, categoriaSalario]);

  const valido = fonte.trim().length > 0 && valor > 0 && !!data && (!recorrente || (meses >= 2 && meses <= 120));

  const salvar = useMutation({
    mutationFn: async () => {
      const comum = { fonte, valor, data, categoria_id: categoriaId, forma_pagamento: forma, observacoes: obs || null };
      if (receita) { await atualizarReceita(receita, comum, escopo); return 1; }
      return criarReceita(comum, recorrente ? meses : 1);
    },
    onSuccess: (n) => {
      toast.success(editando ? "Receita atualizada" : n > 1 ? `${n} receitas mensais criadas` : "Receita adicionada");
      invalidar();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      titulo={editando ? "Editar Receita" : "Adicionar Receita"}
      acao={editando ? "Salvar alterações" : "Adicionar"}
      acaoDesabilitada={!valido}
      salvando={salvar.isPending}
      onAcao={() => salvar.mutate()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Fonte" obrigatorio htmlFor="rc-fonte">
          <Input id="rc-fonte" className="h-11 text-base" autoFocus value={fonte} onChange={(e) => setFonte(e.target.value)} maxLength={120} placeholder="Ex: Empresa, Freelance, Investimentos" />
        </Campo>
        <Campo rotulo="Valor" obrigatorio>
          <CampoValor valor={valor} onChange={setValor} />
        </Campo>
      </div>

      {editando ? (
        receita?.grupo_id && (
          <SeletorEscopo
            valor={escopo}
            onChange={setEscopo}
            rotulo={`Receita ${receita.ocorrencia_numero}/${receita.ocorrencias_total} — aplicar em`}
          />
        )
      ) : (
        <Campo rotulo="Tipo de receita">
          <ToggleTipo recorrente={recorrente} onChange={setRecorrente} />
        </Campo>
      )}

      {!editando && recorrente && (
        <Campo rotulo="Repetir por quantos meses?">
          <div className="flex items-center gap-3">
            <Input
              type="number" inputMode="numeric" min={2} max={120} className="w-28"
              value={meses} onChange={(e) => setMeses(Math.max(0, Math.min(120, Math.trunc(Number(e.target.value) || 0))))}
            />
            <span className="text-xs text-muted-foreground">
              {meses >= 2 ? `Uma receita por mês, de ${rotuloMesCurto(data.slice(0, 7))} em diante.` : "Mínimo 2 meses"}
            </span>
          </div>
        </Campo>
      )}

      <Campo rotulo={!editando && recorrente ? "Data da 1ª receita" : "Data"}>
        <CampoData valor={data} onChange={setData} />
      </Campo>

      <Campo rotulo="Categoria" onGerenciar={() => onGerenciar("categorias")}>
        <SelectCategoria categorias={categorias} tipo="receita" valor={categoriaId} onChange={setCategoriaId} />
      </Campo>

      <Campo rotulo="Forma de Pagamento">
        <SelectForma valor={forma} onChange={setForma} />
      </Campo>

      <Campo rotulo="Observações (opcional)">
        <Textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} placeholder="Observações (opcional)" />
      </Campo>
    </Modal>
  );
}

/* ==========================================================================
 * Pagar despesa fixa com valor/data diferentes do previsto
 * ======================================================================== */
export function PagarFixaDialog({ open, onOpenChange, ocorrencia }: { open: boolean; onOpenChange: (v: boolean) => void; ocorrencia: OcorrenciaFixa | null }) {
  const invalidar = useInvalidar();
  const [valor, setValor] = useState(0);
  const [data, setData] = useState(hojeISO());
  useEffect(() => {
    if (!open || !ocorrencia) return;
    setValor(ocorrencia.registro?.valor_pago ?? ocorrencia.valor_previsto);
    setData(ocorrencia.registro?.data_pagamento ?? hojeISO());
  }, [open, ocorrencia]);
  const salvar = useMutation({
    mutationFn: () => marcarFixaPaga(ocorrencia!.fixa.id, ocorrencia!.competencia, valor, data),
    onSuccess: () => { toast.success("Pagamento registrado"); invalidar(); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!ocorrencia) return null;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      titulo="Registrar pagamento"
      descricao={`${ocorrencia.fixa.nome} · ${rotuloMesCurto(ocorrencia.mes)} · previsto ${formatBRL(ocorrencia.valor_previsto)}`}
      acao="Confirmar"
      acaoDesabilitada={!(valor >= 0) || !data}
      salvando={salvar.isPending}
      onAcao={() => salvar.mutate()}
      largura="max-w-[420px]"
    >
      <Campo rotulo="Valor pago" obrigatorio><CampoValor valor={valor} onChange={setValor} autoFocus /></Campo>
      <Campo rotulo="Data do pagamento"><CampoData valor={data} onChange={setData} /></Campo>
    </Modal>
  );
}

/* ==========================================================================
 * Reajustar valor a partir de um mês (preserva histórico)
 * ======================================================================== */
export function ReajusteDialog({ open, onOpenChange, fixa, mesPadrao }: { open: boolean; onOpenChange: (v: boolean) => void; fixa: DespesaFixa | null; mesPadrao: string }) {
  const invalidar = useInvalidar();
  const [valor, setValor] = useState(0);
  const [aPartir, setAPartir] = useState(mesPadrao);
  useEffect(() => {
    if (!open || !fixa) return;
    setValor(Number(fixa.valor));
    setAPartir(mesPadrao < fixa.mes_inicio.slice(0, 7) ? fixa.mes_inicio.slice(0, 7) : mesPadrao);
  }, [open, fixa, mesPadrao]);
  const salvar = useMutation({
    mutationFn: () => reajustarFixa(fixa!.id, valor, `${aPartir}-01`),
    onSuccess: () => { toast.success("Valor reajustado"); invalidar(); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!fixa) return null;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      titulo="Reajustar valor"
      descricao={`${fixa.nome} · valor atual ${formatBRL(fixa.valor)}`}
      acao="Reajustar"
      acaoDesabilitada={!(valor > 0) || valor === Number(fixa.valor)}
      salvando={salvar.isPending}
      onAcao={() => salvar.mutate()}
      largura="max-w-[420px]"
    >
      <Campo rotulo="Novo valor" obrigatorio><CampoValor valor={valor} onChange={setValor} autoFocus /></Campo>
      <Campo rotulo="A partir de"><SeletorMesPopover valor={aPartir} onChange={setAPartir} /></Campo>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Os meses anteriores continuam com o valor antigo no histórico e nos relatórios.
      </p>
    </Modal>
  );
}

/* ==========================================================================
 * Encerrar despesa fixa (último mês que ainda conta)
 * ======================================================================== */
export function EncerrarFixaDialog({ open, onOpenChange, fixa, mesPadrao }: { open: boolean; onOpenChange: (v: boolean) => void; fixa: DespesaFixa | null; mesPadrao: string }) {
  const invalidar = useInvalidar();
  const [ultimo, setUltimo] = useState(mesPadrao);
  useEffect(() => {
    if (!open || !fixa) return;
    const inicio = fixa.mes_inicio.slice(0, 7);
    setUltimo(mesPadrao < inicio ? inicio : mesPadrao);
  }, [open, fixa, mesPadrao]);
  const salvar = useMutation({
    mutationFn: () => encerrarFixa(fixa!.id, `${ultimo}-01`),
    onSuccess: () => { toast.success("Despesa fixa encerrada"); invalidar(); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!fixa) return null;
  const invalido = ultimo < fixa.mes_inicio.slice(0, 7);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      titulo="Encerrar despesa fixa"
      descricao={fixa.nome}
      acao="Encerrar"
      acaoDesabilitada={invalido}
      salvando={salvar.isPending}
      onAcao={() => salvar.mutate()}
      largura="max-w-[420px]"
    >
      <Campo rotulo="Último mês que ainda conta"><SeletorMesPopover valor={ultimo} onChange={setUltimo} /></Campo>
      {invalido && <p className="text-xs text-destructive">Precisa ser igual ou depois do mês de início ({rotuloMesCurto(fixa.mes_inicio.slice(0, 7))}).</p>}
      <p className="text-[11px] text-muted-foreground">Nada é apagado. Dá para reativar quando quiser.</p>
    </Modal>
  );
}

/* ==========================================================================
 * Excluir lançamento recorrente: só este ou este + próximos
 * ======================================================================== */
export function ExcluirComEscopoDialog({
  open, onOpenChange, titulo, item, recorrente, onConfirmar, excluindo,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; titulo: string; item: string; recorrente: boolean;
  onConfirmar: (escopo: EscopoEdicao) => void; excluindo?: boolean;
}) {
  const [escopo, setEscopo] = useState<EscopoEdicao>("esta");
  const [ciente, setCiente] = useState(false);
  useEffect(() => { if (open) { setEscopo("esta"); setCiente(false); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[420px] rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            <span className="block font-semibold text-foreground">{item}</span>
            Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        {recorrente && <SeletorEscopo valor={escopo} onChange={setEscopo} rotulo="Excluir" />}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={ciente} onCheckedChange={(v) => setCiente(v === true)} /> Confirmo que quero excluir
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={excluindo}>Cancelar</Button>
          <Button variant="destructive" className="h-11" disabled={!ciente || excluindo} onClick={() => onConfirmar(escopo)}>
            {excluindo ? "Excluindo…" : "Excluir"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


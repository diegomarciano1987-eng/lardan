/* ============================================================
 * FINANCEIRO DA FAMÍLIA (0177) — app da consultora e do representante
 * Portado do "Financeiro Família" do sistema antigo: despesas fixas,
 * despesas variáveis, receitas e relatório anual. Privado (só o dono
 * do login vê), independente da Lardan e SEM avisos, push ou e-mail.
 * Celular primeiro: botões grandes, filtros recolhíveis, ano em cartões.
 * ============================================================ */
import * as React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check, ChevronLeft, ChevronRight, FileSpreadsheet, Home, Layers, Lock, MoreHorizontal, Pencil,
  Plus, Power, RefreshCw, Repeat, Search, Settings2, SlidersHorizontal, Trash2, TrendingDown, TrendingUp, Undo2, Wallet,
} from "lucide-react";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { addMonthsYM, formatISODateBR, hojeISO, limitesDoMes, toISOMonth } from "@/lib/familia/datas";
import { baixarCSV, formatBRL, reaisCSV } from "@/lib/familia/dinheiro";
import {
  desmarcarFixa, encerrarFixa, excluirFixa, excluirReceita, excluirVariavel, garantirCategoriasPadrao,
  listarCategorias, listarContas, listarFixas, listarProjetos, listarReceitas, listarRegistros, listarVariaveis,
  marcarFixaPaga, marcarVariavelPaga, pularFixa,
} from "@/lib/familia/api";
import {
  despesasPorCategoria, filtrarFixas, filtrarReceitas, filtrarVariaveis, gerarOcorrenciasFixas, resumirMes,
  resumoAnual, serieDesdePrimeiroMovimento, serieMensal, ultimoMesDaRegra, type Filtros, type OcorrenciaFixa,
} from "@/lib/familia/motor";
import {
  FORMAS_PAGAMENTO, rotuloForma, type Categoria, type Conta, type DespesaFixa, type DespesaVariavel, type EscopoEdicao,
  type Projeto, type Receita,
} from "@/lib/familia/tipos";
import { Chip, MESES_LONGOS, NavegadorMes, Ponto, Vazio, rotuloMesCurto, rotuloMesLongo } from "./componentes";
import {
  DespesaFixaDialog, DespesaVariavelDialog, EncerrarFixaDialog, ExcluirComEscopoDialog, PagarFixaDialog,
  ReajusteDialog, ReceitaDialog, type AbaCadastro,
} from "./dialogos";
import { CadastrosDialog } from "./CadastrosDialog";

type Aba = "visao" | "fixas" | "variaveis" | "receitas" | "anual";
const TODOS = "__todos__";

type Exclusao =
  | { tipo: "fixa"; item: DespesaFixa }
  | { tipo: "variavel"; item: DespesaVariavel }
  | { tipo: "receita"; item: Receita }
  | null;

const brlCurto = (v: number) => (Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : `R$ ${Math.round(v)}`);
const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--popover-foreground)" };
const COR_RECEITA = "#267a58";
const COR_DESPESA = "#b23f3f";
const COR_SALDO = "var(--primary)";
const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR")}%`);

/** Aviso quando outra pessoa (Master/Daniel) está no espelho do app: a família é só do dono do login. */
export function FamiliaTrancada() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center">
      <Lock className="size-8 text-muted-foreground" aria-hidden />
      <p className="text-lg font-semibold">Financeiro da família é privado</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Só a própria pessoa vê as contas da casa dela, no login dela. Nem a equipe Lardan tem acesso.
      </p>
    </div>
  );
}

export function FinanceiroFamilia() {
  const qc = useQueryClient();
  const mesAtual = toISOMonth(new Date());
  const [mes, setMesEstado] = useState(mesAtual);
  const [aba, setAba] = useState<Aba>("visao");
  const [anoRelatorio, setAnoRelatorio] = useState(() => Number(mesAtual.slice(0, 4)));
  const setMes = (ym: string) => { setMesEstado(ym); setAnoRelatorio(Number(ym.slice(0, 4))); };
  const irPara = (alvo: { mes?: string; aba?: Aba }) => {
    if (alvo.mes) setMes(alvo.mes);
    if (alvo.aba) setAba(alvo.aba);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Filtros (no celular ficam recolhidos atrás do botão "Filtros")
  const [verFiltros, setVerFiltros] = useState(false);
  const [busca, setBusca] = useState("");
  const [fCategoria, setFCategoria] = useState<string>(TODOS);
  const [fProjeto, setFProjeto] = useState<string>(TODOS);
  const [fConta, setFConta] = useState<string>(TODOS);
  const [fForma, setFForma] = useState<string>(TODOS);
  const filtros: Filtros = {
    busca,
    categoria_id: fCategoria === TODOS ? null : fCategoria,
    projeto_id: fProjeto === TODOS ? null : fProjeto,
    conta_id: fConta === TODOS ? null : fConta,
    forma_pagamento: fForma === TODOS ? null : fForma,
  };
  const filtrando = !!busca.trim() || [fCategoria, fProjeto, fConta, fForma].some((f) => f !== TODOS);
  const limparFiltros = () => { setBusca(""); setFCategoria(TODOS); setFProjeto(TODOS); setFConta(TODOS); setFForma(TODOS); };

  // Diálogos
  const [dlgFixa, setDlgFixa] = useState<{ open: boolean; fixa: DespesaFixa | null }>({ open: false, fixa: null });
  const [dlgVar, setDlgVar] = useState<{ open: boolean; item: DespesaVariavel | null }>({ open: false, item: null });
  const [dlgRec, setDlgRec] = useState<{ open: boolean; item: Receita | null }>({ open: false, item: null });
  const [pagar, setPagar] = useState<OcorrenciaFixa | null>(null);
  const [reajuste, setReajuste] = useState<DespesaFixa | null>(null);
  const [encerrar, setEncerrar] = useState<DespesaFixa | null>(null);
  const [exclusao, setExclusao] = useState<Exclusao>(null);
  const [cadastros, setCadastros] = useState<{ open: boolean; aba: AbaCadastro }>({ open: false, aba: "categorias" });
  const [verCadastroFixas, setVerCadastroFixas] = useState(false);
  const abrirCadastros = (a: AbaCadastro) => setCadastros({ open: true, aba: a });

  // Janela de dados: 12 meses até o mês visto + o ano do relatório
  const [janelaDe, janelaAte] = [
    [addMonthsYM(mes, -11), `${anoRelatorio}-01`].sort()[0] ?? mes,
    [mes, `${anoRelatorio}-12`].sort()[1] ?? mes,
  ];
  const de = limitesDoMes(janelaDe).de;
  const ate = limitesDoMes(janelaAte).ate;

  // Dados (chave "familia": nada mais da Lardan é invalidado junto)
  const seed = useQuery({ queryKey: ["familia", "seed"], queryFn: garantirCategoriasPadrao, staleTime: Infinity, retry: 1 });
  const qCategorias = useQuery({ queryKey: ["familia", "categorias"], queryFn: listarCategorias, enabled: seed.isSuccess || seed.isError });
  const qContas = useQuery({ queryKey: ["familia", "contas"], queryFn: listarContas });
  const qProjetos = useQuery({ queryKey: ["familia", "projetos"], queryFn: listarProjetos });
  const qFixas = useQuery({ queryKey: ["familia", "fixas"], queryFn: listarFixas });
  const qRegistros = useQuery({ queryKey: ["familia", "registros", de, ate], queryFn: () => listarRegistros(`${janelaDe}-01`, `${janelaAte}-01`) });
  const qVariaveis = useQuery({ queryKey: ["familia", "variaveis", de, ate], queryFn: () => listarVariaveis(de, ate) });
  const qReceitas = useQuery({ queryKey: ["familia", "receitas", de, ate], queryFn: () => listarReceitas(de, ate) });

  const categorias: Categoria[] = useMemo(() => qCategorias.data ?? [], [qCategorias.data]);
  const contas: Conta[] = useMemo(() => qContas.data ?? [], [qContas.data]);
  const projetos: Projeto[] = useMemo(() => qProjetos.data ?? [], [qProjetos.data]);
  const regras: DespesaFixa[] = useMemo(() => qFixas.data ?? [], [qFixas.data]);
  const carregando = [qFixas, qRegistros, qVariaveis, qReceitas].some((q) => q.isLoading);
  const erro = [qCategorias, qContas, qProjetos, qFixas, qRegistros, qVariaveis, qReceitas].find((q) => q.error)?.error as Error | undefined;

  const catPorId = useMemo(() => new Map<string, Categoria>(categorias.map((c) => [c.id, c])), [categorias]);
  const contaPorId = useMemo(() => new Map<string, Conta>(contas.map((c) => [c.id, c])), [contas]);
  const projPorId = useMemo(() => new Map<string, Projeto>(projetos.map((p) => [p.id, p])), [projetos]);

  // Motor: tudo filtrado do mesmo jeito para cartões, listas, gráficos e relatório
  const todasFixas = useMemo(
    () => gerarOcorrenciasFixas(regras, qRegistros.data ?? [], janelaDe, janelaAte),
    [regras, qRegistros.data, janelaDe, janelaAte],
  );
  const dados = useMemo(() => ({
    fixas: filtrarFixas(todasFixas, filtros),
    variaveis: filtrarVariaveis(qVariaveis.data ?? [], filtros),
    receitas: filtrarReceitas(qReceitas.data ?? [], filtros),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [todasFixas, qVariaveis.data, qReceitas.data, busca, fCategoria, fProjeto, fConta, fForma]);

  const resumo = useMemo(() => resumirMes(mes, dados), [mes, dados]);
  const serie = useMemo(() => serieDesdePrimeiroMovimento(serieMensal(mes, 12, dados)), [mes, dados]);
  const anual = useMemo(() => resumoAnual(anoRelatorio, dados), [anoRelatorio, dados]);
  const fixasMes = dados.fixas.filter((o) => o.mes === mes);
  const variaveisMes = dados.variaveis.filter((v) => v.data.slice(0, 7) === mes);
  const receitasMes = dados.receitas.filter((r) => r.data.slice(0, 7) === mes);
  const porCategoriaMes = despesasPorCategoria(fixasMes, variaveisMes);
  const maioresGastos = [
    ...fixasMes.filter((o) => o.status !== "pulada").map((o) => ({ id: o.chave, nome: o.fixa.nome, valor: o.valor, cat: o.fixa.categoria_id, tipo: "Fixa" })),
    ...variaveisMes.map((v) => ({ id: v.id, nome: v.descricao, valor: v.valor, cat: v.categoria_id, tipo: "Variável" })),
  ].sort((a, b) => b.valor - a.valor).slice(0, 5);

  const porCategoriaAno = useMemo(() => {
    const ano = String(anoRelatorio);
    return despesasPorCategoria(
      dados.fixas.filter((o) => o.mes.startsWith(ano)),
      dados.variaveis.filter((v) => v.data.startsWith(ano)),
    );
  }, [dados, anoRelatorio]);

  /* ----------------------------- Ações rápidas ---------------------------- */
  const invalidar = () => qc.invalidateQueries({ queryKey: ["familia"] });
  const onErro = (e: Error) => toast.error(e.message);

  const pagarRapido = useMutation({
    mutationFn: (o: OcorrenciaFixa) => marcarFixaPaga(o.fixa.id, o.competencia, o.valor_previsto, hojeISO()),
    onSuccess: () => { toast.success("Marcada como paga"); void invalidar(); },
    onError: onErro,
  });
  const desmarcar = useMutation({
    mutationFn: (o: OcorrenciaFixa) => desmarcarFixa(o.fixa.id, o.competencia),
    onSuccess: () => { toast.success("Voltou para a pagar"); void invalidar(); },
    onError: onErro,
  });
  const pular = useMutation({
    mutationFn: (o: OcorrenciaFixa) => pularFixa(o.fixa.id, o.competencia),
    onSuccess: () => { toast.success("Mês pulado — não entra no total"); void invalidar(); },
    onError: onErro,
  });
  const reativar = useMutation({
    mutationFn: (f: DespesaFixa) => encerrarFixa(f.id, null),
    onSuccess: () => { toast.success("Despesa fixa reativada"); void invalidar(); },
    onError: onErro,
  });
  const alternarPagoVar = useMutation({
    mutationFn: (v: DespesaVariavel) => marcarVariavelPaga(v.id, v.data_pagamento ? null : hojeISO()),
    onSuccess: (_r, v) => { toast.success(v.data_pagamento ? "Marcada como em aberto" : "Marcada como paga"); void invalidar(); },
    onError: onErro,
  });
  const excluir = useMutation({
    mutationFn: async ({ ex, escopo }: { ex: NonNullable<Exclusao>; escopo: EscopoEdicao }) => {
      if (ex.tipo === "fixa") return excluirFixa(ex.item.id);
      if (ex.tipo === "variavel") return excluirVariavel(ex.item, escopo);
      return excluirReceita(ex.item, escopo);
    },
    onSuccess: () => { toast.success("Excluído"); setExclusao(null); void invalidar(); },
    onError: onErro,
  });

  /* --------------------------------- CSV --------------------------------- */
  function exportarMes() {
    type Linha = { tipo: string; data: string; descricao: string; categoria: string; forma: string; projeto: string; conta: string; status: string; valor: number };
    const linhas: Linha[] = [
      ...receitasMes.map((r) => ({
        tipo: "Receita", data: r.data, descricao: r.fonte, categoria: catPorId.get(r.categoria_id ?? "")?.nome ?? "",
        forma: rotuloForma(r.forma_pagamento), projeto: "", conta: "", status: r.data > hojeISO() ? "Prevista" : "Recebida", valor: r.valor,
      })),
      ...fixasMes.map((o) => ({
        tipo: "Despesa fixa", data: o.vencimento, descricao: o.fixa.nome + (o.parcela ? ` (${o.parcela.numero}/${o.parcela.total})` : ""),
        categoria: catPorId.get(o.fixa.categoria_id ?? "")?.nome ?? "", forma: rotuloForma(o.fixa.forma_pagamento),
        projeto: projPorId.get(o.fixa.projeto_id ?? "")?.nome ?? "", conta: contaPorId.get(o.fixa.conta_id ?? "")?.nome ?? "",
        status: o.status === "pago" ? "Paga" : o.status === "pulada" ? "Pulada" : "A pagar", valor: o.valor,
      })),
      ...variaveisMes.map((v) => ({
        tipo: "Despesa variável", data: v.data, descricao: v.descricao, categoria: catPorId.get(v.categoria_id ?? "")?.nome ?? "",
        forma: rotuloForma(v.forma_pagamento), projeto: projPorId.get(v.projeto_id ?? "")?.nome ?? "",
        conta: contaPorId.get(v.conta_id ?? "")?.nome ?? "", status: v.data_pagamento ? "Paga" : "Em aberto", valor: v.valor,
      })),
    ].sort((a, b) => a.data.localeCompare(b.data));
    try {
      baixarCSV<Linha>(`financeiro-familia-${mes}`, linhas, [
        { titulo: "Tipo", valor: (l) => l.tipo },
        { titulo: "Data", valor: (l) => formatISODateBR(l.data) },
        { titulo: "Descrição", valor: (l) => l.descricao },
        { titulo: "Categoria", valor: (l) => l.categoria },
        { titulo: "Forma", valor: (l) => l.forma },
        { titulo: "Projeto", valor: (l) => l.projeto },
        { titulo: "Conta", valor: (l) => l.conta },
        { titulo: "Situação", valor: (l) => l.status },
        { titulo: "Valor", valor: (l) => reaisCSV(l.valor) },
      ]);
    } catch (e) { onErro(e as Error); }
  }

  function exportarAno() {
    try {
      baixarCSV(`financeiro-familia-${anoRelatorio}`, [...anual.meses, anual.total], [
        { titulo: "Mês", valor: (m) => (m.mes.length === 4 ? `Total ${m.mes}` : rotuloMesLongo(m.mes)) },
        { titulo: "Receitas", valor: (m) => reaisCSV(m.receitas) },
        { titulo: "Despesas fixas", valor: (m) => reaisCSV(m.despesasFixas) },
        { titulo: "Despesas variáveis", valor: (m) => reaisCSV(m.despesasVariaveis) },
        { titulo: "Total despesas", valor: (m) => reaisCSV(m.despesas) },
        { titulo: "Saldo", valor: (m) => reaisCSV(m.saldo) },
        { titulo: "Economia %", valor: (m) => (m.economiaPct == null ? "" : String(m.economiaPct).replace(".", ",")) },
      ]);
    } catch (e) { onErro(e as Error); }
  }

  /* ------------------------------ Helpers UI ------------------------------ */
  const meta = (partes: (string | null | undefined | false)[]) => partes.filter(Boolean).join(" · ");
  const nomeCat = (id: string | null) => (id ? catPorId.get(id)?.nome : null) ?? "Sem categoria";
  const corCat = (id: string | null) => (id ? catPorId.get(id)?.cor : null) ?? null;

  const vazioGeral = !carregando && !erro && mes === mesAtual && regras.length === 0 && (qVariaveis.data ?? []).length === 0 && (qReceitas.data ?? []).length === 0;

  const botoesNovo = (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <Button className="h-12 sm:h-11" onClick={() => setDlgFixa({ open: true, fixa: null })}>
        <Repeat className="mr-1 size-4" /> Despesa fixa
      </Button>
      <Button variant="outline" className="h-12 sm:h-11" onClick={() => setDlgVar({ open: true, item: null })}>
        <Plus className="mr-1 size-4" /> Despesa variável
      </Button>
      <Button variant="outline" className="h-12 sm:h-11" onClick={() => setDlgRec({ open: true, item: null })}>
        <TrendingUp className="mr-1 size-4 text-success" /> Receita
      </Button>
      <Button variant="outline" className="h-12 sm:h-11" onClick={() => abrirCadastros("categorias")}>
        <Settings2 className="mr-1 size-4" /> Cadastros
      </Button>
    </div>
  );

  const cartao = "rounded-2xl border border-border bg-card";

  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>Controle das contas da casa: fixas, variáveis e receitas. <strong className="text-foreground">Privado</strong> — só você vê, nem a equipe Lardan tem acesso.</span>
      </p>

      {botoesNovo}

      {/* Barra: mês + exportar + filtros */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <NavegadorMes mes={mes} onChange={setMes} />
        <div className="flex gap-2">
          <Button variant="outline" className={cn("h-11 sm:hidden", filtrando && "border-primary text-primary")} onClick={() => setVerFiltros((v) => !v)} aria-expanded={verFiltros}>
            <SlidersHorizontal className="mr-1 size-4" /> Filtros{filtrando ? " ativos" : ""}
          </Button>
          <Button variant="outline" className="h-11" onClick={exportarMes}>
            <FileSpreadsheet className="mr-1 size-4" /> <span className="hidden sm:inline">Exportar mês</span><span className="sm:hidden">Exportar</span>
          </Button>
        </div>
      </div>

      <div className={cn("flex-wrap items-center gap-2", verFiltros ? "flex" : "hidden sm:flex")}>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar lançamento…" className="h-11 pl-9 text-base" aria-label="Buscar" />
        </div>
        <FiltroSelect valor={fCategoria} onChange={setFCategoria} todos="Todas as categorias" itens={categorias.map((c) => ({ id: c.id, nome: `${c.nome}${c.tipo === "receita" ? " (receita)" : ""}`, cor: c.cor }))} />
        <FiltroSelect valor={fProjeto} onChange={setFProjeto} todos="Todos os projetos" itens={projetos.map((p) => ({ id: p.id, nome: p.nome, cor: p.cor }))} />
        <FiltroSelect valor={fConta} onChange={setFConta} todos="Todas as contas" itens={contas.map((c) => ({ id: c.id, nome: c.nome, cor: c.cor }))} />
        <FiltroSelect valor={fForma} onChange={setFForma} todos="Todas as formas" itens={FORMAS_PAGAMENTO.map((f) => ({ id: f.valor, nome: f.rotulo, cor: f.cor }))} />
        {filtrando && <Button variant="ghost" className="h-11" onClick={limparFiltros}>Limpar filtros</Button>}
      </div>

      {erro && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Não foi possível carregar os dados: {erro.message}
        </div>
      )}

      {/* Números do mês */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi rotulo="Receitas" valor={formatBRL(resumo.receitas)} icone={TrendingUp} tom="ok" dica={`${receitasMes.length} lançamento(s)`} carregando={carregando} />
        <Kpi rotulo="Despesas fixas" valor={formatBRL(resumo.despesasFixas)} icone={Repeat} dica={`${resumo.qtdFixasPagas} de ${resumo.qtdFixas} pagas`} carregando={carregando} />
        <Kpi rotulo="Despesas variáveis" valor={formatBRL(resumo.despesasVariaveis)} icone={Layers} tom="atencao" dica={`${variaveisMes.length} lançamento(s)`} carregando={carregando} />
        <Kpi rotulo="Saldo do mês" valor={formatBRL(resumo.saldo)} icone={Wallet} tom={resumo.saldo >= 0 ? "ok" : "perigo"} dica="receitas − despesas" carregando={carregando} />
        <Kpi rotulo="Economia" valor={pct(resumo.economiaPct)} icone={Home} dica="do que entrou, quanto sobrou" carregando={carregando} />
        <Kpi rotulo="Total de contas" valor={formatBRL(resumo.despesas)} icone={TrendingDown} tom="perigo" dica="fixas + variáveis" carregando={carregando} />
        <Kpi rotulo="Total pago" valor={formatBRL(resumo.pago)} icone={Check} tom="ok" dica={`restam ${formatBRL(resumo.emAberto)}`} carregando={carregando} className="col-span-2 md:col-span-2" />
      </div>
      {filtrando && <p className="text-xs text-muted-foreground">Números considerando os filtros aplicados.</p>}

      {vazioGeral ? (
        <div className={cartao}>
          <Vazio
            icone={Home}
            titulo="Comece pelo que se repete todo mês"
            texto="Cadastre aluguel, energia, escola e o que você ganha (inclusive seus ganhos LARDAN). Depois é só lançar os gastos do dia a dia."
          />
        </div>
      ) : (
        <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
          <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            <TabsList className="h-auto w-max justify-start">
              <TabsTrigger value="visao" className="min-h-10">Visão geral</TabsTrigger>
              <TabsTrigger value="fixas" className="min-h-10">Fixas</TabsTrigger>
              <TabsTrigger value="variaveis" className="min-h-10">Variáveis</TabsTrigger>
              <TabsTrigger value="receitas" className="min-h-10">Receitas</TabsTrigger>
              <TabsTrigger value="anual" className="min-h-10">Ano</TabsTrigger>
            </TabsList>
          </div>

          {/* ============================ VISÃO GERAL ============================ */}
          <TabsContent value="visao" className="mt-4 space-y-4">
            <div className={cn(cartao, "p-4 sm:p-5")}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-semibold">Receitas x despesas</h3>
                <span className="text-xs text-muted-foreground">até {rotuloMesCurto(mes)}</span>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={serie.map((s) => ({ ...s, rotulo: rotuloMesCurto(s.mes) }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={brlCurto} width={58} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatBRL(v)} />
                  <Legend />
                  <Bar dataKey="receitas" name="Receitas" fill={COR_RECEITA} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="despesas" name="Despesas" fill={COR_DESPESA} radius={[4, 4, 0, 0]} />
                  <Line dataKey="saldo" name="Saldo" stroke={COR_SALDO} strokeWidth={2} dot={false} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className={cn(cartao, "p-4 sm:p-5")}>
                <h3 className="mb-3 font-semibold">Despesas de {rotuloMesLongo(mes)} por categoria</h3>
                {porCategoriaMes.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">Sem despesas neste mês.</p>
                ) : (
                  <div className="grid items-center gap-4 sm:grid-cols-2">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={porCategoriaMes} dataKey="total" nameKey="categoria_id" innerRadius={52} outerRadius={84} paddingAngle={2}>
                          {porCategoriaMes.map((c) => <Cell key={c.categoria_id ?? "sem"} fill={corCat(c.categoria_id) ?? "#94A3B8"} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _n, p) => [formatBRL(v), nomeCat((p?.payload as { categoria_id: string | null } | undefined)?.categoria_id ?? null)]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1.5">
                      {porCategoriaMes.slice(0, 8).map((c) => (
                        <div key={c.categoria_id ?? "sem"} className="flex items-center gap-2 text-sm">
                          <Ponto cor={corCat(c.categoria_id)} />
                          <span className="flex-1 truncate">{nomeCat(c.categoria_id)}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{c.pct.toLocaleString("pt-BR")}%</span>
                          <span className="w-24 text-right font-semibold tabular-nums">{formatBRL(c.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className={cn(cartao, "space-y-4 p-4 sm:p-5")}>
                <h3 className="font-semibold">Como está o mês</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Fixas pagas</span>
                    <span className="font-semibold tabular-nums">{resumo.qtdFixasPagas} de {resumo.qtdFixas}</span>
                  </div>
                  <Progress value={resumo.qtdFixas ? (resumo.qtdFixasPagas / resumo.qtdFixas) * 100 : 0} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-xs text-muted-foreground">Fixas</p>
                    <p className="font-semibold tabular-nums">{formatBRL(resumo.despesasFixas)}</p>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-xs text-muted-foreground">Variáveis</p>
                    <p className="font-semibold tabular-nums">{formatBRL(resumo.despesasVariaveis)}</p>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Maiores gastos</p>
                  {maioresGastos.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
                  <div className="space-y-1.5">
                    {maioresGastos.map((g) => (
                      <div key={g.id} className="flex items-center gap-2 text-sm">
                        <Ponto cor={corCat(g.cat)} />
                        <span className="flex-1 truncate">{g.nome}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{g.tipo}</span>
                        <span className="w-24 text-right font-semibold tabular-nums">{formatBRL(g.valor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ============================ FIXAS ============================ */}
          <TabsContent value="fixas" className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {verCadastroFixas
                  ? `${regras.length} despesa(s) fixa(s) cadastrada(s)`
                  : `${fixasMes.length} em ${rotuloMesLongo(mes)} · total ${formatBRL(resumo.despesasFixas)} · pagas ${resumo.qtdFixasPagas} de ${resumo.qtdFixas}`}
              </p>
              <div className="inline-flex rounded-xl border border-border p-0.5">
                <button type="button" onClick={() => setVerCadastroFixas(false)} className={cn("min-h-10 rounded-lg px-3 text-sm font-semibold", !verCadastroFixas ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Do mês</button>
                <button type="button" onClick={() => setVerCadastroFixas(true)} className={cn("min-h-10 rounded-lg px-3 text-sm font-semibold", verCadastroFixas ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Cadastro</button>
              </div>
            </div>

            {!verCadastroFixas ? (
              <div className={cn(cartao, "divide-y divide-border")}>
                {fixasMes.length === 0 && (
                  <Vazio icone={Repeat} titulo="Nenhuma despesa fixa neste mês" texto={filtrando ? "Nada com esses filtros." : "Cadastre aluguel, energia, internet, escola…"}
                    acao={<Button className="h-11" onClick={() => setDlgFixa({ open: true, fixa: null })}><Plus className="mr-1 size-4" /> Despesa fixa</Button>} />
                )}
                {fixasMes.map((o) => (
                  <div key={o.chave} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:flex-nowrap", o.status === "pulada" && "opacity-60")}>
                    <Ponto cor={corCat(o.fixa.categoria_id)} />
                    <div className="min-w-0 flex-1 basis-[calc(100%-1.5rem)] sm:basis-0">
                      <p className="truncate font-medium">
                        {o.fixa.nome}
                        {o.parcela && <span className="ml-2 text-xs text-muted-foreground">{o.parcela.numero}/{o.parcela.total}</span>}
                        {o.fixa.recorrencia === "anual" && <span className="ml-2 text-[10px] uppercase tracking-wider text-primary">anual</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {meta([
                          `Vence ${formatISODateBR(o.vencimento)}`,
                          nomeCat(o.fixa.categoria_id),
                          rotuloForma(o.fixa.forma_pagamento),
                          o.fixa.projeto_id && projPorId.get(o.fixa.projeto_id)?.nome,
                          o.fixa.conta_id && contaPorId.get(o.fixa.conta_id)?.nome,
                          o.status === "pago" && o.registro?.data_pagamento && `pago em ${formatISODateBR(o.registro.data_pagamento)}`,
                        ])}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <div className="text-right">
                        <p className={cn("font-semibold tabular-nums", o.status === "pulada" && "line-through")}>{formatBRL(o.status === "pulada" ? o.valor_previsto : o.valor)}</p>
                        {o.status === "pago" && o.valor !== o.valor_previsto && (
                          <p className="text-[10px] text-muted-foreground">previsto {formatBRL(o.valor_previsto)}</p>
                        )}
                      </div>
                      <Chip tom={o.status === "pago" ? "ok" : o.status === "pulada" ? "apagado" : "neutro"}>
                        {o.status === "pago" ? "Paga" : o.status === "pulada" ? "Pulada" : "A pagar"}
                      </Chip>
                      {o.status === "a_pagar" ? (
                        <Button variant="outline" className="h-10" onClick={() => pagarRapido.mutate(o)} disabled={pagarRapido.isPending} title="Marcar como paga hoje, pelo valor previsto">
                          <Check className="mr-1 size-4 text-success" /> Pagar
                        </Button>
                      ) : (
                        <Button size="icon" variant="ghost" className="size-10" onClick={() => desmarcar.mutate(o)} title="Desfazer" aria-label="Desfazer">
                          <Undo2 className="size-4" />
                        </Button>
                      )}
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="size-10" aria-label="Mais ações"><MoreHorizontal className="size-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          <DropdownMenuItem className="min-h-10" onClick={() => setPagar(o)}><Check className="mr-2 size-4" /> Pagar com outro valor/data</DropdownMenuItem>
                          {o.status !== "pulada"
                            ? <DropdownMenuItem className="min-h-10" onClick={() => pular.mutate(o)}><ChevronRight className="mr-2 size-4" /> Pular este mês</DropdownMenuItem>
                            : <DropdownMenuItem className="min-h-10" onClick={() => desmarcar.mutate(o)}><Undo2 className="mr-2 size-4" /> Desfazer pulo</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="min-h-10" onClick={() => setDlgFixa({ open: true, fixa: o.fixa })}><Pencil className="mr-2 size-4" /> Editar despesa fixa</DropdownMenuItem>
                          {!o.fixa.parcelado && <DropdownMenuItem className="min-h-10" onClick={() => setReajuste(o.fixa)}><RefreshCw className="mr-2 size-4" /> Reajustar valor</DropdownMenuItem>}
                          <DropdownMenuItem className="min-h-10" onClick={() => setEncerrar(o.fixa)}><Power className="mr-2 size-4" /> Encerrar</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="min-h-10 text-destructive focus:text-destructive" onClick={() => setExclusao({ tipo: "fixa", item: o.fixa })}>
                            <Trash2 className="mr-2 size-4" /> Excluir despesa fixa
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={cn(cartao, "divide-y divide-border")}>
                {regras.length === 0 && <Vazio icone={Repeat} titulo="Nenhuma despesa fixa cadastrada" />}
                {regras.map((f) => {
                  const fim = ultimoMesDaRegra(f);
                  const encerrada = !!fim && fim < mesAtual;
                  // Situação: Ativa · Até Mmm/AA (vai encerrar) · Encerrada · Concluída (parcelas quitadas)
                  const situacao = encerrada
                    ? (f.parcelado && !f.encerrada_em ? "Concluída" : "Encerrada")
                    : f.encerrada_em ? `Até ${rotuloMesCurto(f.encerrada_em.slice(0, 7))}` : "Ativa";
                  return (
                    <div key={f.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:flex-nowrap", encerrada && "opacity-60")}>
                      <Ponto cor={corCat(f.categoria_id)} />
                      <div className="min-w-0 flex-1 basis-[calc(100%-1.5rem)] sm:basis-0">
                        <p className="truncate font-medium">{f.nome}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {meta([
                            `Dia ${f.dia_vencimento}`,
                            f.recorrencia === "anual" ? "Anual" : "Mensal",
                            f.parcelado && `${f.parcelas_total} parcelas`,
                            `de ${rotuloMesCurto(f.mes_inicio.slice(0, 7))}${fim ? ` até ${rotuloMesCurto(fim)}` : " sem fim"}`,
                            nomeCat(f.categoria_id),
                          ])}
                        </p>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <span className="font-semibold tabular-nums">{formatBRL(f.valor)}</span>
                        <Chip tom={encerrada ? "apagado" : f.encerrada_em ? "neutro" : "info"}>{situacao}</Chip>
                        <Button size="icon" variant="ghost" className="size-10" onClick={() => setDlgFixa({ open: true, fixa: f })} aria-label="Editar"><Pencil className="size-4" /></Button>
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="size-10" aria-label="Mais ações"><MoreHorizontal className="size-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            {!f.parcelado && <DropdownMenuItem className="min-h-10" onClick={() => setReajuste(f)}><RefreshCw className="mr-2 size-4" /> Reajustar valor</DropdownMenuItem>}
                            {f.encerrada_em
                              ? <DropdownMenuItem className="min-h-10" onClick={() => reativar.mutate(f)}><Power className="mr-2 size-4" /> Reativar</DropdownMenuItem>
                              : <DropdownMenuItem className="min-h-10" onClick={() => setEncerrar(f)}><Power className="mr-2 size-4" /> Encerrar</DropdownMenuItem>}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="min-h-10 text-destructive focus:text-destructive" onClick={() => setExclusao({ tipo: "fixa", item: f })}>
                              <Trash2 className="mr-2 size-4" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ============================ VARIÁVEIS ============================ */}
          <TabsContent value="variaveis" className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {variaveisMes.length} lançamento(s) · total {formatBRL(resumo.despesasVariaveis)}
              </p>
              <Button className="h-11" onClick={() => setDlgVar({ open: true, item: null })}><Plus className="mr-1 size-4" /> Despesa variável</Button>
            </div>
            <div className={cn(cartao, "divide-y divide-border")}>
              {variaveisMes.length === 0 && (
                <Vazio icone={Layers} titulo="Nenhuma despesa variável neste mês" texto={filtrando ? "Nada com esses filtros." : "Mercado, farmácia, combustível, delivery…"} />
              )}
              {variaveisMes.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:flex-nowrap">
                  <Ponto cor={corCat(v.categoria_id)} />
                  <div className="min-w-0 flex-1 basis-[calc(100%-1.5rem)] sm:basis-0">
                    <p className="truncate font-medium">
                      {v.descricao}
                      {v.grupo_id && <span className="ml-2 text-xs text-muted-foreground">{v.ocorrencia_numero}/{v.ocorrencias_total}</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {meta([
                        formatISODateBR(v.data),
                        nomeCat(v.categoria_id),
                        rotuloForma(v.forma_pagamento),
                        v.projeto_id && projPorId.get(v.projeto_id)?.nome,
                        v.conta_id && contaPorId.get(v.conta_id)?.nome,
                        v.data_pagamento && `pago em ${formatISODateBR(v.data_pagamento)}`,
                      ])}
                    </p>
                    {v.observacoes && <p className="truncate text-[11px] text-muted-foreground/80">{v.observacoes}</p>}
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="font-semibold tabular-nums">{formatBRL(v.valor)}</span>
                    <Chip tom={v.data_pagamento ? "ok" : "neutro"}>{v.data_pagamento ? "Paga" : "Em aberto"}</Chip>
                    <Button size="icon" variant="ghost" className="size-10" onClick={() => alternarPagoVar.mutate(v)} title={v.data_pagamento ? "Marcar em aberto" : "Marcar paga hoje"} aria-label={v.data_pagamento ? "Marcar em aberto" : "Marcar paga hoje"}>
                      {v.data_pagamento ? <Undo2 className="size-4" /> : <Check className="size-4 text-success" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="size-10" onClick={() => setDlgVar({ open: true, item: v })} aria-label="Editar"><Pencil className="size-4" /></Button>
                    <Button size="icon" variant="ghost" className="size-10" onClick={() => setExclusao({ tipo: "variavel", item: v })} aria-label="Excluir"><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ============================ RECEITAS ============================ */}
          <TabsContent value="receitas" className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {receitasMes.length} receita(s) · total {formatBRL(resumo.receitas)}
              </p>
              <Button className="h-11" onClick={() => setDlgRec({ open: true, item: null })}><Plus className="mr-1 size-4" /> Receita</Button>
            </div>
            <div className={cn(cartao, "divide-y divide-border")}>
              {receitasMes.length === 0 && (
                <Vazio icone={TrendingUp} titulo="Nenhuma receita neste mês" texto={filtrando ? "Nada com esses filtros." : "Ganhos LARDAN, salário, freelance, aluguel recebido…"} />
              )}
              {receitasMes.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:flex-nowrap">
                  <Ponto cor={corCat(r.categoria_id)} />
                  <div className="min-w-0 flex-1 basis-[calc(100%-1.5rem)] sm:basis-0">
                    <p className="truncate font-medium">
                      {r.fonte}
                      {r.grupo_id && <span className="ml-2 text-xs text-muted-foreground">{r.ocorrencia_numero}/{r.ocorrencias_total}</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {meta([formatISODateBR(r.data), nomeCat(r.categoria_id), rotuloForma(r.forma_pagamento)])}
                    </p>
                    {r.observacoes && <p className="truncate text-[11px] text-muted-foreground/80">{r.observacoes}</p>}
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="font-semibold tabular-nums text-success">{formatBRL(r.valor)}</span>
                    {r.data > hojeISO() && <Chip tom="info">Prevista</Chip>}
                    <Button size="icon" variant="ghost" className="size-10" onClick={() => setDlgRec({ open: true, item: r })} aria-label="Editar"><Pencil className="size-4" /></Button>
                    <Button size="icon" variant="ghost" className="size-10" onClick={() => setExclusao({ tipo: "receita", item: r })} aria-label="Excluir"><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ============================ ANUAL ============================ */}
          <TabsContent value="anual" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 rounded-xl border border-border bg-card px-1 py-0.5">
                <Button variant="ghost" size="icon" className="size-11" onClick={() => setAnoRelatorio((a) => a - 1)} aria-label="Ano anterior"><ChevronLeft className="size-5" /></Button>
                <span className="min-w-[72px] text-center text-base font-semibold tabular-nums">{anoRelatorio}</span>
                <Button variant="ghost" size="icon" className="size-11" onClick={() => setAnoRelatorio((a) => a + 1)} aria-label="Próximo ano"><ChevronRight className="size-5" /></Button>
              </div>
              <Button variant="outline" className="h-11" onClick={exportarAno}><FileSpreadsheet className="mr-1 size-4" /> Exportar ano</Button>
            </div>

            {/* Celular: um cartão por mês */}
            <div className="space-y-2 md:hidden">
              {anual.meses.map((m, i) => (
                <button key={m.mes} type="button" onClick={() => irPara({ mes: m.mes, aba: "visao" })}
                  className={cn(cartao, "w-full p-4 text-left active:bg-muted", m.mes === mes && "border-primary/50")}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{MESES_LONGOS[i]}</span>
                    <span className={cn("font-semibold tabular-nums", m.saldo >= 0 ? "text-success" : "text-destructive")}>{formatBRL(m.saldo)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                    <span>Entrou <span className="tabular-nums text-success">{formatBRL(m.receitas)}</span></span>
                    <span>Saiu <span className="tabular-nums text-foreground">{formatBRL(m.despesas)}</span></span>
                    <span>Economia {pct(m.economiaPct)}</span>
                  </div>
                </button>
              ))}
              <div className={cn(cartao, "border-2 p-4")}>
                <div className="flex items-center justify-between">
                  <span className="font-bold">Total {anoRelatorio}</span>
                  <span className={cn("font-bold tabular-nums", anual.total.saldo >= 0 ? "text-success" : "text-destructive")}>{formatBRL(anual.total.saldo)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                  <span>Entrou <span className="tabular-nums text-success">{formatBRL(anual.total.receitas)}</span></span>
                  <span>Saiu <span className="tabular-nums text-foreground">{formatBRL(anual.total.despesas)}</span></span>
                  <span>Economia {pct(anual.total.economiaPct)}</span>
                </div>
              </div>
            </div>

            {/* Computador: tabela */}
            <div className={cn(cartao, "hidden overflow-x-auto md:block")}>
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Mês</th>
                    <th className="px-4 py-3 text-right font-semibold">Receitas</th>
                    <th className="px-4 py-3 text-right font-semibold">Fixas</th>
                    <th className="px-4 py-3 text-right font-semibold">Variáveis</th>
                    <th className="px-4 py-3 text-right font-semibold">Despesas</th>
                    <th className="px-4 py-3 text-right font-semibold">Saldo</th>
                    <th className="px-4 py-3 text-right font-semibold">Economia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {anual.meses.map((m, i) => (
                    <tr
                      key={m.mes}
                      className={cn("cursor-pointer transition-colors hover:bg-muted/40", m.mes === mes && "bg-primary/5")}
                      onClick={() => irPara({ mes: m.mes, aba: "visao" })}
                      title="Abrir este mês"
                    >
                      <td className="px-4 py-2.5 font-medium">{MESES_LONGOS[i]}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-success">{formatBRL(m.receitas)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(m.despesasFixas)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(m.despesasVariaveis)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(m.despesas)}</td>
                      <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", m.saldo >= 0 ? "text-success" : "text-destructive")}>{formatBRL(m.saldo)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{pct(m.economiaPct)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-bold">
                    <td className="px-4 py-3">Total {anoRelatorio}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-success">{formatBRL(anual.total.receitas)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatBRL(anual.total.despesasFixas)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatBRL(anual.total.despesasVariaveis)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatBRL(anual.total.despesas)}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums", anual.total.saldo >= 0 ? "text-success" : "text-destructive")}>{formatBRL(anual.total.saldo)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{pct(anual.total.economiaPct)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className={cn(cartao, "p-4 sm:p-5")}>
              <h3 className="mb-3 font-semibold">Despesas de {anoRelatorio} por categoria</h3>
              {porCategoriaAno.length === 0 && <p className="text-sm text-muted-foreground">Sem despesas no ano.</p>}
              <div className="space-y-3">
                {porCategoriaAno.map((c) => (
                  <div key={c.categoria_id ?? "sem"} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-sm">
                      <Ponto cor={corCat(c.categoria_id)} />
                      <span className="min-w-0 flex-1 truncate">{nomeCat(c.categoria_id)}</span>
                      <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">média {formatBRL(c.total / 12)}/mês</span>
                      <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{c.pct.toLocaleString("pt-BR")}%</span>
                      <span className="w-28 text-right font-semibold tabular-nums">{formatBRL(c.total)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, c.pct)}%`, background: corCat(c.categoria_id) ?? undefined }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* ============================ DIÁLOGOS ============================ */}
      <DespesaFixaDialog
        open={dlgFixa.open} onOpenChange={(o) => setDlgFixa((s) => ({ ...s, open: o }))} fixa={dlgFixa.fixa} mesPadrao={mes}
        categorias={categorias} contas={contas} projetos={projetos} onGerenciar={abrirCadastros}
      />
      <DespesaVariavelDialog
        open={dlgVar.open} onOpenChange={(o) => setDlgVar((s) => ({ ...s, open: o }))} despesa={dlgVar.item} mesPadrao={mes}
        categorias={categorias} contas={contas} projetos={projetos} onGerenciar={abrirCadastros}
      />
      <ReceitaDialog
        open={dlgRec.open} onOpenChange={(o) => setDlgRec((s) => ({ ...s, open: o }))} receita={dlgRec.item} mesPadrao={mes}
        categorias={categorias} onGerenciar={abrirCadastros}
      />
      <PagarFixaDialog open={!!pagar} onOpenChange={(o) => { if (!o) setPagar(null); }} ocorrencia={pagar} />
      <ReajusteDialog open={!!reajuste} onOpenChange={(o) => { if (!o) setReajuste(null); }} fixa={reajuste} mesPadrao={mes} />
      <EncerrarFixaDialog open={!!encerrar} onOpenChange={(o) => { if (!o) setEncerrar(null); }} fixa={encerrar} mesPadrao={mes} />
      <ExcluirComEscopoDialog
        open={!!exclusao}
        onOpenChange={(o) => { if (!o) setExclusao(null); }}
        titulo={exclusao?.tipo === "fixa" ? "Excluir despesa fixa?" : exclusao?.tipo === "receita" ? "Excluir receita?" : "Excluir despesa?"}
        item={
          exclusao?.tipo === "fixa"
            ? `${exclusao.item.nome} — some de todos os meses, inclusive os já pagos. Para parar daqui pra frente, use "Encerrar".`
            : exclusao?.tipo === "receita" ? exclusao.item.fonte : exclusao?.item.descricao ?? ""
        }
        recorrente={exclusao?.tipo !== "fixa" && !!exclusao?.item.grupo_id}
        excluindo={excluir.isPending}
        onConfirmar={(escopo) => { if (exclusao) excluir.mutate({ ex: exclusao, escopo }); }}
      />
      <CadastrosDialog
        open={cadastros.open}
        onOpenChange={(o) => setCadastros((s) => ({ ...s, open: o }))}
        aba={cadastros.aba}
        onAba={(a) => setCadastros((s) => ({ ...s, aba: a }))}
        categorias={categorias}
        contas={contas}
        projetos={projetos}
      />
    </div>
  );
}

/* --------------------------------------------------------------------------- */

function Kpi({
  rotulo, valor, icone: Icone, tom = "neutro", dica, carregando, className,
}: {
  rotulo: string; valor: string; icone: React.ComponentType<{ className?: string }>;
  tom?: "neutro" | "ok" | "atencao" | "perigo"; dica?: string; carregando?: boolean; className?: string;
}) {
  const corIcone = { neutro: "text-primary", ok: "text-success", atencao: "text-warning", perigo: "text-destructive" }[tom];
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{rotulo}</p>
        <Icone className={cn("size-4 shrink-0", corIcone)} />
      </div>
      <p className="mt-2 text-lg font-bold tabular-nums tracking-tight sm:text-2xl">{carregando ? "—" : valor}</p>
      {dica && <p className="mt-1 truncate text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

function FiltroSelect({
  valor, onChange, todos, itens,
}: { valor: string; onChange: (v: string) => void; todos: string; itens: { id: string; nome: string; cor?: string }[] }) {
  if (itens.length === 0) return null;
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger className={cn("h-11 w-full min-w-[150px] text-sm sm:w-auto", valor !== TODOS && "border-primary/60 text-primary")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{todos}</SelectItem>
        {itens.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            <span className="inline-flex items-center gap-2"><Ponto cor={i.cor ?? null} /> {i.nome}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

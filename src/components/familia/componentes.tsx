/* ============================================================
 * FINANCEIRO DA FAMÍLIA — componentes de formulário/tela
 * Só usa o kit visual compartilhado (@/components/ui) e o próprio
 * módulo (@/lib/familia). Nada dos módulos de negócio da Lardan.
 * ============================================================ */
import * as React from "react";
import { useMemo, useState, type ReactNode } from "react";
import { Building2, Calendar, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { addMonthsYM, toISOMonth } from "@/lib/familia/datas";
import { mascararCentavos, formatBRLInput } from "@/lib/familia/dinheiro";
import { FORMAS_PAGAMENTO, type Categoria, type Conta, type FormaPagamento, type Projeto, type TipoCategoria } from "@/lib/familia/tipos";

export const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const MESES_LONGOS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** "2026-10" → "Out/26" */
export function rotuloMesCurto(ym: string) {
  const y = ym.slice(0, 4);
  const m = Number(ym.slice(5, 7));
  return `${MESES_CURTOS[m - 1] ?? ""}/${y.slice(2)}`;
}
/** "2026-10" → "Outubro de 2026" */
export function rotuloMesLongo(ym: string) {
  const y = ym.slice(0, 4);
  const m = Number(ym.slice(5, 7));
  return `${MESES_LONGOS[m - 1] ?? ""} de ${y}`;
}

/** Bolinha de cor (categoria, forma, projeto). */
export function Ponto({ cor, className }: { cor?: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground", className)}
      style={cor ? { background: cor } : undefined}
    />
  );
}

/** Rótulo de campo com ação opcional "Gerenciar" à direita (padrão dos prints). */
export function Campo({
  rotulo, obrigatorio, onGerenciar, children, htmlFor, className,
}: {
  rotulo: string; obrigatorio?: boolean; onGerenciar?: () => void; children: ReactNode; htmlFor?: string; className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex min-h-[20px] items-center justify-between">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {rotulo}{obrigatorio && <span className="text-destructive"> *</span>}
        </Label>
        {onGerenciar && (
          <button
            type="button"
            onClick={onGerenciar}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
          >
            <Settings2 className="h-3.5 w-3.5" /> Gerenciar
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Valor em reais com máscara de centavos ("150000" → 1.500,00). */
export function CampoValor({
  valor, onChange, id, autoFocus,
}: { valor: number; onChange: (v: number) => void; id?: string; autoFocus?: boolean }) {
  const texto = valor > 0 ? formatBRLInput(valor) : "";
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
      <Input
        id={id}
        autoFocus={autoFocus}
        inputMode="numeric"
        className="h-11 pl-10 text-base tabular-nums"
        placeholder="0,00"
        value={texto}
        onChange={(e) => onChange(mascararCentavos(e.target.value).valor)}
        aria-label="Valor em reais"
      />
    </div>
  );
}

/** Seletor "Data única / Recorrente" em dois cartões (padrão dos prints). */
export function ToggleTipo({ recorrente, onChange }: { recorrente: boolean; onChange: (v: boolean) => void }) {
  const opcao = (ativo: boolean, icone: ReactNode, texto: string, valor: boolean) => (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={() => onChange(valor)}
      className={cn(
        "flex min-h-11 items-center justify-center gap-2 rounded-xl border-2 text-sm font-semibold transition",
        ativo
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {icone} {texto}
    </button>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      {opcao(!recorrente, <Calendar className="h-4 w-4" />, "Data única", false)}
      {opcao(recorrente, <RefreshCw className="h-4 w-4" />, "Recorrente", true)}
    </div>
  );
}

/** Escolha de mês "Out/26" com popover de 12 meses (sem input nativo). */
export function SeletorMesPopover({ valor, onChange, id }: { valor: string; onChange: (ym: string) => void; id?: string }) {
  const [aberto, setAberto] = useState(false);
  const [ano, setAno] = useState(() => Number(valor.slice(0, 4)));
  const atual = toISOMonth(new Date());
  return (
    <Popover open={aberto} onOpenChange={(o) => { setAberto(o); if (o) setAno(Number(valor.slice(0, 4))); }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" className="h-11 w-full justify-start gap-2.5 font-normal">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span>{rotuloMesCurto(valor)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[264px] p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAno((a) => a - 1)} aria-label="Ano anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold tabular-nums">{ano}</span>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAno((a) => a + 1)} aria-label="Próximo ano">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MESES_CURTOS.map((m, i) => {
            const ym = `${ano}-${String(i + 1).padStart(2, "0")}`;
            const sel = ym === valor.slice(0, 7);
            return (
              <button
                key={m}
                type="button"
                onClick={() => { onChange(ym); setAberto(false); }}
                className={cn(
                  "rounded-md px-2 py-2 text-xs font-semibold transition",
                  sel ? "bg-primary text-primary-foreground" : "hover:bg-primary/10 hover:text-primary",
                  !sel && ym === atual && "ring-1 ring-inset ring-primary/40 text-primary",
                )}
              >
                {m}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Navegação de mês da página: ‹ Outubro de 2026 › [Mês atual] */
export function NavegadorMes({ mes, onChange }: { mes: string; onChange: (ym: string) => void }) {
  const atual = toISOMonth(new Date());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl border border-border bg-card px-1 py-0.5">
        <Button type="button" variant="ghost" size="icon" className="size-11" onClick={() => onChange(addMonthsYM(mes, -1))} aria-label="Mês anterior">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="min-w-[150px] px-1 text-center text-base font-semibold">{rotuloMesLongo(mes)}</span>
        <Button type="button" variant="ghost" size="icon" className="size-11" onClick={() => onChange(addMonthsYM(mes, 1))} aria-label="Próximo mês">
          <ChevronRight className="size-5" />
        </Button>
      </div>
      {mes !== atual && (
        <Button type="button" variant="outline" className="h-11" onClick={() => onChange(atual)}>Mês atual</Button>
      )}
    </div>
  );
}

const NENHUM = "__nenhum__";

export function SelectCategoria({
  categorias, tipo, valor, onChange, placeholder = "Selecione uma categoria",
}: {
  categorias: Categoria[]; tipo: TipoCategoria; valor: string | null; onChange: (id: string | null) => void; placeholder?: string;
}) {
  const lista = useMemo(() => categorias.filter((c) => c.tipo === tipo), [categorias, tipo]);
  return (
    <Select value={valor ?? NENHUM} onValueChange={(v) => onChange(v === NENHUM ? null : v)}>
      <SelectTrigger className="h-11"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NENHUM}><span className="text-muted-foreground">{placeholder}</span></SelectItem>
        {lista.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="inline-flex items-center gap-2"><Ponto cor={c.cor} /> {c.nome}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SelectForma({ valor, onChange }: { valor: FormaPagamento; onChange: (f: FormaPagamento) => void }) {
  return (
    <Select value={valor} onValueChange={(v) => onChange(v as FormaPagamento)}>
      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
      <SelectContent>
        {FORMAS_PAGAMENTO.map((f) => (
          <SelectItem key={f.valor} value={f.valor}>
            <span className="inline-flex items-center gap-2"><Ponto cor={f.cor} /> {f.rotulo}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SelectProjeto({ projetos, valor, onChange }: { projetos: Projeto[]; valor: string | null; onChange: (id: string | null) => void }) {
  const lista = projetos.filter((p) => p.ativo || p.id === valor);
  return (
    <Select value={valor ?? NENHUM} onValueChange={(v) => onChange(v === NENHUM ? null : v)}>
      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NENHUM}>Sem projeto</SelectItem>
        {lista.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="inline-flex items-center gap-2"><Ponto cor={p.cor} /> {p.nome}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SelectConta({ contas, valor, onChange }: { contas: Conta[]; valor: string | null; onChange: (id: string | null) => void }) {
  const lista = contas.filter((c) => c.ativa || c.id === valor);
  return (
    <Select value={valor ?? NENHUM} onValueChange={(v) => onChange(v === NENHUM ? null : v)}>
      <SelectTrigger className="h-11">
        <span className="inline-flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NENHUM}>Nenhuma conta</SelectItem>
        {lista.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="inline-flex items-center gap-2"><Ponto cor={c.cor} /> {c.nome}{c.instituicao ? ` · ${c.instituicao}` : ""}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Chip de status neutro (sem cara de alerta). */
export function Chip({ tom, children }: { tom: "ok" | "neutro" | "info" | "apagado"; children: ReactNode }) {
  const cls = {
    ok: "border-success/30 bg-success/10 text-success",
    neutro: "border-border bg-muted/40 text-muted-foreground",
    info: "border-primary/30 bg-primary/10 text-primary",
    apagado: "border-border bg-transparent text-muted-foreground/70 line-through",
  }[tom];
  return <span className={cn("whitespace-nowrap rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", cls)}>{children}</span>;
}

/** Data com o seletor nativo do aparelho (no celular abre o calendário do próprio telefone). */
export function CampoData({
  valor, onChange, id, obrigatoria = true, rotuloVazio,
}: { valor: string; onChange: (v: string) => void; id?: string; obrigatoria?: boolean; rotuloVazio?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="date"
        className="h-11 text-base"
        value={valor}
        required={obrigatoria}
        onChange={(e) => onChange(e.target.value)}
        aria-label={rotuloVazio ?? "Data"}
      />
      {!obrigatoria && valor && (
        <Button type="button" variant="ghost" className="h-11 shrink-0" onClick={() => onChange("")}>Limpar</Button>
      )}
    </div>
  );
}

/** Estado vazio simples (ícone, título, texto e ação). */
export function Vazio({
  icone: Icone, titulo, texto, acao,
}: { icone: React.ComponentType<{ className?: string }>; titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Icone className="size-8 text-muted-foreground" />
      <p className="text-base font-semibold">{titulo}</p>
      {texto && <p className="max-w-sm text-sm text-muted-foreground">{texto}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

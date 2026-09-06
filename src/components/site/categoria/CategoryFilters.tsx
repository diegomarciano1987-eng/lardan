import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import type { CategoriaDetalhe, OrdemVitrine } from "@/lib/storefront";
import { formatPreco } from "@/lib/storefront";
import { cn } from "@/lib/utils";

export interface FiltrosCategoria {
  q: string;
  colecao: string;
  material: string;
  banho: string;
  preco_min: number | null;
  preco_max: number | null;
  disponivel: boolean;
  lancamentos: boolean;
  destaques: boolean;
  ordem: OrdemVitrine;
}

export const FILTROS_VAZIOS: FiltrosCategoria = {
  q: "",
  colecao: "",
  material: "",
  banho: "",
  preco_min: null,
  preco_max: null,
  disponivel: false,
  lancamentos: false,
  destaques: false,
  ordem: "curadoria",
};

const ORDENS: { valor: OrdemVitrine; rotulo: string }[] = [
  { valor: "curadoria", rotulo: "Curadoria Lardan" },
  { valor: "lancamentos", rotulo: "Lançamentos" },
  { valor: "nome", rotulo: "Nome" },
  { valor: "preco_asc", rotulo: "Menor preço" },
  { valor: "preco_desc", rotulo: "Maior preço" },
];

export function contarFiltrosAtivos(f: FiltrosCategoria) {
  let n = 0;
  if (f.q.trim()) n++;
  if (f.colecao) n++;
  if (f.material) n++;
  if (f.banho) n++;
  if (f.preco_min != null || f.preco_max != null) n++;
  if (f.disponivel) n++;
  if (f.lancamentos) n++;
  if (f.destaques) n++;
  return n;
}

function Opcao({
  ativo,
  children,
  onClick,
}: {
  ativo: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "rounded-full border px-4 py-2 text-xs tracking-[0.12em] transition-colors duration-300",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        ativo
          ? "border-[color-mix(in_oklab,var(--rose)_55%,transparent)] bg-[color-mix(in_oklab,var(--rose)_12%,transparent)] text-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Painel({
  categoria,
  filtros,
  aplicar,
  limpar,
}: {
  categoria: CategoriaDetalhe;
  filtros: FiltrosCategoria;
  aplicar: (parcial: Partial<FiltrosCategoria>) => void;
  limpar: () => void;
}) {
  const faixas = faixasDePreco(categoria);
  return (
    <div className="space-y-9 overflow-y-auto px-6 pb-10 pt-2">
      <Grupo titulo="Buscar nesta categoria">
        <label className="sr-only" htmlFor="busca-categoria">
          Buscar peça
        </label>
        <input
          id="busca-categoria"
          type="search"
          value={filtros.q}
          onChange={(e) => aplicar({ q: e.target.value })}
          placeholder="Nome da peça"
          className="w-full border-b border-border bg-transparent pb-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-[color-mix(in_oklab,var(--rose)_55%,transparent)]"
        />
      </Grupo>

      {categoria.colecoes.length ? (
        <Grupo titulo="Coleção">
          <div className="flex flex-wrap gap-2">
            {categoria.colecoes.map((c) => (
              <Opcao
                key={c.slug}
                ativo={filtros.colecao === c.slug}
                onClick={() => aplicar({ colecao: filtros.colecao === c.slug ? "" : c.slug })}
              >
                {c.name}
              </Opcao>
            ))}
          </div>
        </Grupo>
      ) : null}

      {categoria.materiais.length ? (
        <Grupo titulo="Material">
          <div className="flex flex-wrap gap-2">
            {categoria.materiais.map((m) => (
              <Opcao
                key={m}
                ativo={filtros.material === m}
                onClick={() => aplicar({ material: filtros.material === m ? "" : m })}
              >
                {m}
              </Opcao>
            ))}
          </div>
        </Grupo>
      ) : null}

      {categoria.banhos.length ? (
        <Grupo titulo="Banho">
          <div className="flex flex-wrap gap-2">
            {categoria.banhos.map((b) => (
              <Opcao
                key={b}
                ativo={filtros.banho === b}
                onClick={() => aplicar({ banho: filtros.banho === b ? "" : b })}
              >
                {b}
              </Opcao>
            ))}
          </div>
        </Grupo>
      ) : null}

      {faixas.length ? (
        <Grupo titulo="Faixa de preço">
          <div className="flex flex-wrap gap-2">
            {faixas.map((f) => {
              const ativo = filtros.preco_min === f.min && filtros.preco_max === f.max;
              return (
                <Opcao
                  key={f.rotulo}
                  ativo={ativo}
                  onClick={() =>
                    aplicar(
                      ativo
                        ? { preco_min: null, preco_max: null }
                        : { preco_min: f.min, preco_max: f.max },
                    )
                  }
                >
                  {f.rotulo}
                </Opcao>
              );
            })}
          </div>
        </Grupo>
      ) : null}

      <Grupo titulo="Seleção">
        <div className="flex flex-wrap gap-2">
          <Opcao
            ativo={filtros.disponivel}
            onClick={() => aplicar({ disponivel: !filtros.disponivel })}
          >
            Disponíveis
          </Opcao>
          <Opcao
            ativo={filtros.lancamentos}
            onClick={() => aplicar({ lancamentos: !filtros.lancamentos })}
          >
            Lançamentos
          </Opcao>
          <Opcao
            ativo={filtros.destaques}
            onClick={() => aplicar({ destaques: !filtros.destaques })}
          >
            Destaques
          </Opcao>
        </div>
      </Grupo>

      <Grupo titulo="Ordenar por">
        <div className="flex flex-wrap gap-2">
          {ORDENS.filter((o) => categoria.tem_preco_publico || !o.valor.startsWith("preco")).map(
            (o) => (
              <Opcao
                key={o.valor}
                ativo={filtros.ordem === o.valor}
                onClick={() => aplicar({ ordem: o.valor })}
              >
                {o.rotulo}
              </Opcao>
            ),
          )}
        </div>
      </Grupo>

      <button
        type="button"
        onClick={limpar}
        className="text-[0.7rem] uppercase tracking-[0.24em] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Limpar filtros
      </button>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="brand-eyebrow">{titulo}</h3>
      {children}
    </section>
  );
}

function faixasDePreco(categoria: CategoriaDetalhe) {
  if (!categoria.tem_preco_publico || categoria.preco_min == null || categoria.preco_max == null)
    return [];
  const min = categoria.preco_min;
  const max = categoria.preco_max;
  if (max <= min) return [];
  const passo = Math.ceil((max - min) / 3);
  return [0, 1, 2].map((i) => {
    const de = min + passo * i;
    const ate = i === 2 ? max : min + passo * (i + 1);
    return { rotulo: `${formatPreco(de)} — ${formatPreco(ate)}`, min: de, max: ate };
  });
}

export function CategoryFilters({
  categoria,
  filtros,
  aplicar,
  limpar,
  encontrados,
}: {
  categoria: CategoriaDetalhe;
  filtros: FiltrosCategoria;
  aplicar: (parcial: Partial<FiltrosCategoria>) => void;
  limpar: () => void;
  encontrados: number;
}) {
  const [aberto, setAberto] = useState(false);
  const mobile = useIsMobile();
  const ativos = contarFiltrosAtivos(filtros);
  const ordemAtual = ORDENS.find((o) => o.valor === filtros.ordem)?.rotulo ?? "Curadoria Lardan";

  const gatilho = (
    <button
      type="button"
      className="inline-flex items-center gap-3 border-b border-border pb-2 text-[0.7rem] uppercase tracking-[0.26em] text-foreground/80 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      Refinar seleção
      {ativos ? <span className="text-muted-foreground">({ativos})</span> : null}
    </button>
  );

  const conteudo = (
    <Painel categoria={categoria} filtros={filtros} aplicar={aplicar} limpar={limpar} />
  );

  return (
    <div className="mx-auto flex max-w-[88rem] flex-wrap items-end justify-between gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center gap-4">
        {mobile ? (
          <Drawer open={aberto} onOpenChange={setAberto}>
            <DrawerTrigger asChild>{gatilho}</DrawerTrigger>
            <DrawerContent className="max-h-[86vh]">
              <DrawerHeader className="text-left">
                <DrawerTitle className="font-display text-2xl">Refinar seleção</DrawerTitle>
              </DrawerHeader>
              {conteudo}
            </DrawerContent>
          </Drawer>
        ) : (
          <Sheet open={aberto} onOpenChange={setAberto}>
            <SheetTrigger asChild>{gatilho}</SheetTrigger>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
              <SheetHeader>
                <SheetTitle className="font-display text-2xl">Refinar seleção</SheetTitle>
              </SheetHeader>
              {conteudo}
            </SheetContent>
          </Sheet>
        )}

        {ativos ? (
          <button
            type="button"
            onClick={limpar}
            className="text-[0.7rem] uppercase tracking-[0.24em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Limpar filtros
          </button>
        ) : null}
      </div>

      <p
        className="text-[0.7rem] uppercase tracking-[0.26em] text-muted-foreground"
        aria-live="polite"
      >
        {encontrados === 1 ? "1 peça" : `${encontrados} peças`} · {ordemAtual}
      </p>
    </div>
  );
}

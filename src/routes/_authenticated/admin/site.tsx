import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Grid2x2,
  ImageOff,
  Rows3,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Skeleton,
  StatusBadge,
  formatBRLFromCents,
  formatDateTime,
  formatInt,
  type StatusTone,
} from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { ShowcaseBulkDialog } from "@/components/admin/ShowcaseBulkDialog";
import { useCapabilities } from "@/lib/capabilities";
import { ShowcaseTaxonomy } from "@/components/admin/ShowcaseTaxonomy";
import { ShowcaseHome } from "@/components/admin/ShowcaseHome";

type AbaVitrine = "produtos" | "taxonomia" | "home";
const ABAS: { value: AbaVitrine; label: string }[] = [
  { value: "produtos", label: "Produtos da vitrine" },
  { value: "taxonomia", label: "Categorias e coleções" },
  { value: "home", label: "Página inicial" },
];
import { supabase } from "@/integrations/supabase/client";
import {
  BULK_LABEL,
  CHECKLIST_LABEL,
  PRONTIDAO_LABEL,
  bloqueios,
  deleteView,
  fetchShowcaseCounts,
  listBatches,
  listCategoriasSimples,
  listColecoesSimples,
  listFornecedoresSimples,
  listSavedViews,
  listShowcase,
  prontidao,
  saveView,
  showcaseIds,
  type BulkAction,
  type Prontidao,
  type ShowcaseFilters,
  type ShowcaseRow,
  type ShowcaseSort,
} from "@/lib/showcase";

export const Route = createFileRoute("/_authenticated/admin/site")({
  component: CentralVitrinePage,
  head: () => ({
    meta: [
      { title: "Central da Vitrine — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const PAGE_SIZE = 24;

const VISOES: { key: string; label: string; filtros: ShowcaseFilters }[] = [
  { key: "todos", label: "Todos os produtos", filtros: {} },
  { key: "publicados", label: "Publicados", filtros: { publicado: true } },
  { key: "nao_publicados", label: "Não publicados", filtros: { publicado: false } },
  { key: "prontos", label: "Prontos para publicar", filtros: { publicado: false, completo: true } },
  { key: "incompletos", label: "Incompletos", filtros: { completo: false } },
  { key: "sem_foto", label: "Sem foto", filtros: { com_imagem: false } },
  { key: "sem_preco", label: "Sem preço", filtros: { com_preco: false } },
  { key: "sem_categoria", label: "Sem categoria", filtros: { sem_categoria: true } },
  { key: "sem_estoque", label: "Sem estoque", filtros: { com_estoque: false } },
  { key: "destaques", label: "Destaques", filtros: { destaque: true } },
  { key: "lancamentos", label: "Lançamentos", filtros: { lancamento: true } },
  { key: "agendados", label: "Agendados", filtros: { agendado: true } },
  { key: "recentes", label: "Alterados recentemente", filtros: {} },
];

const ORDENS: { value: ShowcaseSort; label: string }[] = [
  { value: "updated_desc", label: "Alteração mais recente" },
  { value: "criado_desc", label: "Cadastro mais recente" },
  { value: "nome_asc", label: "Nome (A–Z)" },
  { value: "nome_desc", label: "Nome (Z–A)" },
  { value: "preco_asc", label: "Menor preço" },
  { value: "preco_desc", label: "Maior preço" },
  { value: "estoque_desc", label: "Maior estoque" },
];

const TOM: Record<Prontidao, StatusTone> = {
  publicado: "success",
  agendado: "info",
  arquivado: "neutral",
  pronto: "info",
  quase: "warning",
  incompleto: "danger",
};

const SIM_NAO = [
  { value: "", label: "Indiferente" },
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
];

function boolFiltro(v: string): boolean | undefined {
  return v === "sim" ? true : v === "nao" ? false : undefined;
}
function boolTexto(v: boolean | undefined): string {
  return v === true ? "sim" : v === false ? "nao" : "";
}

/** Miniaturas assinadas do balde privado, só para os itens visíveis. */
function useMiniaturas(ids: (string | null)[]) {
  const chave = ids.filter(Boolean).join(",");
  return useQuery({
    queryKey: ["vitrine", "miniaturas", chave],
    enabled: chave.length > 0,
    queryFn: async () => {
      const mediaIds = ids.filter((i): i is string => Boolean(i));
      const { data: assets } = await supabase
        .from("media_assets")
        .select("id, storage_path")
        .in("id", mediaIds);
      const mapa: Record<string, string> = {};
      const caminhos = (assets ?? []).filter((a) => a.storage_path);
      if (caminhos.length === 0) return mapa;
      const { data: urls } = await supabase.storage
        .from("media")
        .createSignedUrls(caminhos.map((c) => c.storage_path as string), 3600);
      (urls ?? []).forEach((u, i) => {
        const asset = caminhos[i];
        if (asset && u.signedUrl) mapa[asset.id] = u.signedUrl;
      });
      return mapa;
    },
  });
}

function Indicador({
  rotulo,
  valor,
  ativo,
  onClick,
}: {
  rotulo: string;
  valor: number | undefined;
  ativo?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ledger-panel px-5 py-4 text-left transition ${
        ativo ? "border-champagne" : "hover:border-champagne"
      }`}
    >
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums text-ledger-text">
        {valor === undefined ? "—" : formatInt(valor)}
      </p>
    </button>
  );
}

function CentralVitrinePage() {
  const [aba, setAba] = React.useState<AbaVitrine>("produtos");
  const caps = useCapabilities();
  const qc = useQueryClient();
  const podeVer = caps.includes("showcase.view") || caps.includes("catalog.view");
  const podeMassa = caps.includes("showcase.bulk") || caps.includes("catalog.manage");
  const podePublicar = caps.includes("showcase.publish") || caps.includes("catalog.publish");

  const [visao, setVisao] = React.useState("todos");
  const [filtros, setFiltros] = React.useState<ShowcaseFilters>({});
  const [busca, setBusca] = React.useState("");
  const [ordem, setOrdem] = React.useState<ShowcaseSort>("updated_desc");
  const [pagina, setPagina] = React.useState(0);
  const [modo, setModo] = React.useState<"tabela" | "grade">("tabela");
  const [abrirFiltros, setAbrirFiltros] = React.useState(false);
  const [selecao, setSelecao] = React.useState<Record<string, true>>({});
  const [acao, setAcao] = React.useState<BulkAction | null>(null);
  const [nomeVisao, setNomeVisao] = React.useState("");

  const filtrosAtivos = React.useMemo<ShowcaseFilters>(() => {
    const base: ShowcaseFilters = { ...filtros };
    if (busca.trim()) base.busca = busca.trim();
    if (visao === "recentes") {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      base.atualizado_de = d.toISOString();
    }
    return base;
  }, [filtros, busca, visao]);

  const contadores = useQuery({ queryKey: ["vitrine", "contadores"], queryFn: fetchShowcaseCounts });
  const categorias = useQuery({ queryKey: ["categorias-simples"], queryFn: listCategoriasSimples });
  const colecoes = useQuery({ queryKey: ["colecoes-simples"], queryFn: listColecoesSimples });
  const fornecedores = useQuery({ queryKey: ["fornecedores-simples"], queryFn: listFornecedoresSimples });
  const visoes = useQuery({ queryKey: ["vitrine", "visoes"], queryFn: listSavedViews });
  const lotes = useQuery({ queryKey: ["vitrine", "lotes"], queryFn: () => listBatches(10) });

  const lista = useQuery({
    queryKey: ["vitrine", "lista", filtrosAtivos, ordem, pagina],
    queryFn: () => listShowcase({ filtros: filtrosAtivos, ordem, pagina, porPagina: PAGE_SIZE }),
    enabled: podeVer,
  });

  const linhas = lista.data?.rows ?? [];
  const total = lista.data?.total ?? 0;
  const miniaturas = useMiniaturas(linhas.map((l) => l.cover_media_id));
  const selecionados = Object.keys(selecao);

  const selecionarTudoFiltro = useMutation({
    mutationFn: () => showcaseIds(filtrosAtivos, 5000),
    onSuccess: (ids) => {
      const mapa: Record<string, true> = {};
      ids.forEach((i) => (mapa[i] = true));
      setSelecao(mapa);
    },
  });

  const gravarVisao = useMutation({
    mutationFn: () => saveView(nomeVisao.trim(), filtrosAtivos, true),
    onSuccess: () => {
      setNomeVisao("");
      void qc.invalidateQueries({ queryKey: ["vitrine", "visoes"] });
    },
  });

  const apagarVisao = useMutation({
    mutationFn: (id: string) => deleteView(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["vitrine", "visoes"] }),
  });

  function aplicarVisao(key: string) {
    const v = VISOES.find((x) => x.key === key);
    setVisao(key);
    setPagina(0);
    setSelecao({});
    setFiltros(v ? { ...v.filtros } : {});
  }

  function alterar<K extends keyof ShowcaseFilters>(campo: K, valor: ShowcaseFilters[K]) {
    setFiltros((f) => ({ ...f, [campo]: valor }));
    setPagina(0);
  }

  function alternar(id: string) {
    setSelecao((s) => {
      const copia = { ...s };
      if (copia[id]) delete copia[id];
      else copia[id] = true;
      return copia;
    });
  }

  const todosDaPagina = linhas.length > 0 && linhas.every((l) => selecao[l.id]);
  const ultimaPagina = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  if (!podeVer) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Site" title="Central da Vitrine" />
        <Panel>
          <EmptyState
            title="Sem permissão"
            description="Seu perfil não tem acesso à Central da Vitrine. Fale com um administrador."
          />
        </Panel>
      </div>
    );
  }

  const acoes: BulkAction[] = [
    "publicar",
    "despublicar",
    "mostrar_preco",
    "esconder_preco",
    "definir_categoria",
    "adicionar_colecao",
    "remover_colecao",
    "destacar",
    "remover_destaque",
    "lancamento",
    "remover_lancamento",
    "programar",
    "cancelar_agendamento",
    "estoque_visibilidade",
    "arquivar",
  ];
  const acoesPermitidas = acoes.filter((a) =>
    ["publicar", "despublicar", "arquivar", "programar", "cancelar_agendamento"].includes(a)
      ? podePublicar
      : podeMassa,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Site"
        title="Central da Vitrine"
        description="Curadoria, publicação e organização do catálogo que aparece no site — sempre sobre os mesmos produtos, variantes, preços, imagens e estoque do cadastro."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setModo(modo === "tabela" ? "grade" : "tabela")}
              className="admin-btn"
            >
              {modo === "tabela" ? (
                <Grid2x2 aria-hidden className="size-4" />
              ) : (
                <Rows3 aria-hidden className="size-4" />
              )}
              {modo === "tabela" ? "Grade visual" : "Tabela"}
            </button>
            <button type="button" onClick={() => setAbrirFiltros((v) => !v)} className="admin-btn">
              <Filter aria-hidden className="size-4" />
              Filtros
            </button>
          </div>
        }
      />

      <nav className="flex flex-wrap gap-2 border-b border-line-soft pb-4">
        {ABAS.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => setAba(a.value)}
            className={
              aba === a.value
                ? "rounded-full bg-ink px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-warm-ivory"
                : "rounded-full border border-line px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-ledger-muted hover:border-champagne"
            }
          >
            {a.label}
          </button>
        ))}
      </nav>

      {aba === "taxonomia" && <ShowcaseTaxonomy podePublicar={podePublicar} />}
      {aba === "home" && <ShowcaseHome podeEditar={podePublicar} />}

      {aba === "produtos" && (
      <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Produtos cadastrados" valor={contadores.data?.total} ativo={visao === "todos"} onClick={() => aplicarVisao("todos")} />
        <Indicador rotulo="Publicados" valor={contadores.data?.publicados} ativo={visao === "publicados"} onClick={() => aplicarVisao("publicados")} />
        <Indicador rotulo="Aguardando publicação" valor={contadores.data?.aguardando} ativo={visao === "nao_publicados"} onClick={() => aplicarVisao("nao_publicados")} />
        <Indicador rotulo="Incompletos" valor={contadores.data?.incompletos} ativo={visao === "incompletos"} onClick={() => aplicarVisao("incompletos")} />
        <Indicador rotulo="Sem imagem" valor={contadores.data?.sem_imagem} ativo={visao === "sem_foto"} onClick={() => aplicarVisao("sem_foto")} />
        <Indicador rotulo="Sem preço" valor={contadores.data?.sem_preco} ativo={visao === "sem_preco"} onClick={() => aplicarVisao("sem_preco")} />
        <Indicador rotulo="Sem categoria" valor={contadores.data?.sem_categoria} ativo={visao === "sem_categoria"} onClick={() => aplicarVisao("sem_categoria")} />
        <Indicador rotulo="Sem estoque" valor={contadores.data?.sem_estoque} ativo={visao === "sem_estoque"} onClick={() => aplicarVisao("sem_estoque")} />
        <Indicador rotulo="Destaques ativos" valor={contadores.data?.destaques} ativo={visao === "destaques"} onClick={() => aplicarVisao("destaques")} />
        <Indicador rotulo="Publicações programadas" valor={contadores.data?.agendados} ativo={visao === "agendados"} onClick={() => aplicarVisao("agendados")} />
        <Indicador rotulo="Alterações em 7 dias" valor={contadores.data?.alterados_7d} ativo={visao === "recentes"} onClick={() => aplicarVisao("recentes")} />
      </section>

      <Panel title="Visões">
        <div className="flex flex-wrap gap-2">
          {VISOES.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => aplicarVisao(v.key)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] transition ${
                visao === v.key
                  ? "border-champagne bg-surface-muted text-bronze"
                  : "border-line text-ledger-muted hover:border-champagne hover:text-bronze"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {(visoes.data ?? []).length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-5">
            <span className="ledger-eyebrow">Personalizadas</span>
            {(visoes.data ?? []).map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-1">
                <button
                  type="button"
                  onClick={() => {
                    setVisao(`salva:${v.id}`);
                    setFiltros(v.filters ?? {});
                    setBusca((v.filters?.busca as string) ?? "");
                    setPagina(0);
                  }}
                  className="px-1.5 text-xs font-semibold text-ledger-text"
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  aria-label={`Apagar visão ${v.name}`}
                  onClick={() => apagarVisao.mutate(v.id)}
                  className="text-ledger-muted hover:text-danger"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-5">
          <input
            value={nomeVisao}
            onChange={(e) => setNomeVisao(e.target.value)}
            placeholder="Salvar filtros atuais como visão…"
            className="h-11 min-w-64 flex-1 rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
          />
          <button
            type="button"
            className="admin-btn"
            disabled={!nomeVisao.trim() || gravarVisao.isPending}
            onClick={() => gravarVisao.mutate()}
          >
            Salvar visão
          </button>
        </div>
      </Panel>

      {abrirFiltros && (
        <Panel title="Filtros combináveis">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <Campo rotulo="Categoria">
              <SmartSelect
                options={[{ value: "", label: "Todas" }, ...(categorias.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                value={filtros.categoria_id ?? ""}
                onChange={(v) => alterar("categoria_id", v || undefined)}
                placeholder="Todas"
              />
            </Campo>
            <Campo rotulo="Coleção">
              <SmartSelect
                options={[{ value: "", label: "Todas" }, ...(colecoes.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                value={filtros.colecao_id ?? ""}
                onChange={(v) => alterar("colecao_id", v || undefined)}
                placeholder="Todas"
              />
            </Campo>
            <Campo rotulo="Fornecedor">
              <SmartSelect
                options={[{ value: "", label: "Todos" }, ...(fornecedores.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                value={filtros.fornecedor_id ?? ""}
                onChange={(v) => alterar("fornecedor_id", v || undefined)}
                placeholder="Todos"
              />
            </Campo>
            <Campo rotulo="Situação editorial">
              <SmartSelect
                options={[
                  { value: "", label: "Todas" },
                  { value: "rascunho", label: "Rascunho" },
                  { value: "revisao", label: "Em revisão" },
                  { value: "publicado", label: "Publicado" },
                  { value: "arquivado", label: "Arquivado" },
                ]}
                value={filtros.status ?? ""}
                onChange={(v) => alterar("status", v || undefined)}
                searchThreshold={99}
              />
            </Campo>
            <Campo rotulo="Mostra preço no site">
              <SmartSelect options={SIM_NAO} value={boolTexto(filtros.preco_publico)} onChange={(v) => alterar("preco_publico", boolFiltro(v))} searchThreshold={99} />
            </Campo>
            <Campo rotulo="Com imagem">
              <SmartSelect options={SIM_NAO} value={boolTexto(filtros.com_imagem)} onChange={(v) => alterar("com_imagem", boolFiltro(v))} searchThreshold={99} />
            </Campo>
            <Campo rotulo="Com preço">
              <SmartSelect options={SIM_NAO} value={boolTexto(filtros.com_preco)} onChange={(v) => alterar("com_preco", boolFiltro(v))} searchThreshold={99} />
            </Campo>
            <Campo rotulo="Com estoque">
              <SmartSelect options={SIM_NAO} value={boolTexto(filtros.com_estoque)} onChange={(v) => alterar("com_estoque", boolFiltro(v))} searchThreshold={99} />
            </Campo>
            <Campo rotulo="Destaque">
              <SmartSelect options={SIM_NAO} value={boolTexto(filtros.destaque)} onChange={(v) => alterar("destaque", boolFiltro(v))} searchThreshold={99} />
            </Campo>
            <Campo rotulo="Produto completo">
              <SmartSelect options={SIM_NAO} value={boolTexto(filtros.completo)} onChange={(v) => alterar("completo", boolFiltro(v))} searchThreshold={99} />
            </Campo>
            <Campo rotulo="Cadastrado a partir de">
              <DateField
                value={filtros.criado_de ? new Date(filtros.criado_de) : undefined}
                onChange={(d) => alterar("criado_de", d ? d.toISOString() : undefined)}
              />
            </Campo>
            <Campo rotulo="Alterado a partir de">
              <DateField
                value={filtros.atualizado_de ? new Date(filtros.atualizado_de) : undefined}
                onChange={(d) => alterar("atualizado_de", d ? d.toISOString() : undefined)}
              />
            </Campo>
            <Campo rotulo="Material">
              <input
                value={filtros.material ?? ""}
                onChange={(e) => alterar("material", e.target.value || undefined)}
                className="h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
              />
            </Campo>
            <Campo rotulo="Banho">
              <input
                value={filtros.banho ?? ""}
                onChange={(e) => alterar("banho", e.target.value || undefined)}
                className="h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
              />
            </Campo>
            <Campo rotulo="Etiqueta (tag)">
              <input
                value={filtros.tag ?? ""}
                onChange={(e) => alterar("tag", e.target.value || undefined)}
                className="h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
              />
            </Campo>
          </div>
          <div className="mt-5 flex justify-end border-t border-line-soft pt-5">
            <button type="button" className="admin-btn" onClick={() => { setFiltros({}); setPagina(0); }}>
              Limpar filtros
            </button>
          </div>
        </Panel>
      )}

      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
          <label className="relative min-w-56 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ledger-muted" />
            <input
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPagina(0);
              }}
              placeholder="Buscar por nome, SKU, código interno, código de barras, descrição, categoria, coleção, fornecedor, material, banho ou etiqueta…"
              className="h-11 w-full rounded-[10px] border border-line bg-surface pr-3 pl-9 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25"
            />
          </label>
          <div className="w-60">
            <SmartSelect
              options={ORDENS}
              value={ordem}
              onChange={(v) => setOrdem(v as ShowcaseSort)}
              searchThreshold={99}
            />
          </div>
        </div>

        {selecionados.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-muted px-6 py-4">
            <p className="text-sm font-semibold text-ledger-text">
              {formatInt(selecionados.length)} selecionado(s)
            </p>
            {selecionados.length < total && (
              <button
                type="button"
                className="admin-btn"
                disabled={selecionarTudoFiltro.isPending}
                onClick={() => selecionarTudoFiltro.mutate()}
              >
                Selecionar os {formatInt(total)} produtos encontrados por este filtro
              </button>
            )}
            <button type="button" className="admin-btn" onClick={() => setSelecao({})}>
              Limpar seleção
            </button>
            <div className="ml-auto w-72">
              <SmartSelect
                options={acoesPermitidas.map((a) => ({ value: a, label: BULK_LABEL[a] }))}
                value=""
                onChange={(v) => setAcao(v as BulkAction)}
                placeholder="Ação em massa…"
              />
            </div>
          </div>
        )}

        {lista.error ? (
          <div className="px-6 py-5">
            <ErrorState
              message={lista.error instanceof Error ? lista.error.message : "Falha ao carregar."}
              onRetry={() => void lista.refetch()}
            />
          </div>
        ) : lista.isLoading ? (
          <div className="space-y-3 px-6 py-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : linhas.length === 0 ? (
          <div className="px-6 py-5">
            <EmptyState
              title="Nenhum produto encontrado"
              description="Ajuste a busca ou os filtros. Os números da Central vêm direto do banco: zero é zero."
            />
          </div>
        ) : modo === "grade" ? (
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2 xl:grid-cols-4">
            {linhas.map((r) => (
              <CartaoProduto
                key={r.id}
                row={r}
                url={r.cover_media_id ? miniaturas.data?.[r.cover_media_id] : undefined}
                selecionado={Boolean(selecao[r.id])}
                onToggle={() => alternar(r.id)}
              />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className="w-12 px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      aria-label="Selecionar página"
                      checked={todosDaPagina}
                      onChange={() =>
                        setSelecao((s) => {
                          const copia = { ...s };
                          if (todosDaPagina) linhas.forEach((l) => delete copia[l.id]);
                          else linhas.forEach((l) => (copia[l.id] = true));
                          return copia;
                        })
                      }
                    />
                  </th>
                  {["Produto", "Situação", "Completude", "Preço", "Estoque", "Categoria", "Coleção", "Alterado"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-bronze">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((r) => {
                  const p = prontidao(r);
                  const falta = bloqueios(r);
                  return (
                    <tr key={r.id} className="border-b border-line-soft last:border-0">
                      <td className="px-6 py-4 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${r.name}`}
                          checked={Boolean(selecao[r.id])}
                          onChange={() => alternar(r.id)}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <Miniatura url={r.cover_media_id ? miniaturas.data?.[r.cover_media_id] : undefined} alt={r.cover_alt} />
                          <div className="min-w-0">
                            <Link
                              to="/admin/cadastros"
                              className="block truncate font-semibold text-ledger-text hover:text-bronze"
                            >
                              {r.name}
                            </Link>
                            <p className="truncate text-xs text-ledger-muted">
                              {r.sku ? `${r.sku} · ` : ""}
                              {r.slug}
                              {r.is_featured ? " · destaque" : ""}
                              {r.is_new_arrival ? " · lançamento" : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <StatusBadge tone={TOM[p]}>{PRONTIDAO_LABEL[p]}</StatusBadge>
                        {r.scheduled_publish_at && (
                          <p className="mt-1.5 text-xs text-ledger-muted">
                            Programado: {formatDateTime(r.scheduled_publish_at)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top text-xs text-ledger-muted">
                        {falta.length === 0
                          ? "Sem impedimentos"
                          : `Falta: ${falta.map((f) => CHECKLIST_LABEL[f] ?? f).join(", ")}`}
                      </td>
                      <td className="px-4 py-4 align-top tabular-nums">
                        {r.price_cents == null ? (
                          <span className="text-ledger-muted">Sem preço</span>
                        ) : (
                          <>
                            {formatBRLFromCents(r.price_cents)}
                            {!r.price_is_public && (
                              <p className="mt-1 text-xs text-ledger-muted">oculto no site</p>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top tabular-nums">{formatInt(r.estoque)}</td>
                      <td className="px-4 py-4 align-top text-sm">{r.category_name ?? "—"}</td>
                      <td className="px-4 py-4 align-top text-sm">{r.collection_name ?? "—"}</td>
                      <td className="px-4 py-4 align-top text-xs text-ledger-muted">
                        {formatDateTime(r.updated_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
          <p className="text-xs font-medium text-ledger-muted">
            {total === 0 ? "Nenhum resultado" : `${formatInt(pagina * PAGE_SIZE + 1)}–${formatInt(pagina * PAGE_SIZE + linhas.length)} de ${formatInt(total)}`}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="admin-btn" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
              <ChevronLeft aria-hidden className="size-4" /> Anterior
            </button>
            <button
              type="button"
              className="admin-btn"
              disabled={pagina >= ultimaPagina}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próxima <ChevronRight aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Lotes de ações em massa">
        {(lotes.data ?? []).length === 0 ? (
          <EmptyState title="Nenhum lote executado" description="Cada operação em massa gera um lote consultável, com filtro usado, quantidade afetada e itens recusados." />
        ) : (
          <ul className="space-y-3">
            {(lotes.data ?? []).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ledger-text">
                    {BULK_LABEL[l.action as BulkAction] ?? l.action}
                  </p>
                  <p className="text-xs text-ledger-muted">{formatDateTime(l.created_at)}</p>
                </div>
                <p className="text-xs font-medium text-ledger-muted">
                  {formatInt(l.affected)} afetados · {formatInt(l.rejected)} recusados
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {acao && (
        <ShowcaseBulkDialog
          acao={acao}
          ids={selecionados}
          filtros={filtrosAtivos}
          onClose={() => {
            setAcao(null);
            void lista.refetch();
            void contadores.refetch();
            void lotes.refetch();
          }}
        />
      )}
      </>
      )}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="ledger-eyebrow">{rotulo}</span>
      {children}
    </label>
  );
}

function Miniatura({ url, alt }: { url?: string | undefined; alt?: string | null }) {
  if (!url) {
    return (
      <span className="grid size-11 shrink-0 place-items-center rounded-[10px] border border-line bg-surface-muted text-ledger-muted">
        <ImageOff aria-hidden className="size-4" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={alt ?? ""}
      loading="lazy"
      className="size-11 shrink-0 rounded-[10px] border border-line object-cover"
    />
  );
}

function CartaoProduto({
  row,
  url,
  selecionado,
  onToggle,
}: {
  row: ShowcaseRow;
  url?: string | undefined;
  selecionado: boolean;
  onToggle: () => void;
}) {
  const p = prontidao(row);
  return (
    <article className={`flex flex-col gap-3 rounded-[12px] border p-4 transition ${selecionado ? "border-champagne" : "border-line"}`}>
      <div className="flex items-start justify-between gap-2">
        <input type="checkbox" aria-label={`Selecionar ${row.name}`} checked={selecionado} onChange={onToggle} />
        {row.is_featured && <Star aria-hidden className="size-4 text-bronze" />}
      </div>
      <div className="aspect-square overflow-hidden rounded-[10px] border border-line bg-surface-muted">
        {url ? (
          <img src={url} alt={row.cover_alt ?? ""} loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-ledger-muted">
            <ImageOff aria-hidden className="size-6" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold text-ledger-text">{row.name}</p>
        <p className="truncate text-xs text-ledger-muted">{row.category_name ?? "Sem categoria"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={TOM[p]}>{PRONTIDAO_LABEL[p]}</StatusBadge>
        <span className="text-sm font-semibold tabular-nums text-ledger-text">
          {row.price_cents == null ? "Sem preço" : formatBRLFromCents(row.price_cents)}
        </span>
      </div>
      <p className="text-xs text-ledger-muted">Estoque {formatInt(row.estoque)}</p>
    </article>
  );
}

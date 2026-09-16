import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, ListChecks, Save, Sparkles, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, StatusBadge } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { Switch } from "@/components/ui/switch";
import { can, useCapabilities } from "@/lib/capabilities";
import { centavosParaTexto, parseCentavos, slugify, mensagemDeErro } from "@/lib/catalog";
import { publicarProdutos, despublicarProdutos } from "@/lib/showcase";
import {
  checklistPublicacao,
  completude,
  gerarResumo,
  salvarProduto,
  lerMarkupGlobal,
  margemPraticada,
  precoSugerido,
  type Impedimento,
  type ProdutoBase,
} from "@/lib/produto";

interface Props {
  /** null = ficha nova; nada é gravado até o primeiro "Salvar rascunho". */
  id: string | null;
  /** painéis extras (variantes, imagens, histórico) exibidos abaixo da ficha */
  children?: React.ReactNode;
  contagemVariantes?: number;
  temImagem?: boolean;
}

type Form = Record<string, string | boolean>;

const VAZIO: Form = {
  name: "",
  slug: "",
  legacy_code: "",
  category_id: "",
  subcategory_id: "",
  collection_id: "",
  raw_material: "",
  raw_weight_grams: "",
  raw_supplier_id: "",
  raw_piece_cost: "",
  measurements: "",
  short_description: "",
  description: "",
  care_instructions: "",
  warranty_text: "",
  seo_title: "",
  seo_description: "",
  preco: "",
  custo: "",
  markup: "",
  price_is_public: true,
  is_featured: false,
};

export function ProdutoFicha({ id, children, contagemVariantes = 0, temImagem = false }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const caps = useCapabilities();
  const podeEditar = can(caps, "product.manage");
  const podePublicar = can(caps, "product.publish");

  const [form, setForm] = useState<Form>(VAZIO);
  const [sujo, setSujo] = useState(false);
  const [impedimentos, setImpedimentos] = useState<Impedimento[] | null>(null);
  const salvandoRef = useRef(false);

  const produto = useQuery({
    queryKey: ["produto", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("id", id!).single();
      if (error) throw error;
      return data as unknown as ProdutoBase;
    },
  });

  const categorias = useQuery({
    queryKey: ["opcoes-categorias-raiz"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, parent_id, status")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const colecoes = useQuery({
    queryKey: ["opcoes-colecoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collections").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const fornecedores = useQuery({
    queryKey: ["opcoes-fornecedores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const padroes = useQuery({
    queryKey: ["catalog-defaults"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_defaults")
        .select("*")
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const markupGlobal = useQuery({ queryKey: ["catalog-markup"], queryFn: lerMarkupGlobal });

  const p = produto.data;

  // Carrega a ficha salva no formulário (uma vez por produto).
  useEffect(() => {
    if (!p) return;
    setForm({
      name: p.name ?? "",
      slug: p.slug ?? "",
      legacy_code: p.legacy_code ?? "",
      category_id: p.category_id ?? "",
      subcategory_id: p.subcategory_id ?? "",
      collection_id: p.collection_id ?? "",
      raw_material: p.raw_material ?? "",
      raw_weight_grams: p.raw_weight_grams == null ? "" : String(p.raw_weight_grams),
      raw_supplier_id: p.raw_supplier_id ?? "",
      raw_piece_cost: centavosParaTexto(p.raw_piece_cost_cents),
      measurements: p.measurements ?? "",
      short_description: p.short_description ?? "",
      description: p.description ?? "",
      care_instructions: p.care_instructions ?? "",
      warranty_text: p.warranty_text ?? "",
      seo_title: p.seo_title ?? "",
      seo_description: p.seo_description ?? "",
      preco: centavosParaTexto(p.price_cents),
      custo: centavosParaTexto(p.cost_price_cents),
      markup: p.markup_percent == null ? "" : String(p.markup_percent),
      price_is_public: p.price_is_public,
      is_featured: p.is_featured,
    });
    setSujo(false);
  }, [p]);

  // Ficha nova: aplica os padrões vigentes do cadastro, quando existirem.
  useEffect(() => {
    if (id || !padroes.data) return;
    setForm((f) => ({
      ...f,
      care_instructions: f["care_instructions"] || (padroes.data?.care_instructions ?? ""),
      warranty_text: f["warranty_text"] || (padroes.data?.warranty_text ?? ""),
    }));
  }, [id, padroes.data]);

  // Aviso ao sair com alterações não salvas.
  useEffect(() => {
    if (!sujo) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sujo]);

  const set = useCallback((campo: string, valor: string | boolean) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setSujo(true);
  }, []);

  const raiz = (categorias.data ?? []).filter((c) => !c.parent_id);
  const filhas = (categorias.data ?? []).filter(
    (c) => c.parent_id && c.parent_id === form["category_id"],
  );
  const caminho = useMemo(() => {
    const cat = raiz.find((c) => c.id === form["category_id"])?.name;
    const sub = filhas.find((c) => c.id === form["subcategory_id"])?.name;
    return [cat, sub].filter(Boolean).join(" › ") || "—";
  }, [raiz, filhas, form]);

  const slugPrevia = String(form["slug"] || "").trim() || slugify(String(form["name"] || ""));

  const payload = () => ({
    name: String(form["name"] ?? "").trim(),
    slug: String(form["slug"] ?? "").trim(),
    legacy_code: String(form["legacy_code"] ?? "").trim(),
    category_id: String(form["category_id"] ?? ""),
    subcategory_id: String(form["subcategory_id"] ?? ""),
    collection_id: String(form["collection_id"] ?? ""),
    raw_material: String(form["raw_material"] ?? "").trim(),
    raw_weight_grams: String(form["raw_weight_grams"] ?? "").replace(",", "."),
    raw_supplier_id: String(form["raw_supplier_id"] ?? ""),
    raw_piece_cost_cents: parseCentavos(String(form["raw_piece_cost"] ?? "")) ?? "",
    measurements: String(form["measurements"] ?? "").trim(),
    short_description: String(form["short_description"] ?? "").trim(),
    description: String(form["description"] ?? "").trim(),
    care_instructions: String(form["care_instructions"] ?? "").trim(),
    warranty_text: String(form["warranty_text"] ?? "").trim(),
    seo_title: String(form["seo_title"] ?? "").trim(),
    seo_description: String(form["seo_description"] ?? "").trim(),
    price_cents: parseCentavos(String(form["preco"] ?? "")) ?? "",
    cost_price_cents: parseCentavos(String(form["custo"] ?? "")) ?? "",
    markup_percent: String(form["markup"] ?? "").trim().replace(",", "."),
    price_is_public: form["price_is_public"] !== false,
    is_featured: form["is_featured"] === true,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (salvandoRef.current) throw new Error("Salvamento em andamento.");
      if (!parseCentavos(String(form["custo"] || ""))) {
        throw new Error("Informe o preço de custo do produto antes de salvar.");
      }
      salvandoRef.current = true;
      try {
        return await salvarProduto(id, payload());
      } finally {
        salvandoRef.current = false;
      }
    },
    onSuccess: (r) => {
      setSujo(false);
      toast.success("Rascunho salvo.");
      void qc.invalidateQueries({ queryKey: ["products"] });
      if (!id) {
        void navigate({ to: "/admin/cadastros/produtos/$id", params: { id: r.id } });
      } else {
        void qc.invalidateQueries({ queryKey: ["produto", id] });
      }
    },
    onError: (e) => toast.error(mensagemDeErro(e)),
  });

  const validar = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Salve o rascunho antes de validar.");
      return checklistPublicacao(id);
    },
    onSuccess: (lista) => {
      setImpedimentos(lista);
      if (lista.length === 0) toast.success("Cadastro completo. Pode publicar.");
      else toast.error(`Faltam ${lista.length} itens para publicar.`);
    },
    onError: (e) => toast.error(mensagemDeErro(e)),
  });

  const publicar = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Salve o rascunho antes de publicar.");
      if (sujo) await salvarProduto(id, payload());
      const r = await publicarProdutos([id], "ficha do produto");
      if (r.afetados === 0) {
        setImpedimentos(await checklistPublicacao(id));
        throw new Error("Ainda faltam informações obrigatórias. Veja a lista abaixo.");
      }
    },
    onSuccess: () => {
      setSujo(false);
      setImpedimentos([]);
      toast.success("Produto publicado no site.");
      void qc.invalidateQueries({ queryKey: ["produto", id] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e)),
  });

  const arquivar = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Nada a arquivar.");
      if (p?.status === "publicado") {
        await despublicarProdutos([id], "arquivado pela ficha do produto", "arquivado");
      } else {
        const { error } = await supabase.from("products").update({ status: "arquivado" }).eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Produto arquivado.");
      void qc.invalidateQueries({ queryKey: ["produto", id] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e)),
  });

  const pct = completude(
    {
      name: String(form["name"] || ""),
      slug: slugPrevia,
      internal_code: p?.internal_code ?? null,
      category_id: String(form["category_id"] || "") || null,
      raw_material: String(form["raw_material"] || ""),
      raw_weight_grams: Number(String(form["raw_weight_grams"] || "0").replace(",", ".")) || null,
      raw_supplier_id: String(form["raw_supplier_id"] || "") || null,
      raw_piece_cost_cents: parseCentavos(String(form["raw_piece_cost"] || "")),
      cost_price_cents: parseCentavos(String(form["custo"] || "")),
      measurements: String(form["measurements"] || ""),
      short_description: String(form["short_description"] || ""),
      description: String(form["description"] || ""),
      care_instructions: String(form["care_instructions"] || ""),
      warranty_text: String(form["warranty_text"] || ""),
      seo_title: String(form["seo_title"] || ""),
      seo_description: String(form["seo_description"] || ""),
    },
    temImagem,
    contagemVariantes > 0,
  );

  const custoCents = parseCentavos(String(form["custo"] || ""));
  const margemIndividual = String(form["markup"] || "").trim().replace(",", ".");
  const margemAplicada =
    margemIndividual === "" ? Number(markupGlobal.data ?? 0) : Number(margemIndividual) || 0;
  const sugerido = precoSugerido(custoCents, margemAplicada);
  const margemAtual = margemPraticada(custoCents, parseCentavos(String(form["preco"] || "")));

  const somente = !podeEditar;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={id ? "Produto" : "Novo produto"}
        title={String(form["name"] || "") || "Novo produto"}
        description={`Código interno: ${p?.internal_code ?? "gerado no primeiro salvamento"} · Endereço: /${slugPrevia || "—"} · ${contagemVariantes} variante(s) · ${pct}% concluído`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={p?.status === "publicado" ? "success" : p?.status === "arquivado" ? "neutral" : "warning"}>
              {p?.status ?? "rascunho"}
            </StatusBadge>
            {p?.is_legacy ? <StatusBadge tone="warning">Produto legado — revisão pendente</StatusBadge> : null}
            {p?.status === "publicado" ? (
              <Link to="/produto/$slug" params={{ slug: p.slug }} target="_blank" className="admin-btn">
                <ExternalLink aria-hidden className="size-4" /> Ver no site
              </Link>
            ) : null}
            <button
              type="button"
              className="admin-btn border-champagne"
              disabled={somente || salvar.isPending}
              onClick={() => salvar.mutate()}
            >
              <Save aria-hidden className="size-4" />
              {salvar.isPending ? "Salvando…" : "Salvar rascunho"}
            </button>
            <button
              type="button"
              className="admin-btn"
              disabled={!id || validar.isPending}
              onClick={() => validar.mutate()}
            >
              <ListChecks aria-hidden className="size-4" /> Validar cadastro
            </button>
            <button
              type="button"
              className="admin-btn border-champagne"
              disabled={!id || !podePublicar || publicar.isPending}
              onClick={() => publicar.mutate()}
            >
              <Upload aria-hidden className="size-4" /> Publicar
            </button>
            <button
              type="button"
              className="admin-btn"
              disabled={!id || somente || p?.status === "arquivado"}
              onClick={() => arquivar.mutate()}
            >
              Arquivar
            </button>
          </div>
        }
      />

      {somente ? (
        <p className="rounded-lg border border-line-soft bg-surface-muted px-4 py-3 text-sm text-ledger-muted">
          Seu perfil pode visualizar a ficha, mas não editar. No momento apenas o perfil Master
          cria, altera, publica ou arquiva produtos.
        </p>
      ) : null}

      {sujo ? (
        <p className="rounded-lg border border-champagne/40 bg-surface-muted px-4 py-3 text-sm text-ledger-text">
          Há alterações não salvas nesta ficha.
        </p>
      ) : null}

      {impedimentos && impedimentos.length > 0 ? (
        <Panel title="Falta para publicar">
          <ul className="space-y-2 text-sm">
            {impedimentos.map((i) => (
              <li key={i.codigo} className="flex justify-between gap-4 border-b border-line-soft pb-2">
                <span className="text-ledger-text">{i.rotulo}</span>
                <span className="text-ledger-muted">{i.grupo}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Identificação">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo full label="Nome comercial do produto-base" valor={form["name"]} onChange={(v) => set("name", v)} disabled={somente} ajuda="Sem banho e sem aro quando esses dados variarem entre versões." />
            <Campo label="Endereço da página (slug)" valor={form["slug"]} onChange={(v) => set("slug", v)} disabled={somente} ajuda={`Prévia: /produto/${slugPrevia || "—"}`} />
            <Campo label="Código legado" valor={form["legacy_code"]} onChange={(v) => set("legacy_code", v)} disabled={somente} />
          </div>
        </Panel>

        <Panel title="Categoria e coleção">
          <div className="grid gap-4 sm:grid-cols-2">
            <Selecao
              label="Categoria"
              valor={String(form["category_id"] || "")}
              onChange={(v) => {
                set("category_id", v);
                set("subcategory_id", "");
              }}
              disabled={somente}
              opcoes={raiz.map((c) => ({ value: c.id, label: c.name }))}
            />
            <Selecao
              label="Subcategoria"
              valor={String(form["subcategory_id"] || "")}
              onChange={(v) => set("subcategory_id", v)}
              disabled={somente || filhas.length === 0}
              opcoes={filhas.map((c) => ({ value: c.id, label: c.name }))}
              ajuda={filhas.length === 0 ? "Esta categoria não tem subcategorias." : "Obrigatória para publicar."}
            />
            <Selecao
              label="Coleção"
              valor={String(form["collection_id"] || "")}
              onChange={(v) => set("collection_id", v)}
              disabled={somente}
              opcoes={(colecoes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
            <div className="text-sm text-ledger-muted">
              Caminho: <span className="text-ledger-text">{caminho}</span>
            </div>
          </div>
        </Panel>

        <Panel title="Material bruto">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Material bruto" valor={form["raw_material"]} onChange={(v) => set("raw_material", v)} disabled={somente} />
            <Campo label="Peso bruto (g)" valor={form["raw_weight_grams"]} onChange={(v) => set("raw_weight_grams", v)} disabled={somente} />
            <Selecao
              label="Fornecedor do bruto"
              valor={String(form["raw_supplier_id"] || "")}
              onChange={(v) => set("raw_supplier_id", v)}
              disabled={somente}
              opcoes={(fornecedores.data ?? []).map((f) => ({ value: f.id, label: f.name }))}
            />
            <Campo label="Valor da peça no bruto (R$)" valor={form["raw_piece_cost"]} onChange={(v) => set("raw_piece_cost", v)} disabled={somente} />
            <Campo full label="Medidas" valor={form["measurements"]} onChange={(v) => set("measurements", v)} disabled={somente} />
          </div>
        </Panel>

        <Panel title="Preço">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              label="Preço de custo (R$) *"
              valor={form["custo"]}
              onChange={(v) => set("custo", v)}
              disabled={somente}
              ajuda="Obrigatório: é a base do cálculo de margem."
            />
            <Campo
              label="Margem deste produto (%)"
              valor={form["markup"]}
              onChange={(v) => set("markup", v)}
              disabled={somente}
              ajuda={`Em branco usa a margem padrão do sistema (${markupGlobal.data ?? 0}%).`}
            />
            <Campo label="Preço de venda (R$)" valor={form["preco"]} onChange={(v) => set("preco", v)} disabled={somente} />
            <div className="flex flex-col justify-center gap-2 text-sm">
              <p className="text-ledger-muted">
                Preço sugerido:{" "}
                <span className="text-ledger-text">
                  {sugerido == null ? "—" : `R$ ${centavosParaTexto(sugerido)}`}
                </span>
                {` (margem aplicada ${margemAplicada}%)`}
              </p>
              <p className="text-ledger-muted">
                Margem praticada hoje:{" "}
                <span className="text-ledger-text">
                  {margemAtual == null ? "—" : `${margemAtual.toFixed(1)}%`}
                </span>
              </p>
              <button
                type="button"
                className="admin-btn w-fit"
                disabled={somente || sugerido == null}
                onClick={() => {
                  if (sugerido == null) return;
                  set("preco", centavosParaTexto(sugerido));
                  toast.success("Preço sugerido aplicado. Revise antes de salvar.");
                }}
              >
                Aplicar preço sugerido
              </button>
            </div>
            <Chave label="Mostrar preço no site" valor={form["price_is_public"] !== false} onChange={(v) => set("price_is_public", v)} disabled={somente} />
            <Chave label="Destaque na vitrine" valor={form["is_featured"] === true} onChange={(v) => set("is_featured", v)} disabled={somente} />
          </div>
        </Panel>

        <Panel title="Conteúdo">
          <div className="space-y-4">
            <Area label="Descrição completa" valor={form["description"]} onChange={(v) => set("description", v)} disabled={somente} linhas={6} />
            <div className="flex justify-end">
              <button
                type="button"
                className="admin-btn"
                disabled={somente}
                onClick={() => {
                  const base = String(form["description"] || "");
                  if (!base.trim()) {
                    toast.error("Escreva a descrição completa primeiro.");
                    return;
                  }
                  const atual = String(form["short_description"] || "").trim();
                  if (atual && !window.confirm("Já existe um resumo escrito. Substituir pelo resumo gerado?")) return;
                  set("short_description", gerarResumo(base));
                  toast.success("Resumo gerado. Revise antes de salvar.");
                }}
              >
                <Sparkles aria-hidden className="size-4" /> Gerar resumo a partir da descrição
              </button>
            </div>
            <Area label="Resumo" valor={form["short_description"]} onChange={(v) => set("short_description", v)} disabled={somente} linhas={3} />
            <Area label="Cuidados" valor={form["care_instructions"]} onChange={(v) => set("care_instructions", v)} disabled={somente} linhas={3} />
            <Area label="Garantia" valor={form["warranty_text"]} onChange={(v) => set("warranty_text", v)} disabled={somente} linhas={3} />
            {!padroes.data ? (
              <p className="text-sm text-ledger-muted">
                Padrões do cadastro de produto ainda não configurados (cuidados, garantia e modelos
                para buscadores). Enquanto isso, escreva os textos manualmente.
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel title="SEO">
          <div className="space-y-4">
            <Campo full label="Título para buscadores" valor={form["seo_title"]} onChange={(v) => set("seo_title", v)} disabled={somente} />
            <Area label="Descrição para buscadores" valor={form["seo_description"]} onChange={(v) => set("seo_description", v)} disabled={somente} linhas={3} />
          </div>
        </Panel>
      </div>

      {children}
    </div>
  );
}

function Campo({
  label,
  valor,
  onChange,
  disabled,
  ajuda,
  full,
}: {
  label: string;
  valor: unknown;
  onChange: (v: string) => void;
  disabled?: boolean;
  ajuda?: string;
  full?: boolean;
}) {
  return (
    <label className={full ? "sm:col-span-2 block" : "block"}>
      <span className="mb-1 block text-xs uppercase tracking-wide text-ledger-muted">{label}</span>
      <input
        value={String(valor ?? "")}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm text-ledger-text outline-none focus-visible:ring-2 focus-visible:ring-champagne disabled:opacity-60"
      />
      {ajuda ? <span className="mt-1 block text-xs text-ledger-muted">{ajuda}</span> : null}
    </label>
  );
}

function Area({
  label,
  valor,
  onChange,
  disabled,
  linhas = 4,
}: {
  label: string;
  valor: unknown;
  onChange: (v: string) => void;
  disabled?: boolean;
  linhas?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-ledger-muted">{label}</span>
      <textarea
        value={String(valor ?? "")}
        rows={linhas}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm text-ledger-text outline-none focus-visible:ring-2 focus-visible:ring-champagne disabled:opacity-60"
      />
    </label>
  );
}

function Selecao({
  label,
  valor,
  onChange,
  opcoes,
  disabled,
  ajuda,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: { value: string; label: string }[];
  disabled?: boolean;
  ajuda?: string;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs uppercase tracking-wide text-ledger-muted">{label}</span>
      <SmartSelect
        value={valor}
        onChange={onChange}
        options={[{ value: "", label: "— não informado —" }, ...opcoes]}
        placeholder={label}
        disabled={disabled ?? false}
      />
      {ajuda ? <span className="mt-1 block text-xs text-ledger-muted">{ajuda}</span> : null}
    </div>
  );
}

function Chave({
  label,
  valor,
  onChange,
  disabled,
}: {
  label: string;
  valor: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-line-soft bg-paper px-3 py-2">
      <span className="text-sm text-ledger-text">{label}</span>
      <Switch checked={valor} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

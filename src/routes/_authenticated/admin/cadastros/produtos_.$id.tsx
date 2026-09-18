import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, ImagePlus, Plus, Star, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  PageHeader,
  Panel,
  StatusBadge,
  EmptyState,
  ErrorState,
  Skeleton,
  formatBRLFromCents,
  formatDateTime,
} from "@/components/admin/ui";
import { RecordSheet, type RecordValues } from "@/components/admin/RecordSheet";
import { can, useCapabilities } from "@/lib/capabilities";
import {
  uploadMedia,
  signedMediaUrl,
  parseCentavos,
  centavosParaTexto,
  mensagemDeErro,
} from "@/lib/catalog";
import { ProdutoFicha } from "@/components/admin/ProdutoFicha";
import {
  salvarVariante as salvarVarianteRpc,
  registrarCusto,
  consultarCodigoBarras,
  listarTiposDeBanho,
  lerCustos,
} from "@/lib/produto";


export const Route = createFileRoute("/_authenticated/admin/cadastros/produtos_/$id")({
  component: ProdutoDetalhe,
  head: () => ({
    meta: [
      { title: "Ficha do produto — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const tone = (status: string) =>
  status === "publicado" ? "success" : status === "arquivado" ? "neutral" : "warning";

function ProdutoDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const capacidades = useCapabilities();
  const podeVerCustos = can(capacidades, "catalog.cost.view");


  const [variante, setVariante] = useState<VarianteRow | null>(null);
  const [varianteAberta, setVarianteAberta] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const produto = useQuery({
    queryKey: ["produto", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, name, slug, internal_code, legacy_code, barcode, reference_code, ncm, status, category_id, subcategory_id, collection_id, supplier_id, short_description, description, material, plating, measurements, weight_grams, raw_material, raw_weight_grams, raw_supplier_id, price_cents, price_is_public, is_featured, is_new_arrival, stock_visibility, seo_title, seo_description, care_instructions, warranty_text, published_at, scheduled_publish_at, requires_catalog_review, is_legacy, created_at, updated_at",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const variantes = useQuery({
    queryKey: ["produto-variantes", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants")
        .select(
          "id, product_id, label, sku, barcode, reference_code, ncm, legacy_code, size, color, plating_type_id, plating_supplier_id, varnish_name, final_weight_grams, price_cents, position, is_default, is_active, created_at, updated_at",
        )
        .eq("product_id", id)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  /** Custos vigentes: leitura autorizada no servidor (Master, Diretoria, Financeiro). */
  const custosVigentes = useQuery({
    queryKey: ["produto-custos-vigentes", id],
    enabled: podeVerCustos,
    queryFn: () => lerCustos(id),
  });

  const custos = useQuery({
    queryKey: ["produto-custos", id],
    enabled: podeVerCustos && (variantes.data?.length ?? 0) > 0,
    queryFn: async () => {
      const ids = (variantes.data ?? []).map((v) => v.id);
      const { data, error } = await supabase
        .from("variant_costs")
        .select("id, variant_id, cost_cents, effective_from, note")
        .in("variant_id", ids)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const imagens = useQuery({
    queryKey: ["produto-imagens", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_media")
        .select("id, position, media:media_assets(id, alt, url, storage_path)")
        .eq("product_id", id)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  const historico = useQuery({
    queryKey: ["produto-historico", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, entity, created_at")
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(20);
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

  const banhos = useQuery({
    queryKey: ["tipos-de-banho"],
    queryFn: listarTiposDeBanho,
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

  /** Custos vigentes de uma variante, lidos pela consulta autorizada. */
  const custoDaVariante = (varianteId: string) =>
    (custosVigentes.data?.variantes ?? []).find((v) => v.id === varianteId) ?? null;

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ["produto", id] });
    void qc.invalidateQueries({ queryKey: ["produto-variantes", id] });
    void qc.invalidateQueries({ queryKey: ["produto-imagens", id] });
    void qc.invalidateQueries({ queryKey: ["produto-historico", id] });
    void qc.invalidateQueries({ queryKey: ["products"] });
  };



  /** Grava a variante pela operação canônica: SKU/nome automáticos e unicidade no banco. */
  const salvarVariante = useMutation({
    mutationFn: async (v: RecordValues) => {
      const finalTexto = String(v["custo_final"] ?? "").trim();
      const custo =
        podeVerCustos && finalTexto
          ? {
              raw_supplier_id: String(v["raw_supplier_id"] ?? ""),
              raw_piece_cost_cents: parseCentavos(String(v["custo_bruto"] ?? "")) ?? "",
              plating_supplier_id: String(v["plating_supplier_id"] ?? ""),
              plating_material_cost_cents: parseCentavos(String(v["custo_banho"] ?? "")) ?? "",
              varnish_name: String(v["varnish_name"] ?? "").trim(),
              varnish_cost_cents: parseCentavos(String(v["custo_verniz"] ?? "")) ?? "",
              finished_piece_cost_cents: parseCentavos(finalTexto) ?? "",
              justification: String(v["custo_justificativa"] ?? "").trim(),
              note: String(v["custo_nota"] ?? "").trim(),
            }
          : null;
      // Variante e custo gravam na mesma operação: ou tudo, ou nada.
      const row = await salvarVarianteRpc(variante?.id ?? null, {
        product_id: id,
        label: String(v["label"] ?? "").trim(),
        sku: String(v["sku"] ?? "").trim(),
        barcode: String(v["barcode"] ?? "").trim(),
        reference_code: String(v["reference_code"] ?? "").trim(),
        ncm: String(v["ncm"] ?? "").replace(/\D/g, ""),
        legacy_code: String(v["legacy_code"] ?? "").trim(),
        size: String(v["size"] ?? "").trim(),
        color: String(v["color"] ?? "").trim(),
        plating_type_id: String(v["plating_type_id"] ?? ""),
        price_cents: parseCentavos(String(v["preco"] ?? "")) ?? "",
        position: Number(v["position"] ?? 0) || 0,
        is_default: v["is_default"] === true,
        is_active: v["is_active"] !== false,
        final_weight_grams: String(v["final_weight_grams"] ?? "").replace(",", "."),
        sku_justificativa: String(v["sku_justificativa"] ?? "").trim(),
        ...(custo ? { custo } : {}),
      });
      return row;
    },
    onSuccess: () => {
      toast.success("Variante salva.");
      invalidar();
      void qc.invalidateQueries({ queryKey: ["produto-custos", id] });
      void qc.invalidateQueries({ queryKey: ["produto-custos-vigentes", id] });
    },
    onError: (e: unknown) => toast.error(mensagemDeErro(e)),
  });

  const enviarImagem = useMutation({
    mutationFn: async (file: File) => {
      const media = await uploadMedia(file, file.name);
      const { error } = await supabase.from("product_media").insert({
        product_id: id,
        media_id: media.id,
        position: imagens.data?.length ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Imagem adicionada.");
      invalidar();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível enviar."),
  });

  /** Reescreve a ordem inteira: a primeira imagem é sempre a principal. */
  const reordenar = useMutation({
    mutationFn: async (ids: string[]) => {
      for (let i = 0; i < ids.length; i++) {
        const { error } = await supabase
          .from("product_media")
          .update({ position: i })
          .eq("id", ids[i] as string);
        if (error) throw error;
      }
    },
    onSuccess: () => invalidar(),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível reordenar."),
  });

  const removerImagem = useMutation({
    mutationFn: async (vinculoId: string) => {
      const { error } = await supabase.from("product_media").delete().eq("id", vinculoId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Imagem removida do produto.");
      invalidar();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
  });

  const salvarAlt = useMutation({
    mutationFn: async ({ mediaId, alt }: { mediaId: string; alt: string }) => {
      const { error } = await supabase.from("media_assets").update({ alt }).eq("id", mediaId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Descrição da imagem atualizada.");
      invalidar();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const ordemAtual = (imagens.data ?? []).map((m) => m.id);
  const moverImagem = (index: number, direcao: -1 | 1) => {
    const destino = index + direcao;
    if (destino < 0 || destino >= ordemAtual.length) return;
    const nova = [...ordemAtual];
    const a = nova[index] as string;
    nova[index] = nova[destino] as string;
    nova[destino] = a;
    reordenar.mutate(nova);
  };
  const tornarPrincipal = (index: number) => {
    if (index === 0) return;
    const nova = [...ordemAtual];
    const [alvo] = nova.splice(index, 1);
    nova.unshift(alvo as string);
    reordenar.mutate(nova);
  };

  const p = produto.data;


  if (produto.isLoading) return <Skeleton className="h-64 w-full" />;
  if (produto.error || !p)
    return (
      <ErrorState
        message={produto.error instanceof Error ? produto.error.message : "Produto não encontrado."}
        onRetry={() => void produto.refetch()}
      />
    );

  return (
    <div className="space-y-6">
      <Link to="/admin/cadastros/produtos" className="admin-btn w-fit">
        <ArrowLeft aria-hidden className="size-4" /> Voltar aos produtos
      </Link>

      <ProdutoFicha
        id={id}
        contagemVariantes={variantes.data?.length ?? 0}
        temImagem={(imagens.data?.length ?? 0) > 0}
      >


      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Panel title="Variantes vendáveis">
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                className="admin-btn border-champagne"
                onClick={() => {
                  setVariante(null);
                  setVarianteAberta(true);
                }}
              >
                <Plus aria-hidden className="size-4" /> Nova variante
              </button>
            </div>
            {variantes.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (variantes.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="Nenhuma variante"
                description="Cadastre ao menos uma variante para movimentar estoque e vender."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-ledger-muted">
                    <tr>
                      <th className="py-2 pr-4 font-normal">Variante</th>
                      <th className="py-2 pr-4 font-normal">SKU</th>
                      <th className="py-2 pr-4 font-normal">Código de barras</th>
                      <th className="py-2 pr-4 text-right font-normal">Preço</th>
                      {podeVerCustos ? (
                        <th className="py-2 pr-4 text-right font-normal">Custo atual</th>
                      ) : null}
                      <th className="py-2 font-normal">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(variantes.data ?? []).map((v) => {
                      const custo = custos.data?.find((c) => c.variant_id === v.id);
                      return (
                        <tr
                          key={v.id}
                          className="cursor-pointer border-t border-line-soft hover:bg-surface-muted"
                          onClick={() => {
                            setVariante(v);
                            setVarianteAberta(true);
                          }}
                        >
                          <td className="py-2 pr-4 text-ledger-text">
                            <span className="inline-flex items-center gap-2">
                              {v.is_default ? <Star aria-hidden className="size-3.5 text-bronze" /> : null}
                              {v.label}
                            </span>
                          </td>
                          <td className="num py-2 pr-4">{v.sku ?? "—"}</td>
                          <td className="num py-2 pr-4">{v.barcode ?? "—"}</td>
                          <td className="num py-2 pr-4 text-right">
                            {v.price_cents == null ? "—" : formatBRLFromCents(v.price_cents)}
                          </td>
                          {podeVerCustos ? (
                            <td className="num py-2 pr-4 text-right">
                              {custo ? formatBRLFromCents(custo.cost_cents) : "—"}
                            </td>
                          ) : null}
                          <td className="py-2">
                            <StatusBadge tone={v.is_active ? "success" : "neutral"}>
                              {v.is_active ? "Ativa" : "Inativa"}
                            </StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Imagens">
            <div className="mb-4 flex justify-end">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) enviarImagem.mutate(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="admin-btn border-champagne"
                onClick={() => fileRef.current?.click()}
                disabled={enviarImagem.isPending}
              >
                <ImagePlus aria-hidden className="size-4" />
                {enviarImagem.isPending ? "Enviando…" : "Adicionar imagem"}
              </button>
            </div>
            {(imagens.data?.length ?? 0) === 0 ? (
              <EmptyState title="Sem imagens" description="Envie as fotos da peça para exibir no site." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(imagens.data ?? []).map((m, i) => {
                  const media = m.media as { id: string; alt: string; storage_path: string | null } | null;
                  return (
                    <ImagemCard
                      key={m.id}
                      path={media?.storage_path ?? null}
                      alt={media?.alt ?? "Imagem do produto"}
                      principal={i === 0}
                      podeVoltar={i > 0}
                      podeAvancar={i < (imagens.data?.length ?? 0) - 1}
                      onVoltar={() => moverImagem(i, -1)}
                      onAvancar={() => moverImagem(i, 1)}
                      onPrincipal={() => tornarPrincipal(i)}
                      onRemover={() => removerImagem.mutate(m.id)}
                      onAlt={(alt) => media && salvarAlt.mutate({ mediaId: media.id, alt })}
                    />
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Preço público">
            <p className="num text-2xl text-ledger-text">
              {p.price_cents == null ? "Sem preço" : formatBRLFromCents(p.price_cents)}
            </p>
            <p className="mt-1 text-sm text-ledger-muted">
              {p.price_is_public ? "Visível no site quando publicado." : "Uso interno: não aparece no site."}
            </p>
            <p className="mt-2 text-sm text-ledger-muted">
              {p.is_featured ? "Peça marcada como destaque na vitrine." : "Sem destaque na vitrine."}
            </p>
          </Panel>

          <Panel title="Histórico">
            {(historico.data?.length ?? 0) === 0 ? (
              <EmptyState title="Sem registros" description="Nenhuma alteração auditada até agora." />
            ) : (
              <ul className="space-y-2 text-sm">
                {(historico.data ?? []).map((h) => (
                  <li key={h.id} className="flex justify-between gap-3 border-b border-line-soft pb-2">
                    <span className="text-ledger-text">{h.action}</span>
                    <span className="num text-ledger-muted">{formatDateTime(h.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      </ProdutoFicha>


      <RecordSheet
        open={varianteAberta}
        onOpenChange={setVarianteAberta}
        title={variante ? `Editar variante — ${variante.label}` : "Nova variante"}
        description="SKU e código de barras são únicos quando informados."
        initial={
          variante
            ? {
                label: variante.label,
                sku: variante.sku ?? "",
                barcode: variante.barcode ?? "",
                legacy_code: variante.legacy_code ?? "",
                size: variante.size ?? "",
                color: variante.color ?? "",
                plating_type_id: variante.plating_type_id ?? "",
                preco: variante.price_cents == null ? "" : centavosParaTexto(variante.price_cents),
                position: variante.position,
                is_default: variante.is_default,
                is_active: variante.is_active,
                final_weight_grams: variante.final_weight_grams ?? "",
                plating_supplier_id: variante.plating_supplier_id ?? "",
                varnish_name: variante.varnish_name ?? "",
                custo_bruto: centavosParaTexto(
                  custosVigentes.data?.produto.raw_piece_cost_cents ?? null,
                ),
                raw_supplier_id: produto.data?.raw_supplier_id ?? "",
                custo_banho: centavosParaTexto(custoDaVariante(variante.id)?.plating_material_cost_cents ?? null),
                custo_verniz: centavosParaTexto(custoDaVariante(variante.id)?.varnish_cost_cents ?? null),
                custo_final: centavosParaTexto(custoDaVariante(variante.id)?.finished_piece_cost_cents ?? null),
              }
            : { is_active: true }
        }
        fields={[
          {
            name: "plating_type_id",
            label: "Tipo de banho",
            type: "select",
            options: (banhos.data ?? []).map((b) => ({ value: b.id, label: b.name })),
            help: "Fonte controlada — evita Ouro/ouro/Dourado como coisas diferentes.",
          },
          { name: "size", label: "Tamanho / aro", type: "text" },
          {
            name: "label",
            label: "Nome da variante",
            type: "text",
            full: true,
            help: "Deixe vazio para o sistema montar: produto + banho + tamanho.",
          },
          { name: "sku", label: "SKU", type: "text", help: "Vazio = gerado a partir do código interno." },
          {
            name: "barcode",
            label: "Código de barras",
            type: "text",
            help: "Etiqueta existente: digite ou leia com o leitor. Zeros à esquerda são preservados.",
            action: {
              label: "Consultar código de barras",
              run: async (valor) => {
                if (!valor.trim()) {
                  toast.error("Informe um código para consultar.");
                  return;
                }
                const r = await consultarCodigoBarras(valor);
                if (r.encontrado) toast.error(`Já usado por ${r.produto} — ${r.variante}.`);
                else toast.success("Código livre.");
              },
            },
          },
          { name: "legacy_code", label: "Código legado", type: "text" },
          { name: "color", label: "Cor comercial", type: "text" },
          { name: "preco", label: "Preço (R$)", type: "text", placeholder: "0,00" },
          { name: "final_weight_grams", label: "Peso final (g)", type: "text" },
          { name: "position", label: "Ordem", type: "number" },
          { name: "is_default", label: "Variante padrão", type: "switch" },
          { name: "is_active", label: "Ativa", type: "switch" },
          {
            name: "sku_justificativa",
            label: "Justificativa para mudar o SKU",
            type: "text",
            full: true,
            help: "Obrigatória quando a variante já tem movimentação de estoque.",
          },
          ...(podeVerCustos
            ? ([
                {
                  name: "custo_bruto",
                  label: "Valor da peça no bruto (R$)",
                  type: "text" as const,
                  placeholder: "0,00",
                },
                {
                  name: "raw_supplier_id",
                  label: "Fornecedor do bruto",
                  type: "select" as const,
                  options: (fornecedores.data ?? []).map((f) => ({ value: f.id, label: f.name })),
                },
                { name: "custo_banho", label: "Valor do material do banho (R$)", type: "text" as const },
                {
                  name: "plating_supplier_id",
                  label: "Fornecedor do banho",
                  type: "select" as const,
                  options: (fornecedores.data ?? []).map((f) => ({ value: f.id, label: f.name })),
                },
                { name: "varnish_name", label: "Verniz utilizado", type: "text" as const },
                { name: "custo_verniz", label: "Valor do verniz (R$)", type: "text" as const },
                {
                  name: "custo_final",
                  label: "Valor final da peça banhada (R$)",
                  type: "text" as const,
                  help: "Preencher cria uma nova vigência de custo; o histórico anterior é mantido.",
                },
                {
                  name: "custo_justificativa",
                  label: "Justificativa da diferença",
                  type: "text" as const,
                  full: true,
                  help: "Obrigatória quando o valor final difere da soma dos componentes.",
                },
                { name: "custo_nota", label: "Observação do custo", type: "text" as const },
              ])
            : []),
        ]}
        onSubmit={async (v) => {
          await salvarVariante.mutateAsync(v);
        }}
      />
    </div>
  );
}

interface VarianteRow {
  id: string;
  label: string;
  sku: string | null;
  barcode: string | null;
  reference_code: string | null;
  ncm: string | null;
  legacy_code: string | null;
  size: string | null;
  color: string | null;
  plating_type_id: string | null;
  plating_supplier_id: string | null;
  varnish_name: string | null;
  final_weight_grams: number | null;
  price_cents: number | null;
  position: number;
  is_default: boolean;
  is_active: boolean;
}

function ImagemCard({
  path,
  alt,
  principal,
  podeVoltar,
  podeAvancar,
  onVoltar,
  onAvancar,
  onPrincipal,
  onRemover,
  onAlt,
}: {
  path: string | null;
  alt: string;
  principal: boolean;
  podeVoltar: boolean;
  podeAvancar: boolean;
  onVoltar: () => void;
  onAvancar: () => void;
  onPrincipal: () => void;
  onRemover: () => void;
  onAlt: (alt: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [texto, setTexto] = useState(alt);
  useEffect(() => setTexto(alt), [alt]);
  useEffect(() => {
    let vivo = true;
    if (!path) return;
    void signedMediaUrl(path).then((u) => {
      if (vivo) setUrl(u);
    });
    return () => {
      vivo = false;
    };
  }, [path]);
  return (
    <figure className="overflow-hidden rounded-lg border border-line-soft bg-surface-muted">
      <div className="relative">
        {url ? (
          <img src={url} alt={alt} loading="lazy" className="aspect-square w-full object-cover" />
        ) : (
          <div className="aspect-square w-full animate-pulse bg-surface-muted" />
        )}
        {principal ? (
          <span className="absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-champagne">
            Principal
          </span>
        ) : null}
      </div>
      <figcaption className="space-y-2 p-2">
        <label className="sr-only" htmlFor={`alt-${path ?? "sem"}`}>
          Descrição da imagem
        </label>
        <input
          id={`alt-${path ?? "sem"}`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => {
            const limpo = texto.trim();
            if (limpo && limpo !== alt) onAlt(limpo);
          }}
          placeholder="Descreva a imagem"
          className="w-full rounded-md border border-line-soft bg-paper px-2 py-1 text-xs text-ledger-text outline-none focus-visible:ring-2 focus-visible:ring-champagne"
        />
        <div className="flex items-center justify-between gap-1">
          <div className="flex gap-1">
            <button
              type="button"
              className="admin-btn px-2 py-1"
              onClick={onVoltar}
              disabled={!podeVoltar}
              aria-label="Mover para trás"
            >
              <ChevronLeft aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              className="admin-btn px-2 py-1"
              onClick={onAvancar}
              disabled={!podeAvancar}
              aria-label="Mover para frente"
            >
              <ChevronRight aria-hidden className="size-3.5" />
            </button>
          </div>
          <div className="flex gap-1">
            {!principal ? (
              <button
                type="button"
                className="admin-btn px-2 py-1"
                onClick={onPrincipal}
                aria-label="Tornar principal"
              >
                <Star aria-hidden className="size-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              className="admin-btn px-2 py-1"
              onClick={onRemover}
              aria-label="Remover imagem do produto"
            >
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
      </figcaption>
    </figure>
  );
}

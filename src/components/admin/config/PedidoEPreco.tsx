/**
 * 0157 — Configurações do pedido de consignação e do preço novo.
 *  - Dados fixos da folha (endereço, contato de pedidos, Pix, garantia, montagem, prazo do correio): só o Master altera.
 *  - Preço novo: relatório antigo × novo (baixar CSV para aprovar), aplicar só com o Master digitando a confirmação,
 *    desfazer pelo lote. Maleta na rua não muda: acerta pelo preço gravado na remessa.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Save, Tags } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { traduzir } from "@/lib/maletas";
import { exigirPreBaixa } from "@/lib/pre-baixa";
import { useServerFn } from "@tanstack/react-start";
import { vincularPixPedidoAsaas } from "@/lib/pedido-pix.functions";
import { validarPixGlobal, type PixPedido } from "@/lib/pix-pedido";
import { Button } from "@/components/ui/button";
import QRCode from "qrcode";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}
const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Config = Record<string, string | number | null>;
const CAMPOS: { k: string; rotulo: string; longo?: boolean; numero?: boolean }[] = [
  { k: "endereco_linha", rotulo: "Linha de endereço do cabeçalho" },
  { k: "pedidos_telefone", rotulo: "Telefone de pedidos" },
  { k: "pedidos_email", rotulo: "E-mail de pedidos" },
  { k: "prazo_correio_dias", rotulo: "Prazo do correio (dias antes do acerto)", numero: true },
  { k: "pagamento_texto", rotulo: "Formas de pagamento", longo: true },
  { k: "pix_tipo", rotulo: "Tipo da chave Pix" },
  { k: "pix_chave", rotulo: "Chave Pix" },
  { k: "pix_favorecido", rotulo: "Favorecido do Pix" },
  { k: "garantia_titulo", rotulo: "Título da garantia" },
  { k: "garantia_texto", rotulo: "Garantia — o que cobre (use **negrito**)", longo: true },
  { k: "garantia_exclusoes", rotulo: "Garantia — o que não cobre (use **negrito**)", longo: true },
  { k: "montagem_texto", rotulo: "Montagem do próximo kit", longo: true },
  { k: "rodape_texto", rotulo: "Rodapé" },
  { k: "proxima_maleta_texto", rotulo: "Aviso — vendas para receber a próxima maleta", longo: true },
  { k: "proxima_maleta_minimo_cents", rotulo: "Venda mínima informada (R$)", numero: true },
];

export function ConfigPedido({ master }: { master: boolean }) {
  const qc = useQueryClient();
  const vincular = useServerFn(vincularPixPedidoAsaas);
  const pix = useQuery({ queryKey: ["pedido-pix-asaas"], queryFn: () => rpc<PixPedido | null>("pedido_pix_asaas_ler"), retry: false });
  const [qrImage, setQrImage] = React.useState("");
  React.useEffect(() => {
    let ativo = true;
    setQrImage("");
    if (pix.data) QRCode.toDataURL(pix.data.payload, { width: 300, margin: 4, errorCorrectionLevel: "M" }).then((url) => { if (ativo) setQrImage(url); }).catch(() => { if (ativo) toast.error("Não foi possível desenhar o QR Pix."); });
    return () => { ativo = false; };
  }, [pix.data]);
  const ligarPix = useMutation({ mutationFn: () => vincular(), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["pedido-pix-asaas"] }); toast.success("Pix oficial vinculado ao pedido, sem valor fixo."); }, onError: (e) => toast.error(traduzir(e)) });
  const q = useQuery({ queryKey: ["pedido-config"], queryFn: () => rpc<Config>("pedido_config_ler") });
  const [form, setForm] = React.useState<Config>({});
  const [editado, setEditado] = React.useState(false);
  React.useEffect(() => { if (q.data && !editado) setForm(q.data); }, [q.data, editado]);
  const alterar = (k: string, v: string) => { setEditado(true); setForm((f) => ({ ...f, [k]: v })); };
  const salvar = useMutation({
    mutationFn: () => {
      const mudou: Config = {};
      for (const c of CAMPOS) if (String(form[c.k] ?? "") !== String(q.data?.[c.k] ?? "")) mudou[c.k] = c.numero ? (c.k === "proxima_maleta_minimo_cents" && String(form[c.k] ?? "") === "" ? null : Number(form[c.k])) : form[c.k] ?? "";
      if (!Object.keys(mudou).length) throw new Error("Nada mudou.");
      return rpc<Config>("pedido_config_salvar", { _dados: mudou });
    },
    onSuccess: (dados) => { setForm(dados); setEditado(false); qc.setQueryData(["pedido-config"], dados); toast.success("Dados do pedido salvos. Valem na próxima impressão."); void qc.invalidateQueries({ queryKey: ["consultora", "aviso-proxima-maleta"] }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  if (q.isError) return <p role="alert" className="text-destructive">{traduzir(q.error)}</p>;
  if (!q.data) return <p className="text-ledger-muted">Carregando dados do pedido…</p>;
  return (
    <Panel title="Pedido de consignação — dados da folha">
      <div className="mb-6 space-y-3 border-b border-line-soft pb-5">
        <p className="font-semibold text-asaas">Pix global Asaas LARDAN</p>
        {pix.isError ? <p role="alert" className="text-sm text-destructive">{traduzir(pix.error)}</p> : pix.data ? <div className="flex flex-wrap items-center gap-4">
          {qrImage && <img src={qrImage} alt="QR Pix oficial da conta LARDAN no Asaas" className="size-28" />}
          <div className="min-w-0 flex-1 text-sm"><p className="font-semibold">{validarPixGlobal(pix.data.payload, pix.data.chave).favorecido}</p><p className="break-all">Chave aleatória: {pix.data.chave}</p><p className="text-ledger-muted">Sem valor fixo · múltiplos pagamentos · vinculado em {new Date(pix.data.atualizado_em).toLocaleString("pt-BR")}</p></div>
        </div> : <p className="text-sm text-ledger-muted">Pix oficial ainda não vinculado ao pedido.</p>}
        {master && !pix.data && <Button className="bg-asaas text-asaas-foreground hover:bg-asaas/90" disabled={ligarPix.isPending || pix.isPending} onClick={() => ligarPix.mutate()}>{ligarPix.isPending ? "Consultando Asaas…" : "Vincular Pix Asaas ao pedido"}</Button>}
        <p className="text-xs text-ledger-muted">O QR usa a chave oficial do Asaas. Os campos manuais abaixo são preservados; o QR oficial prevalece na impressão. Recebimentos precisam ser conferidos na conciliação: pagar o QR não baixa dívidas automaticamente pelo nome.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {CAMPOS.map((c) => (
          <label key={c.k} className={`grid gap-1.5 text-sm ${c.longo ? "md:col-span-2" : ""}`}>
            <span className="ledger-eyebrow">{c.rotulo}</span>
            {c.longo
              ? <textarea className="admin-input min-h-20" disabled={!master || salvar.isPending} value={String(form[c.k] ?? "")} onChange={(e) => alterar(c.k, e.target.value)} />
              : <input className="admin-input" disabled={!master || salvar.isPending} inputMode={c.numero ? "decimal" : undefined} value={c.k === "proxima_maleta_minimo_cents" ? (form[c.k] == null ? "" : (Number(form[c.k]) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })) : String(form[c.k] ?? "")}
                  onChange={(e) => alterar(c.k, c.k === "proxima_maleta_minimo_cents" ? (e.target.value.replace(/\D/g, "") || "") : c.numero ? e.target.value.replace(/\D/g, "") : e.target.value)} />}
          </label>
        ))}
      </div>
      <RegraPreBaixa master={master} ligada={Boolean(q.data["exigir_pre_baixa"])} />
      {master ? (
        <Button className="mt-4" disabled={salvar.isPending || !editado} onClick={() => salvar.mutate()}>
          <Save aria-hidden className="size-4" /> Salvar dados do pedido
        </Button>
      ) : <p className="mt-4 text-sm text-ledger-muted">Só o Master altera estes dados.</p>}
    </Panel>
  );
}

type Linha = { variant_id: string; sku: string | null; produto: string; variante: string | null; categoria: string | null;
  antes_cents: number; depois_cents: number; diferenca_cents: number; pecas_na_rua: number; pecas_estoque: number };
type Resumo = { variantes: number; mudam: number; antes_cents: number; depois_cents: number; maior_aumento_cents: number;
  media_aumento_pct: number | null; virada_em: string | null; ultimo_lote: string | null };

const csv = (linhas: Linha[]) => {
  const c = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const r = (n: number) => (Number(n) / 100).toFixed(2).replace(".", ",");
  return "﻿" + ["SKU;Produto;Variante;Categoria;Preço antigo;Preço novo;Diferença;Peças na rua;Peças no estoque",
    ...linhas.map((l) => [c(l.sku), c(l.produto), c(l.variante), c(l.categoria), r(l.antes_cents), r(l.depois_cents), r(l.diferenca_cents), l.pecas_na_rua, l.pecas_estoque].join(";"))].join("\r\n");
};

export function PrecoNovo({ master }: { master: boolean }) {
  const qc = useQueryClient();
  const resumo = useQuery({ queryKey: ["preco-novo", "resumo"], queryFn: () => rpc<Resumo>("preco_reajuste_resumo"), retry: false });
  const [ver, setVer] = React.useState(false);
  const lista = useQuery({
    queryKey: ["preco-novo", "lista"], enabled: ver, retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preco_reajuste_previa" as never).range(0, 49999);
      if (error) throw error;
      return (data ?? []) as unknown as Linha[];
    },
  });
  const [confirma, setConfirma] = React.useState("");
  const aplicar = useMutation({
    mutationFn: () => rpc<{ lote: string; lista: number; variantes: number; maletas_em_montagem: number }>("preco_reajuste_aplicar", { _confirmacao: confirma }),
    onSuccess: (r) => { toast.success(`Preço novo aplicado (${r.variantes} variantes; lote ${r.lote}).`); setConfirma(""); void qc.invalidateQueries({ queryKey: ["preco-novo"] }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  const desfazer = useMutation({
    mutationFn: (lote: string) => rpc<{ variantes: number }>("preco_reajuste_desfazer", { _lote: lote }),
    onSuccess: (r) => { toast.success(`Reajuste desfeito (${r.variantes} variantes voltaram).`); void qc.invalidateQueries({ queryKey: ["preco-novo"] }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  if (resumo.isError) return null; // sem permissão: não mostra
  const r = resumo.data;
  const baixar = () => {
    if (!lista.data) return;
    const url = URL.createObjectURL(new Blob([csv(lista.data)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `preco-antigo-x-novo-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Panel title="Preço novo (sempre para cima: ,90 até R$ 99,99 · 4,90 ou 9,90 a partir de R$ 100)">
      <div className="space-y-4 text-sm">
        {r && (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-line-soft p-3"><p className="ledger-eyebrow">Variantes com preço</p><p className="text-xl font-semibold">{r.variantes}</p></div>
            <div className="rounded-xl border border-line-soft p-3"><p className="ledger-eyebrow">Mudam de preço</p><p className="text-xl font-semibold">{r.mudam}</p></div>
            <div className="rounded-xl border border-line-soft p-3"><p className="ledger-eyebrow">Soma antes → depois</p><p className="text-base font-semibold">{brl(r.antes_cents)} → {brl(r.depois_cents)}</p></div>
            <div className="rounded-xl border border-line-soft p-3"><p className="ledger-eyebrow">Aumento médio / maior</p><p className="text-base font-semibold">{r.media_aumento_pct ?? 0}% · {brl(r.maior_aumento_cents)}</p></div>
          </div>
        )}
        <p className="text-ledger-muted">
          O relatório mostra cada peça com o preço antigo, o novo e a diferença. Maleta já na rua acerta pelo preço gravado na remessa;
          maleta ainda em montagem passa ao preço novo quando você aplicar. {r?.virada_em ? `Última virada: ${new Date(r.virada_em).toLocaleString("pt-BR")}.` : "Ainda não aplicado."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="admin-btn" onClick={() => setVer(true)} disabled={lista.isFetching}>
            <Tags aria-hidden className="size-4" /> {lista.isFetching ? "Montando o relatório…" : "Ver relatório antigo × novo"}
          </button>
          {lista.data && <button type="button" className="admin-btn" onClick={baixar}><Download aria-hidden className="size-4" /> Baixar planilha (CSV)</button>}
        </div>
        {lista.data && (
          <div className="max-h-96 overflow-auto rounded-xl border border-line-soft">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface text-left text-ledger-muted"><tr>
                <th className="px-3 py-2">SKU</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2 text-right">Antigo</th>
                <th className="px-3 py-2 text-right">Novo</th><th className="px-3 py-2 text-right">Diferença</th><th className="px-3 py-2 text-right">Na rua</th></tr></thead>
              <tbody>{lista.data.slice(0, 500).map((l) => (
                <tr key={l.variant_id} className="border-t border-line-soft">
                  <td className="px-3 py-1.5">{l.sku ?? "—"}</td><td className="px-3 py-1.5">{l.produto}{l.variante && l.variante !== l.produto ? ` · ${l.variante}` : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{brl(l.antes_cents)}</td><td className="px-3 py-1.5 text-right tabular-nums">{brl(l.depois_cents)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.diferenca_cents ? `+ ${brl(l.diferenca_cents)}` : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.pecas_na_rua || "—"}</td>
                </tr>))}</tbody>
            </table>
            {lista.data.length > 500 && <p className="p-3 text-ledger-muted">Mostrando 500 de {lista.data.length}. A planilha tem todas.</p>}
          </div>
        )}
        {master && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
            <p className="font-semibold text-ledger-text">Aplicar o preço novo</p>
            <p className="mt-1 text-ledger-muted">Só depois de aprovar o relatório. Para confirmar, digite <strong>APLICAR NOVO PRECO</strong>.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input className="admin-input max-w-xs" value={confirma} onChange={(e) => setConfirma(e.target.value)} placeholder="APLICAR NOVO PRECO" />
              <button type="button" className="admin-btn admin-btn-primary" disabled={confirma !== "APLICAR NOVO PRECO" || aplicar.isPending} onClick={() => aplicar.mutate()}>Aplicar</button>
              {r?.ultimo_lote && (
                <button type="button" className="admin-btn" disabled={desfazer.isPending} onClick={() => desfazer.mutate(r.ultimo_lote!)}>Desfazer o último ({r.ultimo_lote})</button>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** 0158 — "Sem pré-baixa fechada não sai kit novo": o Master liga quando o app com a pré-baixa estiver publicado. */
function RegraPreBaixa({ master, ligada }: { master: boolean; ligada: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: boolean) => exigirPreBaixa(v),
    onSuccess: (v) => { toast.success(v ? "Regra ligada: kit novo só com pré-baixa fechada." : "Regra desligada."); void qc.invalidateQueries({ queryKey: ["pedido-config"] }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft p-3 text-sm">
      <div>
        <p className="font-semibold text-ledger-text">Kit novo só com pré-baixa fechada</p>
        <p className="text-ledger-muted">{ligada ? "Ligada: a remessa não abre maleta para quem não fechou a pré-baixa da anterior (o Master libera com motivo)." : "Desligada. Ligue quando o app com a pré-baixa estiver no ar para as consultoras."}</p>
      </div>
      {master && <button type="button" className="admin-btn" disabled={m.isPending} onClick={() => m.mutate(!ligada)}>{ligada ? "Desligar" : "Ligar"}</button>}
    </div>
  );
}

import * as React from "react";
import { EtiquetasImprimir } from "@/components/admin/EtiquetasImprimir";
import { useQuery } from "@tanstack/react-query";
import { FileText, Printer, ScrollText, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl, traduzir, type ItemComposicao } from "@/lib/maletas";
import { valorPorExtenso } from "@/lib/remessa";

interface DocConsultora {
  nome: string;
  doc: string | null;
  rg: string | null;
  praca: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  cep: string | null;
  whatsapp: string | null;
  vencimento: string | null;
  remessa_numero?: number | null;
  remessa_emissao?: string | null;
  representante?: string | null;
}

async function docConsultora(cycleId: string): Promise<DocConsultora> {
  const { data, error } = await supabase.rpc("kit_consultora_doc" as never, { _cycle: cycleId } as never);
  if (error) throw error;
  return data as unknown as DocConsultora;
}

function dataPorExtenso(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

function dataCurta(iso: string | null | undefined) {
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split("-").reverse().join("/");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function abrirImpressao(titulo: string, corpo: string) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    toast.error("O navegador bloqueou a janela de impressão. Libere pop-ups para esta tela.");
    return;
  }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px}
  h1{font-size:18px;text-align:center;letter-spacing:.12em;margin:0 0 4px}
  h2{font-size:13px;text-align:center;margin:0 0 16px;font-weight:400}
  .caixa{border:1.5px solid #111;padding:14px 18px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border-bottom:1px solid #999;padding:4px 6px;text-align:left}
  th{background:#eee}
  .r{text-align:right}.c{text-align:center}
  .assinatura{margin-top:56px;border-top:1px solid #111;width:70%;margin-left:auto;margin-right:auto;text-align:center;padding-top:4px}
  .valor{font-size:16px;font-weight:700}
  .mutismo{font-size:11px;color:#333}
  @media print{body{margin:10mm}}
</style></head><body>${corpo}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

const CREDOR = "TSM COMÉRCIO DE SEMIJOIAS LTDA";
const CNPJ = "43.319.208/0001-80";
const PRACA_PAGAMENTO = "Ibiporã - PR";

function htmlPromissoria(doc: DocConsultora, valorCents: number, codigoMaleta: string) {
  const hoje = new Date();
  const venc = doc.vencimento ? new Date(doc.vencimento) : new Date(hoje.getTime() + 10 * 864e5);
  const extenso = valorPorExtenso(valorCents);
  return `
  <h1>NOTA PROMISSÓRIA</h1>
  <h2>Referente à maleta ${codigoMaleta}</h2>
  <div class="caixa">
    <p class="valor r">${brl(valorCents)} &nbsp;·&nbsp; ${extenso}</p>
    <p>Vencimento em <strong>${venc.toLocaleDateString("pt-BR")}</strong></p>
    <p>Em <strong>${dataPorExtenso(venc)}</strong> pagarei por esta única via de NOTA PROMISSÓRIA a
    <strong>${CREDOR}</strong> inscrita no CNPJ/MF sob nº <strong>${CNPJ}</strong>, ou a sua ordem,
    a quantia de <strong>(${extenso})</strong> em moeda corrente deste país.</p>
    <p>Pagável em <strong>${PRACA_PAGAMENTO}</strong>.</p>
    <p style="margin-top:18px">Emitente (DEVEDOR): <strong>${doc.nome}</strong></p>
    <p>Endereço: ${doc.endereco ?? "________________________"}${doc.bairro ? ` - ${doc.bairro}` : ""}</p>
    <p>Cidade/UF: ${doc.cidade ?? "__________"} &nbsp; CEP: ${doc.cep ?? "________"}</p>
    <p>R.G: ${doc.rg ?? "__________"} &nbsp; CPF/MF: ${doc.doc ?? "__________"}</p>
    <p class="r">IBIPORÃ/PR, ${dataPorExtenso(hoje)}</p>
    <div class="assinatura">Assinatura: ${doc.nome}</div>
  </div>`;
}

function htmlPedido(doc: DocConsultora, composicao: ItemComposicao[], codigoMaleta: string, dataAcerto: string | null, operador: string) {
  const linhas = [...composicao]
    .sort((a, b) => (a.sku ?? "").localeCompare(b.sku ?? ""))
    .map(
      (c) => `<tr>
        <td>${c.sku ?? "—"}</td>
        <td>${c.produto}${c.variante ? ` ${c.variante}` : ""}</td>
        <td class="r">${brl(c.valor_unitario)}</td>
        <td class="c">${c.quantidade}</td>
      </tr>`,
    )
    .join("");
  const totalPecas = composicao.reduce((s, c) => s + c.quantidade, 0);
  const agora = new Date();
  return `
  <h1>REMESSA KIT</h1>
  <h2>Maleta ${codigoMaleta}</h2>
  <div class="caixa">
    <p><strong>REMESSA:</strong> ${doc.remessa_numero ?? "—"} &nbsp; <strong>PRAÇA:</strong> ${doc.praca ?? "—"} &nbsp; <strong>EMISSÃO:</strong> ${dataCurta(doc.remessa_emissao ?? null)}</p>
    <p><strong>CLIENTE:</strong> ${doc.nome} &nbsp; <strong>VENDEDOR/REPRESENTANTE:</strong> ${doc.representante ?? "—"}</p>
    <p><strong>DATA DE ACERTO:</strong> ${dataCurta(doc.vencimento ?? dataAcerto)}</p>
    <p class="mutismo">SERÃO EFETUADAS DUAS TENTATIVAS DE CONTATO PARA ENCOMENDAS NA SEMANA ANTERIOR AO ACERTO,
    não havendo resposta será feita a montagem baseada no seu histórico de vendas, levando em consideração:
    tipos de produto e faturamento.</p>
    <p><strong>FORMAS DE PAGAMENTO:</strong> Dinheiro (moeda nacional), cartão de crédito e débito.
    Cheque somente mediante consulta.</p>
    <p><strong>GARANTIAS:</strong> Nos responsabilizamos por qualquer defeito de fabricação, no prazo de 24 meses,
    porém ficará anulada caso sejam constatadas irregularidades por mau uso: riscos nas peças por atrito;
    contato com cosméticos ou produtos químicos em geral; peças e correntes arrebentadas ou amassadas;
    peças em prata pura ou aço inox.</p>
  </div>
  <div class="caixa">
    <p><strong>Vendedor(a):</strong> ${doc.nome}</p>
    <p><strong>Endereço:</strong> ${doc.endereco ?? "—"}${doc.bairro ? ` — Bairro: ${doc.bairro}` : ""}</p>
    <p><strong>Cidade:</strong> ${doc.cidade ?? "—"} &nbsp; <strong>Cel/WhatsApp:</strong> ${doc.whatsapp ?? "—"}</p>
    <p class="mutismo"><strong>CONFIRA SEU KIT COM O ROMANEIO NO ATO DA ENTREGA. NÃO ACEITAMOS RECLAMAÇÕES POSTERIORES. OBRIGADO.</strong></p>
  </div>
  <table>
    <thead><tr><th>CÓDIGO</th><th>DESCRIÇÃO</th><th class="r">PREÇO SUGERIDO R$</th><th class="c">QTDE</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>
  <p class="valor" style="margin-top:10px">QTDE. PÇS ${totalPecas}</p>
  <p class="mutismo">Impresso em: ${agora.toLocaleDateString("pt-BR")} ${agora.toLocaleTimeString("pt-BR")} · Usuário logado: ${operador}</p>`;
}

/**
 * Documentos da remessa da cliente: promissória e pedido para impressão,
 * e o lugar reservado para a nota fiscal consignada (em implantação).
 */
export function DocumentosMaleta({
  cycleId,
  codigoMaleta,
  titulo,
  composicao,
  dataAcerto,
  operador,
  aoFechar,
}: {
  cycleId: string;
  codigoMaleta: string;
  titulo: string;
  composicao: ItemComposicao[];
  dataAcerto: string | null;
  operador: string;
  aoFechar: () => void;
}) {
  const doc = useQuery({ queryKey: ["maletas", "doc", cycleId], queryFn: () => docConsultora(cycleId) });
  const valorTotal = composicao.reduce((s, c) => s + c.quantidade * c.valor_unitario, 0);

  return (
    <div role="dialog" aria-modal="true" aria-label="Documentos da remessa" className="fixed inset-0 z-[100] overflow-auto bg-background">
      <div className="mx-auto max-w-[1100px] space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="ledger-eyebrow">Documentos da remessa</p>
            <p className="font-display text-2xl font-bold text-ledger-text">{titulo}</p>
          </div>
          <button type="button" className="admin-btn" onClick={aoFechar}>
            <X aria-hidden className="size-4" /> Concluir
          </button>
        </div>

        {doc.isError && (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {traduzir(doc.error)}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="ledger-panel flex flex-col gap-3 p-6">
            <Printer aria-hidden className="size-8 text-ledger-text" />
            <p className="font-display text-lg font-bold text-ledger-text">Etiquetas das peças</p>
            <EtiquetasImprimir origens={composicao.map((c) => ({ variantId: c.variant_id, quantidade: c.quantidade }))} />
          </div>
          <div className="ledger-panel flex flex-col gap-3 p-6">
            <ScrollText aria-hidden className="size-8 text-ledger-text" />
            <p className="font-display text-lg font-bold text-ledger-text">Nota promissória</p>
            <p className="flex-1 text-sm text-ledger-muted">
              Valor da maleta: <strong className="text-ledger-text">{brl(valorTotal)}</strong>
              {doc.data?.vencimento ? ` · vencimento ${dataCurta(doc.data.vencimento)}` : ""}.
            </p>
            <button
              type="button"
              className="admin-btn admin-btn-primary justify-center"
              disabled={!doc.data}
              onClick={() => doc.data && abrirImpressao("Nota Promissória", htmlPromissoria(doc.data, valorTotal, codigoMaleta))}
            >
              <Printer aria-hidden className="size-4" /> Imprimir promissória
            </button>
          </div>

          <div className="ledger-panel flex flex-col gap-3 p-6">
            <FileText aria-hidden className="size-8 text-ledger-text" />
            <p className="font-display text-lg font-bold text-ledger-text">Pedido (remessa kit)</p>
            <p className="flex-1 text-sm text-ledger-muted">
              Romaneio com código, descrição, preço sugerido e quantidade de cada peça.
            </p>
            <button
              type="button"
              className="admin-btn admin-btn-primary justify-center"
              disabled={!doc.data || composicao.length === 0}
              onClick={() =>
                doc.data && abrirImpressao("Pedido — Remessa Kit", htmlPedido(doc.data, composicao, codigoMaleta, dataAcerto, operador))
              }
            >
              <Printer aria-hidden className="size-4" /> Imprimir pedido
            </button>
          </div>

          <div className="ledger-panel flex flex-col gap-3 border-dashed p-6 opacity-80">
            <FileText aria-hidden className="size-8 text-ledger-muted" />
            <p className="font-display text-lg font-bold text-ledger-text">Nota fiscal consignada</p>
            <p className="flex-1 text-sm text-ledger-muted">
              Em implantação. Este é o lugar reservado para gerar a NF-e de remessa consignada desta
              maleta, já ligada a este ciclo.
            </p>
            <button type="button" className="admin-btn justify-center" disabled>
              Em breve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

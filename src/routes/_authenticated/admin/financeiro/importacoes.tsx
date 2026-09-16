import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownToLine, FileSpreadsheet } from "lucide-react";
import { Panel } from "@/components/admin/ui";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import {
  ImportWizardCadastros,
  type DestinoImportacao,
} from "@/components/admin/ImportWizardCadastros";
import { useCapabilities } from "@/lib/capabilities";

export const Route = createFileRoute("/_authenticated/admin/financeiro/importacoes")({
  component: Importacoes,
});

const COLUNAS_MODELO = [
  "documento",
  "descricao",
  "contraparte",
  "documento_contraparte",
  "emissao",
  "competencia",
  "vencimento",
  "valor",
  "id_externo",
  "observacao",
] as const;

const DESCRICAO_COLUNAS: Record<string, string> = {
  documento: "Número da nota, contrato ou referência (texto, zeros à esquerda preservados)",
  descricao: "Descrição do título",
  contraparte: "Nome da pessoa ou empresa já cadastrada",
  documento_contraparte: "CPF ou CNPJ da contraparte (opcional, mas é o vínculo mais seguro)",
  emissao: "Data de emissão, no formato dd/mm/aaaa",
  competencia: "Mês de competência, no formato dd/mm/aaaa",
  vencimento: "Data de vencimento, no formato dd/mm/aaaa",
  valor: "Valor em reais, ex.: 1.234,56",
  id_externo: "Identificador do sistema de origem — é o que impede duplicar no reenvio",
  observacao: "Texto livre",
};

function baixarModelo(nome: string) {
  const conteudo = `${COLUNAS_MODELO.join(";")}\n`;
  const url = URL.createObjectURL(new Blob([`\ufeff${conteudo}`], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function Importacoes() {
  const caps = useCapabilities();
  const [destino, setDestino] = React.useState<DestinoImportacao | null>(null);

  const cartoes: { destino: DestinoImportacao; permitido: boolean; modelo: string }[] = [
    {
      destino: {
        tipo: "titulos",
        direcao: "payable",
        titulo: "Contas a pagar",
        descricao:
          "Cada linha vira um título a pagar pelo mesmo motor do lançamento manual. Nenhum pagamento é registrado e nenhum saldo bancário é alterado.",
      },
      permitido: caps.includes("finance.payable.manage"),
      modelo: "modelo-contas-a-pagar.csv",
    },
    {
      destino: {
        tipo: "titulos",
        direcao: "receivable",
        titulo: "Contas a receber",
        descricao:
          "Cada linha vira um título a receber pelo mesmo motor do lançamento manual. Nenhum recebimento é registrado e nenhum saldo bancário é alterado.",
      },
      permitido: caps.includes("finance.receivable.manage"),
      modelo: "modelo-contas-a-receber.csv",
    },
  ];

  return (
    <AreaFinanceiraGuard capacidade="finance.view">
      <div className="space-y-6">
        <Panel title="Importar títulos">
          <p className="text-sm font-medium text-ledger-muted">
            O caminho é sempre o mesmo: escolher o arquivo (CSV ou XLSX) → conferir o de-para das
            colunas → simular, vendo linha a linha o que entra, o que já existe e o que é recusado →
            só então gravar. Reenviar o mesmo arquivo não cria títulos repetidos.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {cartoes.map((c) => (
              <div key={c.modelo} className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
                <p className="font-display text-base font-bold text-ledger-text">
                  {c.destino.titulo}
                </p>
                <p className="mt-1 text-xs font-medium text-ledger-muted">
                  {c.destino.descricao}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="admin-btn-primary"
                    disabled={!c.permitido}
                    onClick={() => setDestino(c.destino)}
                  >
                    <FileSpreadsheet aria-hidden className="size-4" /> Importar
                  </button>
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={() => baixarModelo(c.modelo)}
                  >
                    <ArrowDownToLine aria-hidden className="size-4" /> Baixar modelo
                  </button>
                </div>
                {!c.permitido ? (
                  <p className="mt-2 text-xs font-medium text-ledger-muted">
                    Seu perfil não pode gravar títulos deste tipo.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Colunas do modelo">
          <ul className="space-y-1.5 text-sm">
            {COLUNAS_MODELO.map((c) => (
              <li key={c}>
                <span className="font-semibold text-ledger-text">{c}</span>
                <span className="text-ledger-muted"> — {DESCRICAO_COLUNAS[c]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs font-medium text-ledger-muted">
            Datas em dd/mm/aaaa; valores em reais com vírgula decimal. Linhas sem valor, sem
            vencimento ou com contraparte desconhecida não são adivinhadas: ficam separadas como
            recusa ou aguardando decisão, com o motivo à vista.
          </p>
        </Panel>

        <ImportWizardCadastros destino={destino} onOpenChange={(v) => !v && setDestino(null)} />
      </div>
    </AreaFinanceiraGuard>
  );
}

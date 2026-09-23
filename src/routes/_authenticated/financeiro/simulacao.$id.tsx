import { createFileRoute } from "@tanstack/react-router";
import { AVISO_SIMULACAO } from "@/lib/asaas-painel";

export const Route = createFileRoute("/_authenticated/financeiro/simulacao/$id")({
  component: Demonstracao,
  head: () => ({
    meta: [
      { title: "Demonstração de cobrança — LARDAN" },
      { name: "description", content: "Página local de demonstração de link de cobrança. Não é uma cobrança pagável." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function Demonstracao() {
  const { id } = Route.useParams();
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="rounded-lg border border-warning px-4 py-3 text-sm font-semibold text-warning">{AVISO_SIMULACAO}</p>
      <h1 className="mt-6 text-3xl font-semibold text-ledger-text">Demonstração de fatura</h1>
      <p className="mt-3 text-sm text-ledger-muted">
        Esta página existe apenas dentro da LARDAN, para demonstrar o percurso de um link de cobrança
        enquanto o provedor não está conectado. Nenhum pagamento é aceito, nenhum dado de cartão é
        coletado e nada é enviado ao cliente.
      </p>
      <dl className="mt-6 space-y-2 text-sm">
        <div className="flex justify-between gap-4 border-b border-line-soft pb-2">
          <dt className="text-ledger-muted">Identificador simulado</dt>
          <dd className="font-medium break-all">{id}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ledger-muted">Situação</dt>
          <dd className="font-medium">Somente demonstração</dd>
        </div>
      </dl>
    </main>
  );
}

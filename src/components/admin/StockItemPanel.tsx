import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StockThumb } from "@/components/admin/StockThumb";
import { formatBRLFromCents, formatDateTime, formatInt } from "@/components/admin/ui";
import {
  MOVE_LABEL,
  RESERVATION_LABEL,
  fetchStockItem,
  signedMediaMap,
} from "@/lib/stock";

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2">
      <span className="text-[0.72rem] font-semibold tracking-[0.1em] text-ledger-muted uppercase">
        {rotulo}
      </span>
      <span className="text-right text-sm font-medium text-ledger-text">{valor ?? "—"}</span>
    </div>
  );
}

/** Ficha do item de estoque: foto, identificação, saldo por local e histórico recente. */
export function StockItemPanel({
  variantId,
  onClose,
}: {
  variantId: string | null;
  onClose: () => void;
}) {
  const item = useQuery({
    queryKey: ["stock", "item", variantId],
    queryFn: () => fetchStockItem(variantId as string),
    enabled: Boolean(variantId),
  });

  const caminhos = (item.data?.midias ?? []).map((m) => m.path);
  const fotos = useQuery({
    queryKey: ["stock", "item-fotos", caminhos.join(",")],
    queryFn: () => signedMediaMap(caminhos),
    enabled: caminhos.filter(Boolean).length > 0,
  });

  const d = item.data;
  const principal = d?.midias?.[0]?.path;

  return (
    <Sheet open={Boolean(variantId)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="admin-scope w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-xl">{d?.produto ?? "Item de estoque"}</SheetTitle>
          <SheetDescription>
            {d ? `${d.variante}${d.sku ? ` · ${d.sku}` : ""}` : "Carregando…"}
          </SheetDescription>
        </SheetHeader>

        {item.error ? (
          <p className="mt-6 text-sm font-medium text-ledger-muted">
            Não foi possível abrir esta peça.
          </p>
        ) : !d ? (
          <p className="mt-6 text-sm font-medium text-ledger-muted">Carregando…</p>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap gap-3">
              <StockThumb
                url={principal ? fotos.data?.[principal] : null}
                alt={d.produto}
                size="lg"
              />
              {(d.midias ?? []).slice(1).map((m) => (
                <StockThumb
                  key={m.id}
                  url={m.path ? fotos.data?.[m.path] : null}
                  alt={m.alt ?? d.produto}
                  size="lg"
                />
              ))}
            </div>

            <div>
              <Linha rotulo="Produto" valor={d.produto} />
              <Linha rotulo="Variação" valor={d.variante} />
              <Linha rotulo="SKU" valor={d.sku ?? "—"} />
              <Linha rotulo="Código de barras" valor={d.barcode ?? "—"} />
              <Linha rotulo="Código legado" valor={d.legacy_code ?? "—"} />
              <Linha rotulo="Categoria" valor={d.categoria ?? "—"} />
              <Linha rotulo="Coleção" valor={d.colecao ?? "—"} />
              {d.pode_ver_custo && (
                <Linha
                  rotulo="Custo atual"
                  valor={d.custo_cents == null ? "—" : formatBRLFromCents(d.custo_cents)}
                />
              )}
            </div>

            <div>
              <p className="ledger-eyebrow mb-2">Saldo por local</p>
              {(d.saldos ?? []).length === 0 ? (
                <p className="text-sm font-medium text-ledger-muted">Sem saldo registrado.</p>
              ) : (
                <div className="overflow-hidden rounded-[10px] border border-line">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-muted text-[0.7rem] tracking-[0.1em] text-ledger-muted uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left">Local</th>
                        <th className="px-3 py-2 text-right">Físico</th>
                        <th className="px-3 py-2 text-right">Reservado</th>
                        <th className="px-3 py-2 text-right">Disponível</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.saldos.map((s) => (
                        <tr key={s.local_id} className="border-t border-line">
                          <td className="px-3 py-2">{s.local}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatInt(s.quantity)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-ledger-muted">
                            {formatInt(s.reserved)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {formatInt(s.available ?? s.quantity - s.reserved)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {d.pode_ver_reserva !== false && (
              <div>
                <p className="ledger-eyebrow mb-2">Reservas</p>
                <p className="text-sm font-medium text-ledger-muted">
                  {formatInt(d.reservas_ativas_qtd ?? 0)} unidades comprometidas por reservas
                  ativas.
                  {d.proxima_a_vencer
                    ? ` Próxima a vencer: ${d.proxima_a_vencer.protocolo} em ${formatDateTime(
                        d.proxima_a_vencer.validade,
                      )}.`
                    : ""}
                </p>
                {(d.reservas ?? []).length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {(d.reservas ?? []).slice(0, 6).map((r) => (
                      <li
                        key={r.id}
                        className="rounded-[10px] border border-line px-4 py-2.5 text-sm"
                      >
                        <p className="font-semibold text-ledger-text">
                          {r.protocolo} · {formatInt(r.quantidade)} un ·{" "}
                          {RESERVATION_LABEL[r.situacao] ?? r.situacao}
                        </p>
                        <p className="text-xs text-ledger-muted">
                          {r.local ?? "—"} · vence {formatDateTime(r.validade)}
                          {r.pessoa ? ` · ${r.pessoa}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div>
              <p className="ledger-eyebrow mb-2">Última movimentação</p>
              {d.ultima_movimentacao ? (
                <div className="rounded-[10px] border border-line px-4 py-3 text-sm">
                  <p className="font-semibold text-ledger-text">
                    {MOVE_LABEL[d.ultima_movimentacao.kind]} · {d.ultima_movimentacao.quantity}
                  </p>
                  <p className="text-xs text-ledger-muted">
                    {formatDateTime(d.ultima_movimentacao.created_at)}
                    {d.ultima_movimentacao.autor ? ` · ${d.ultima_movimentacao.autor}` : ""}
                  </p>
                  <p className="text-xs text-ledger-muted">
                    {d.ultima_movimentacao.origem ?? "—"} → {d.ultima_movimentacao.destino ?? "—"}
                  </p>
                </div>
              ) : (
                <p className="text-sm font-medium text-ledger-muted">Sem movimentações.</p>
              )}
            </div>

            <Link
              to="/admin/cadastros/produtos/$id"
              params={{ id: d.produto_id }}
              className="admin-btn inline-flex"
              onClick={onClose}
            >
              Abrir ficha do produto
            </Link>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

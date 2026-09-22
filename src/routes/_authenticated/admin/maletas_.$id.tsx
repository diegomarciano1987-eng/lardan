import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Printer, Send, Truck } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Skeleton,
  StatusBadge,
  formatDateTime,
} from "@/components/admin/ui";
import { VariantPicker, type VariantOption } from "@/components/admin/VariantPicker";
import { Movimentacoes } from "@/components/admin/maletas/Movimentacoes";
import { useCapabilities } from "@/lib/capabilities";
import {
  SITUACAO_MALETA,
  aceitar,
  brl,
  chaveIdempotencia,
  conferir,
  confirmarEntrega,
  definirItem,
  detalheMaleta,
  encaminhar,
  expedir,
  imagem,
  publicarPeca,
  traduzir,
} from "@/lib/maletas";

export const Route = createFileRoute("/_authenticated/admin/maletas_/$id")({
  component: MaletaFicha,
  head: () => ({
    meta: [
      { title: "Maleta — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const TOM = { neutro: "neutral", aviso: "warning", ok: "success", erro: "danger" } as const;

function QrMaleta({ token }: { token: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const alvo = `${typeof window === "undefined" ? "" : window.location.origin}/admin/maletas?qr=${token}`;
  React.useEffect(() => {
    void QRCode.toDataURL(alvo, { margin: 1, width: 320 }).then(setUrl).catch(() => setUrl(null));
  }, [alvo]);
  if (!url) return <div className="size-40 rounded-lg bg-surface-muted" aria-hidden />;
  return <img src={url} alt="QR Code da maleta" className="size-40 rounded-lg bg-white p-2" />;
}

function MaletaFicha() {
  const { id } = Route.useParams();
  const caps = useCapabilities();
  const podeMontar = caps.includes("kit.manage");
  const qc = useQueryClient();

  const ficha = useQuery({ queryKey: ["maletas", "detalhe", id], queryFn: () => detalheMaleta(id) });
  const recarregar = () => qc.invalidateQueries({ queryKey: ["maletas"] });

  const [peca, setPeca] = React.useState<VariantOption | null>(null);
  const [qtd, setQtd] = React.useState(1);
  const [rota, setRota] = React.useState<"direta" | "representante">("direta");
  const [transporte, setTransporte] = React.useState("");
  const [rastreio, setRastreio] = React.useState("");
  const [divergencias, setDivergencias] = React.useState<Record<string, number>>({});
  const [chave] = React.useState(chaveIdempotencia);

  const add = useMutation({
    mutationFn: () => definirItem(id, peca!.id, qtd),
    onSuccess: () => {
      toast.success("Peça na maleta.");
      setPeca(null);
      setQtd(1);
      recarregar();
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const remover = useMutation({
    mutationFn: (variantId: string) => definirItem(id, variantId, 0),
    onSuccess: () => recarregar(),
    onError: (e) => toast.error(traduzir(e)),
  });
  const conferirM = useMutation({
    mutationFn: () => conferir(id),
    onSuccess: (r) => {
      toast.success(r.repetida ? "Esta maleta já estava conferida." : "Conferida e estoque reservado.");
      recarregar();
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const expedirM = useMutation({
    mutationFn: () => expedir(id, { rota, carrier: transporte, tracking_code: rastreio }),
    onSuccess: () => {
      toast.success("Maleta expedida.");
      recarregar();
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const confirmarM = useMutation({
    mutationFn: (v: { transfer: string; recusar?: boolean; motivo?: string }) =>
      confirmarEntrega(v.transfer, { recusar: v.recusar ?? false, motivo: v.motivo ?? "" }),
    onSuccess: (r) => {
      toast.success(r.repetida ? "Esta entrega já estava registrada." : "Entrega registrada.");
      recarregar();
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const encaminharM = useMutation({
    mutationFn: () => encaminhar(id, { carrier: transporte, tracking_code: rastreio }),
    onSuccess: (r) => {
      toast.success(r.repetida ? "Já existe entrega em andamento." : "Encaminhada à consultora.");
      recarregar();
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const aceitarM = useMutation({
    mutationFn: () => {
      const itens = (ficha.data?.composicao ?? []).map((c) => {
        const div = divergencias[c.variant_id] ?? 0;
        return {
          variant_id: c.variant_id,
          qty_accepted: Math.max(c.quantidade - div, 0),
          qty_divergent: div,
          motivo: div > 0 ? "Divergência registrada na conferência" : "",
        };
      });
      return aceitar(id, itens, chave);
    },
    onSuccess: (r) => {
      toast.success(r.repetida ? "Este aceite já havia sido registrado." : "Aceite registrado.");
      recarregar();
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const publicarM = useMutation({
    mutationFn: (v: { variant: string; publicar: boolean }) => publicarPeca(id, v.variant, v.publicar),
    onSuccess: () => recarregar(),
    onError: (e) => toast.error(traduzir(e)),
  });

  if (ficha.isLoading) return <Skeleton className="h-64" />;
  if (ficha.isError) return <ErrorState message={traduzir(ficha.error)} onRetry={() => void ficha.refetch()} />;
  const d = ficha.data!;
  const s = SITUACAO_MALETA[d.ciclo.status] ?? { rotulo: d.ciclo.status, tom: "neutro" as const };
  const montando = d.ciclo.status === "rascunho" || d.ciclo.status === "montagem";
  const emTransito = d.entregas.filter((t) => t.situacao === "transito");
  const nomes: Record<string, string> = {};
  for (const c of d.composicao) nomes[c.variant_id] = `${c.produto}${c.variante ? ` · ${c.variante}` : ""}`;
  for (const b of d.saldos) nomes[b.variant_id] ??= `${b.produto}${b.variante ? ` · ${b.variante}` : ""}`;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`Maleta ${d.maleta.codigo} · ciclo ${d.ciclo.cycle_no}`}
        title={d.consultora ?? "Sem consultora definida"}
        description={`${d.ciclo.quantity_total} peças · ${brl(Number(d.ciclo.reference_total_cents ?? 0))} em valor de referência`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone={TOM[s.tom]}>{s.rotulo}</StatusBadge>
            <button type="button" className="admin-btn" onClick={() => window.print()}>
              <Printer aria-hidden className="size-4" /> Romaneio
            </button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {podeMontar && montando && (
            <Panel title="Montagem">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-72 flex-1">
                  <VariantPicker value={peca} onChange={setPeca} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="admin-input w-24"
                  value={qtd}
                  onChange={(e) => setQtd(Math.max(1, Number(e.target.value)))}
                />
                <button
                  type="button"
                  className="admin-btn admin-btn-primary"
                  disabled={!peca || add.isPending}
                  onClick={() => add.mutate()}
                >
                  Adicionar
                </button>
              </div>
              <p className="mt-3 text-xs text-ledger-muted">
                Só entra o que existe no depósito. A quantidade é conferida contra o saldo disponível.
              </p>
            </Panel>
          )}

          <Panel title="Composição" flush>
            {d.composicao.length === 0 ? (
              <div className="px-6">
                <EmptyState title="Maleta vazia" description="Adicione peças pela busca acima." />
              </div>
            ) : (
              d.composicao.map((c) => (
                <div
                  key={c.variant_id}
                  className="flex items-center gap-4 border-b border-line-soft px-6 py-3 last:border-0"
                >
                  {imagem(c.media_id) ? (
                    <img src={imagem(c.media_id)!} alt="" className="size-12 rounded-lg object-cover" />
                  ) : (
                    <div className="size-12 rounded-lg bg-surface-muted" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ledger-text">{c.produto}</p>
                    <p className="text-xs text-ledger-muted">
                      {c.variante ?? "—"} {c.sku ? `· ${c.sku}` : ""}
                    </p>
                  </div>
                  <span className="tabular-nums text-sm">{c.quantidade} un</span>
                  <span className="tabular-nums text-sm font-semibold">{brl(c.valor_unitario * c.quantidade)}</span>
                  {podeMontar && montando && (
                    <button type="button" className="admin-btn" onClick={() => remover.mutate(c.variant_id)}>
                      Remover
                    </button>
                  )}
                </div>
              ))
            )}
          </Panel>

          {d.saldos.length > 0 && (
            <Panel title="Saldos da maleta" flush>
              {d.saldos.map((b) => (
                <div key={b.variant_id} className="flex flex-wrap items-center gap-4 border-b border-line-soft px-6 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ledger-text">{b.produto}</p>
                    <p className="text-xs text-ledger-muted">{b.variante ?? "—"}</p>
                  </div>
                  <span className="text-xs text-ledger-muted">aceitas {b.aceito}</span>
                  <span className="text-xs text-ledger-muted">divergentes {b.divergente}</span>
                  <span className="text-xs text-ledger-muted">reservadas {b.reservado}</span>
                  <span className="text-sm font-semibold tabular-nums">disponível {b.disponivel}</span>
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={() => publicarM.mutate({ variant: b.variant_id, publicar: !b.publicado })}
                  >
                    {b.publicado ? "Ocultar da vitrine" : "Mostrar na vitrine"}
                  </button>
                </div>
              ))}
            </Panel>
          )}

          <Movimentacoes
            cycleId={id}
            nomes={nomes}
            podeGerir={podeMontar}
            podeAcrescentar={podeMontar || caps.includes("kit.acrescimo")}
          />

          <Panel title="Linha do tempo" flush>
            {d.eventos.length === 0 ? (
              <div className="px-6">
                <EmptyState title="Sem eventos" description="O histórico aparece conforme a maleta avança." />
              </div>
            ) : (
              d.eventos.map((e, i) => (
                <div key={i} className="border-b border-line-soft px-6 py-3 text-sm last:border-0">
                  <p className="font-semibold text-ledger-text">{e.kind}</p>
                  <p className="text-xs text-ledger-muted">
                    {formatDateTime(e.quando)}
                    {e.de || e.para ? ` · ${e.de ?? "—"} → ${e.para ?? "—"}` : ""}
                    {e.motivo ? ` · ${e.motivo}` : ""}
                  </p>
                </div>
              ))
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Identificação">
            <div className="flex flex-col items-center gap-3">
              <QrMaleta token={d.maleta.qr_token} />
              <p className="text-center text-xs text-ledger-muted">
                O código abre a maleta dentro do sistema, para quem tem permissão. Não expõe composição,
                pessoas nem valores a quem não está autenticado.
              </p>
            </div>
          </Panel>

          {podeMontar && (
            <Panel title="Operação">
              <div className="space-y-3">
                <button
                  type="button"
                  className="admin-btn admin-btn-primary w-full"
                  disabled={!montando || conferirM.isPending}
                  onClick={() => conferirM.mutate()}
                >
                  <CheckCircle2 aria-hidden className="size-4" /> Conferir e reservar estoque
                </button>

                <div className="grid gap-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`admin-btn flex-1 ${rota === "direta" ? "admin-btn-primary" : ""}`}
                      onClick={() => setRota("direta")}
                    >
                      Entrega direta
                    </button>
                    <button
                      type="button"
                      className={`admin-btn flex-1 ${rota === "representante" ? "admin-btn-primary" : ""}`}
                      onClick={() => setRota("representante")}
                    >
                      Via representante
                    </button>
                  </div>
                  <input
                    className="admin-input"
                    placeholder="Transportadora (opcional)"
                    value={transporte}
                    onChange={(e) => setTransporte(e.target.value)}
                  />
                  <input
                    className="admin-input"
                    placeholder="Código de rastreio (opcional)"
                    value={rastreio}
                    onChange={(e) => setRastreio(e.target.value)}
                  />
                  <button
                    type="button"
                    className="admin-btn w-full"
                    disabled={d.ciclo.status !== "conferida" || expedirM.isPending}
                    onClick={() => expedirM.mutate()}
                  >
                    <Send aria-hidden className="size-4" /> Expedir
                  </button>
                </div>
              </div>
            </Panel>
          )}

          <Panel title="Entregas" flush>
            {d.entregas.length === 0 ? (
              <div className="px-6">
                <EmptyState title="Nenhuma entrega" description="A cadeia de custódia começa na expedição." />
              </div>
            ) : (
              d.entregas.map((t) => (
                <div key={t.id} className="space-y-2 border-b border-line-soft px-6 py-4 last:border-0">
                  <p className="text-sm font-semibold text-ledger-text">
                    #{t.seq} · {t.de ?? "Matriz"} → {t.para ?? "—"}
                  </p>
                  <p className="text-xs text-ledger-muted">
                    {t.situacao}
                    {t.rastreio ? ` · ${t.rastreio}` : ""}
                    {t.entregue_em ? ` · entregue ${formatDateTime(t.entregue_em)}` : ""}
                    {t.motivo ? ` · ${t.motivo}` : ""}
                  </p>
                  {t.situacao === "transito" && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="admin-btn"
                        onClick={() => confirmarM.mutate({ transfer: t.id })}
                      >
                        <Truck aria-hidden className="size-4" /> Confirmar entrega
                      </button>
                      <button
                        type="button"
                        className="admin-btn"
                        onClick={() =>
                          confirmarM.mutate({ transfer: t.id, recusar: true, motivo: "Recusada na conferência" })
                        }
                      >
                        Recusar
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
            {emTransito.length === 0 && d.ciclo.status === "transito" && podeMontar && (
              <div className="px-6 py-4">
                <button type="button" className="admin-btn" onClick={() => encaminharM.mutate()}>
                  Encaminhar à consultora
                </button>
              </div>
            )}
            {d.custodia && d.ciclo.status === "transito" && d.ciclo.custodian_party_id !== d.ciclo.consultora_party_id && (
              <div className="px-6 py-4">
                <button type="button" className="admin-btn" onClick={() => encaminharM.mutate()}>
                  Encaminhar à consultora
                </button>
              </div>
            )}
          </Panel>

          {podeMontar && (d.ciclo.status === "transito" || d.ciclo.status === "recebida") && (
            <Panel title="Aceite assistido">
              <p className="text-xs text-ledger-muted">
                Informe quantas unidades de cada peça estão divergentes. O restante é aceito.
              </p>
              <div className="mt-3 space-y-2">
                {d.composicao.map((c) => (
                  <div key={c.variant_id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm">{c.produto}</span>
                    <input
                      type="number"
                      min={0}
                      max={c.quantidade}
                      className="admin-input w-20"
                      value={divergencias[c.variant_id] ?? 0}
                      onChange={(e) =>
                        setDivergencias((v) => ({ ...v, [c.variant_id]: Math.max(0, Number(e.target.value)) }))
                      }
                    />
                    <span className="text-xs text-ledger-muted">de {c.quantidade}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="admin-btn admin-btn-primary mt-4 w-full"
                disabled={aceitarM.isPending}
                onClick={() => aceitarM.mutate()}
              >
                Registrar aceite
              </button>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

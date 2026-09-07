import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronsUpDown, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { VariantPicker, type VariantOption } from "@/components/admin/VariantPicker";
import { StockThumb } from "@/components/admin/StockThumb";
import { formatInt } from "@/components/admin/ui";
import {
  createReservation,
  fetchStockItem,
  listStockLocations,
  searchParties,
  signedMediaMap,
} from "@/lib/stock";

const ORIGENS = [
  { value: "manual", label: "Reserva manual", hint: "atendimento direto" },
  { value: "maleta", label: "Maleta", hint: "separação para consultora" },
  { value: "venda", label: "Venda em negociação", hint: "pedido aguardando pagamento" },
  { value: "evento", label: "Evento", hint: "feira, showroom, prova" },
];

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Busca de pessoa no servidor, opcional: cliente, consultora ou parceiro. */
function PartyPicker({
  value,
  onChange,
}: {
  value: { id: string; nome: string } | null;
  onChange: (v: { id: string; nome: string } | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [termo, setTermo] = React.useState("");
  const [rows, setRows] = React.useState<{ id: string; display_name: string }[]>([]);
  const [carregando, setCarregando] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setCarregando(true);
    const t = setTimeout(async () => {
      try {
        const data = await searchParties(termo, 20);
        if (!cancelado) setRows(data);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }, 260);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [termo, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-11 w-full items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3 text-left text-sm font-medium text-ledger-text shadow-sm hover:border-champagne"
        >
          <span className={value ? "truncate" : "truncate font-normal text-ledger-muted"}>
            {value ? value.nome : "Sem vínculo (opcional)"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] overflow-hidden rounded-[12px] p-0"
      >
        <div className="flex items-center gap-2 border-b border-border/70 px-3">
          <Search className="size-4 shrink-0 opacity-50" />
          <input
            autoFocus
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar pessoa pelo nome…"
            className="h-10 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
            >
              Remover vínculo
            </button>
          )}
          {carregando && <p className="px-3 py-3 text-sm text-muted-foreground">Buscando…</p>}
          {!carregando && rows.length === 0 && (
            <p className="px-3 py-3 text-sm text-muted-foreground">Nenhuma pessoa encontrada.</p>
          )}
          {rows.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange({ id: p.id, nome: p.display_name });
                setOpen(false);
              }}
              className="w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
            >
              {p.display_name}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Nova reserva: o disponível vem do servidor e é revalidado ao gravar. */
export function ReservationDialog({
  open,
  onOpenChange,
  variantId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  variantId?: string | null;
}) {
  const qc = useQueryClient();
  const [variant, setVariant] = React.useState<VariantOption | null>(null);
  const [local, setLocal] = React.useState("");
  const [quantidade, setQuantidade] = React.useState("");
  const [validade, setValidade] = React.useState<Date | undefined>(undefined);
  const [origem, setOrigem] = React.useState("manual");
  const [referencia, setReferencia] = React.useState("");
  const [pessoa, setPessoa] = React.useState<{ id: string; nome: string } | null>(null);
  const [nota, setNota] = React.useState("");
  const [confirmar, setConfirmar] = React.useState(false);

  const chave = React.useRef(crypto.randomUUID());
  React.useEffect(() => {
    if (!open) return;
    chave.current = crypto.randomUUID();
    setConfirmar(false);
  }, [open]);

  const locais = useQuery({ queryKey: ["stock-locations"], queryFn: listStockLocations });

  const alvo = variant?.id ?? variantId ?? null;
  const item = useQuery({
    queryKey: ["stock", "item", alvo],
    queryFn: () => fetchStockItem(alvo as string),
    enabled: Boolean(alvo) && open,
  });

  React.useEffect(() => {
    if (!open || variant || !variantId || !item.data) return;
    setVariant({
      id: item.data.variant_id,
      label: item.data.variante,
      sku: item.data.sku,
      produto: item.data.produto,
    });
  }, [open, variantId, item.data, variant]);

  const caminho = item.data?.midias?.[0]?.path ?? null;
  const foto = useQuery({
    queryKey: ["stock", "item-fotos", caminho],
    queryFn: () => signedMediaMap([caminho]),
    enabled: Boolean(caminho),
  });

  const saldoLocal = (item.data?.saldos ?? []).find((s) => s.local_id === local);
  const fisico = saldoLocal?.quantity ?? 0;
  const reservado = saldoLocal?.reserved ?? 0;
  const disponivel = saldoLocal?.available ?? 0;

  const opcoesLocais = (locais.data ?? []).map((l) => ({
    value: l.id,
    label: l.name,
    hint: l.code,
  }));

  function validar(): string | null {
    if (!variant) return "Escolha a peça.";
    if (!local) return "Escolha o local de estoque.";
    const qtd = Number(quantidade);
    if (!quantidade.trim() || Number.isNaN(qtd) || qtd <= 0)
      return "Informe uma quantidade maior que zero.";
    if (qtd > disponivel)
      return `Existem apenas ${formatInt(disponivel)} unidades disponíveis neste local.`;
    if (!validade) return "Informe a validade da reserva.";
    if (validade.getTime() <= Date.now()) return "A validade precisa ser no futuro.";
    return null;
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const erro = validar();
      if (erro) throw new Error(erro);
      const fim = new Date(validade as Date);
      fim.setHours(23, 59, 0, 0);
      return createReservation({
        variantId: (variant as VariantOption).id,
        locationId: local,
        quantity: Number(quantidade),
        expiresAt: fim.toISOString(),
        origin: origem,
        reference: referencia || null,
        partyId: pessoa?.id ?? null,
        note: nota || null,
        idempotencyKey: chave.current,
      });
    },
    onSuccess: (r) => {
      toast.success(`Reserva ${r.protocolo} criada.`);
      qc.invalidateQueries({ queryKey: ["stock"] });
      chave.current = crypto.randomUUID();
      setVariant(null);
      setQuantidade("");
      setValidade(undefined);
      setReferencia("");
      setPessoa(null);
      setNota("");
      setConfirmar(false);
      onOpenChange(false);
    },
    onError: (e) => {
      setConfirmar(false);
      toast.error(e instanceof Error ? e.message : "Não foi possível reservar.");
    },
  });

  const nomeLocal = opcoesLocais.find((l) => l.value === local)?.label ?? "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-scope max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Nova reserva</DialogTitle>
          <DialogDescription>
            A reserva compromete unidades disponíveis sem tirar peça do estoque físico. O
            disponível é conferido de novo no servidor ao gravar.
          </DialogDescription>
        </DialogHeader>

        {confirmar ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-ledger-muted">
              Confira antes de reservar.
            </p>
            <dl className="divide-y divide-line rounded-[10px] border border-line">
              {[
                ["Peça", `${variant?.produto ?? ""} · ${variant?.label ?? ""}`],
                ["Local", nomeLocal],
                ["Quantidade", quantidade],
                ["Disponível hoje", formatInt(disponivel)],
                ["Validade", validade ? validade.toLocaleDateString("pt-BR") : "—"],
                ["Origem", ORIGENS.find((o) => o.value === origem)?.label ?? origem],
                ...(referencia ? [["Referência", referencia]] : []),
                ...(pessoa ? [["Reservada para", pessoa.nome]] : []),
                ...(nota ? [["Observação", nota]] : []),
              ].map(([r, v]) => (
                <div key={r as string} className="flex justify-between gap-6 px-4 py-2.5 text-sm">
                  <dt className="font-semibold text-ledger-muted">{r}</dt>
                  <dd className="text-right font-medium text-ledger-text">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setConfirmar(false)} className="admin-btn">
                Voltar e corrigir
              </button>
              <button
                type="button"
                disabled={salvar.isPending}
                onClick={() => salvar.mutate()}
                className="admin-btn-primary"
              >
                {salvar.isPending ? "Reservando…" : "Confirmar reserva"}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const erro = validar();
              if (erro) {
                toast.error(erro);
                return;
              }
              setConfirmar(true);
            }}
          >
            <Campo label="Peça">
              <VariantPicker
                value={variant}
                onChange={(v) => {
                  setVariant(v);
                  setQuantidade("");
                }}
              />
            </Campo>

            {item.data && (
              <div className="flex items-center gap-4 rounded-[10px] border border-line bg-surface-muted px-4 py-3">
                <StockThumb
                  url={caminho ? foto.data?.[caminho] : null}
                  alt={item.data.produto}
                  size="lg"
                />
                <div className="min-w-0 text-sm">
                  <p className="truncate font-semibold text-ledger-text">{item.data.produto}</p>
                  <p className="truncate text-xs text-ledger-muted">
                    {item.data.variante}
                    {item.data.sku ? ` · ${item.data.sku}` : ""}
                  </p>
                  {local && (
                    <p className="mt-1 text-xs font-medium text-ledger-muted tabular-nums">
                      Físico {formatInt(fisico)} · Reservado {formatInt(reservado)} ·{" "}
                      <span className="text-ledger-text">Disponível {formatInt(disponivel)}</span>
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Local de estoque">
                <SmartSelect
                  options={opcoesLocais}
                  value={local}
                  onChange={setLocal}
                  placeholder="Selecionar local"
                />
              </Campo>
              <Campo label="Quantidade">
                <input
                  inputMode="numeric"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                  className={inputCls}
                />
              </Campo>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Validade da reserva">
                <DateField value={validade} onChange={setValidade} />
              </Campo>
              <Campo label="Origem">
                <SmartSelect options={ORIGENS} value={origem} onChange={setOrigem} />
              </Campo>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Referência (opcional)">
                <input
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="Pedido, atendimento, protocolo"
                  className={inputCls}
                />
              </Campo>
              <Campo label="Reservada para (opcional)">
                <PartyPicker value={pessoa} onChange={setPessoa} />
              </Campo>
            </div>

            <Campo label="Observação (opcional)">
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
              />
            </Campo>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => onOpenChange(false)} className="admin-btn">
                Cancelar
              </button>
              <button type="submit" className="admin-btn-primary">
                Revisar e reservar
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

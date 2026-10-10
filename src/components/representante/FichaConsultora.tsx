import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, MessageCircle, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { brl, dataBR, repFicha, repReativar } from "@/lib/representante";
import { CobrarParcela } from "@/components/representante/AcoesRepresentante";

/** Tela da consultora dentro da área do representante: cadastro, débitos e cobrança. */
export function FichaConsultora({ party, rep, onClose }: { party: string | null; rep: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rep", rep, "ficha", party], queryFn: () => repFicha(party!), enabled: !!party });
  const reativar = useMutation({
    mutationFn: () => repReativar(party!),
    onSuccess: () => { toast.success("Consultora reativada em todo o sistema."); void qc.invalidateQueries({ queryKey: ["rep"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const f = q.data;
  const whats = f?.contatos.find((c) => c.kind === "whatsapp")?.value ?? f?.contatos.find((c) => c.kind === "telefone")?.value ?? null;
  const e = f?.endereco;
  return (
    <Sheet open={!!party} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{f?.nome ?? "Consultora"}</SheetTitle>
          <SheetDescription>{f ? `${f.code} · ${f.doc_masked ?? "CPF não informado"} · ${f.status === "ativo" ? "ativa" : "inativa"}` : "Carregando…"}</SheetDescription>
        </SheetHeader>
        {q.error && <p className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{(q.error as Error).message}</p>}
        {f && (
          <div className="mt-5 space-y-5 px-1 pb-8">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase text-muted-foreground">Em aberto</p><p className="text-xl font-semibold tabular-nums">{brl(f.aberto_cents)}</p></div>
              <div className="rounded-2xl border border-border p-4"><p className="text-xs uppercase text-muted-foreground">Vencido</p><p className="text-xl font-semibold tabular-nums text-destructive">{brl(f.vencido_cents)}</p></div>
            </div>

            <CobrarParcela avulsa={{ party_id: f.id, display_name: f.nome }} rep={rep} whatsapp={whats} rotulo="Nova cobrança — digitar valor (Pix, cartão 3x, boleto, cheque)" />
            {f.status !== "ativo" && (
              <button type="button" disabled={reativar.isPending} onClick={() => reativar.mutate()} className="w-full rounded-xl border border-primary px-4 py-2.5 text-sm font-semibold text-primary">Reativar consultora</button>
            )}

            <section className="space-y-2 rounded-2xl border border-border p-4">
              <h3 className="text-sm font-semibold">Contato e endereço</h3>
              {f.contatos.length === 0 && <p className="text-sm text-muted-foreground">Sem dados de contato.</p>}
              {f.contatos.map((c, i) => (
                <p key={i} className="flex items-center gap-2 text-sm">
                  {c.kind === "whatsapp" ? <MessageCircle className="size-4" /> : <Phone className="size-4" />}
                  {c.kind === "whatsapp" ? <a className="underline" target="_blank" rel="noreferrer" href={`https://wa.me/55${c.value.replace(/\D/g, "").replace(/^55/, "")}`}>{c.value}</a> : c.value}
                </p>
              ))}
              {e ? (
                <p className="flex items-start gap-2 text-sm"><MapPin className="mt-0.5 size-4 shrink-0" />
                  {[e.rua && `${e.rua}${e.numero ? `, ${e.numero}` : ""}`, e.complemento, e.bairro, e.cidade && `${e.cidade}/${e.uf ?? ""}`, e.cep].filter(Boolean).join(" · ")}
                  {e.referencia ? ` (ref.: ${e.referencia})` : ""}</p>
              ) : <p className="text-sm text-muted-foreground">Sem endereço cadastrado.</p>}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Parcelas em aberto ({f.parcelas.length})</h3>
              {f.parcelas.length === 0 && <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Sem débitos em aberto.</p>}
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {f.parcelas.map((p) => (
                  <li key={p.installment_id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0"><p className="text-sm font-medium">Título {p.numero ?? "—"}</p><p className="text-xs text-muted-foreground">vence {dataBR(p.vencimento)}</p></div>
                    <div className="flex items-center gap-3"><span className="font-semibold tabular-nums">{brl(p.saldo_cents)}</span><CobrarParcela c={p} rep={rep} whatsapp={whats} /></div>
                  </li>
                ))}
              </ul>
            </section>

            {f.cheques.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Cheques</h3>
                <ul className="divide-y divide-border rounded-2xl border border-border text-sm">
                  {f.cheques.map((c, i) => (
                    <li key={i} className="flex justify-between px-4 py-2"><span>nº {c.numero} · bom para {dataBR(c.bom_para)} · {c.status.replace(/_/g, " ")}</span><span className="tabular-nums">{brl(c.valor_cents)}</span></li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

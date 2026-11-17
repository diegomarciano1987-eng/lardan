/**
 * 0334 (Diego 17/11, caso Paula/Marcelo): aberturas aguardando assinatura, lidas do servidor (não do aparelho).
 * Cada consultora nova da carteira com contrato ou promissória pendente aparece aqui com os mesmos botões de
 * sempre (reenviar, copiar link, SMS, verificar, papel). Concluídas recentes ficam no histórico.
 * O representante pode começar quantas aberturas quiser enquanto estas aguardam.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheckBig, FileSignature, History } from "lucide-react";
import { aberturasAssinatura, type AberturaAssinatura } from "@/lib/rep-assinaturas";
import { rotuloAbertura } from "@/lib/maletas-perdidas";
import { AssinaturaDigital } from "@/components/representante/AssinaturaDigital";

const sel = (ok: boolean, t: string) => (
  <span className={`rounded-full px-2 py-0.5 text-[0.72rem] font-semibold ${ok ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground"}`}>
    {t} {ok ? "assinado" : "pendente"}
  </span>
);
const dataBr = (s: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "");

export function AberturasAssinatura({ rep }: { rep: string }) {
  const q = useQuery({ queryKey: ["rep", rep, "aberturas-assinatura"], queryFn: () => aberturasAssinatura(rep), refetchInterval: 60_000 });
  const [aberta, setAberta] = React.useState<string | null>(null);
  const [historico, setHistorico] = React.useState(false);
  if (!q.data) return null;
  const { pendentes, concluidas } = q.data;
  if (!pendentes.length && !concluidas.length) return null;
  const Linha = ({ a }: { a: AberturaAssinatura }) => (
    <li className="rounded-2xl border border-border bg-card p-3">
      <button type="button" onClick={() => setAberta((v) => (v === a.party_id ? null : a.party_id))} aria-expanded={aberta === a.party_id}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{a.nome}</span>
          <span className="block text-xs text-muted-foreground">
            {(rotuloAbertura(a.abertura_numero, a.remessa) ?? `Maleta ${a.maleta}`)} · desde {dataBr(a.joined_at)}
          </span>
        </span>
        <span className="text-xs font-semibold text-primary">{aberta === a.party_id ? "Fechar" : "Abrir"}</span>
      </button>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sel(a.contrato === "assinado", "Contrato")}
        {sel(a.promissoria === "assinado" || a.promissoria_papel, a.promissoria_papel ? "Promissória (papel)" : "Promissória")}
      </div>
      {aberta === a.party_id && (
        <div className="mt-3">
          <AssinaturaDigital party={a.party_id} rep={rep} telefone={a.telefone} />
        </div>
      )}
    </li>
  );
  return (
    <section className="space-y-3" aria-label="Aberturas aguardando assinatura">
      {pendentes.length > 0 && (
        <>
          <div className="rounded-2xl border border-primary/40 bg-primary/5 p-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><FileSignature className="size-4" /> Aguardando assinatura ({pendentes.length})</h3>
            <p className="mt-1 text-xs text-muted-foreground">O link vai pelo WhatsApp dela (não por e-mail). Se não chegou, toque na consultora e use "Copiar link" ou "Mandar por SMS". Você pode fazer outras aberturas enquanto estas aguardam.</p>
          </div>
          <ul className="space-y-2">{pendentes.map((a) => <Linha key={a.party_id} a={a} />)}</ul>
        </>
      )}
      {concluidas.length > 0 && (
        <div>
          <button type="button" onClick={() => setHistorico((v) => !v)} aria-expanded={historico}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 text-left text-sm">
            <History className="size-4" /> <span className="flex-1">Aberturas concluídas ({concluidas.length})</span>
            <span className="text-xs text-muted-foreground">{historico ? "Fechar" : "Ver"}</span>
          </button>
          {historico && (
            <ul className="mt-2 space-y-1.5">
              {concluidas.map((a) => (
                <li key={a.party_id} className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
                  <CircleCheckBig className="size-4 shrink-0 text-emerald-600" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{a.nome} · {rotuloAbertura(a.abertura_numero, a.remessa) ?? `Maleta ${a.maleta}`}</span>
                  <span className="text-xs text-muted-foreground">{dataBr(a.ultima_assinatura)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

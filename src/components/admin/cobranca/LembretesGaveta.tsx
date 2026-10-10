import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BellRing, X } from "lucide-react";
import { lembretes, dataBR, hojeSP } from "@/lib/cobranca";

/** Aba colada à direita. Abre sozinha (uma vez por dia) quando há lembrete de hoje ou atrasado. */
export function LembretesGaveta() {
  const q = useQuery({ queryKey: ["cob", "lembretes"], queryFn: lembretes, refetchInterval: 120_000 });
  const [aberta, setAberta] = React.useState(false);
  const hoje = hojeSP();
  const itens = q.data ?? [];
  const urgentes = itens.filter((l) => l.vence_em <= hoje);
  React.useEffect(() => {
    const chave = `cob-lembretes-${hoje}`;
    if (urgentes.length > 0 && !sessionStorage.getItem(chave)) { sessionStorage.setItem(chave, "1"); setAberta(true); }
  }, [urgentes.length, hoje]);
  const grupos: [string, typeof itens][] = [
    ["Atrasados", itens.filter((l) => l.vence_em < hoje)],
    ["Hoje", itens.filter((l) => l.vence_em === hoje)],
    ["Amanhã", itens.filter((l) => l.vence_em > hoje)],
  ];
  return (
    <>
      {!aberta && (
        <button onClick={() => setAberta(true)} aria-label="Abrir lembretes"
          className="fixed right-0 top-1/3 z-40 flex flex-col items-center gap-2 rounded-l-xl border border-r-0 border-line bg-bronze px-2 py-4 text-primary-foreground shadow-lg">
          <BellRing className="size-4" />
          <span className="text-xs font-semibold [writing-mode:vertical-rl]">Lembretes</span>
          {urgentes.length > 0 && <span className="rounded-full bg-danger px-1.5 text-[0.625rem] font-bold">{urgentes.length}</span>}
        </button>
      )}
      {aberta && (
        <aside className="admin-scope fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-line bg-surface shadow-2xl" aria-label="Lembretes de cobrança">
          <header className="flex items-center justify-between border-b border-line bg-bronze px-5 py-4 text-primary-foreground">
            <div className="flex items-center gap-2"><BellRing className="size-4" /><h2 className="font-semibold">Lembretes</h2></div>
            <button onClick={() => setAberta(false)} aria-label="Fechar lembretes"><X className="size-5" /></button>
          </header>
          <div className="flex-1 space-y-5 overflow-auto p-5">
            {itens.length === 0 && <p className="text-sm text-ledger-muted">Sem lembretes para hoje e amanhã.</p>}
            {grupos.filter(([, l]) => l.length).map(([g, l]) => (
              <section key={g}>
                <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wider ${g === "Atrasados" ? "text-danger" : g === "Hoje" ? "text-success" : "text-ledger-muted"}`}>{g} · {l.length}</h3>
                <div className="space-y-2">
                  {l.map((x) => (
                    <Link key={x.id} to="/admin/cobranca/$id" params={{ id: x.party_id }} onClick={() => setAberta(false)}
                      className="block rounded-lg border border-line-soft bg-warm-ivory/60 p-3 text-sm hover:border-bronze">
                      <p className="font-semibold text-ledger-text">{x.nome}</p>
                      <p className="text-xs text-ledger-muted">{x.titulo} · {dataBR(x.vence_em)}</p>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </aside>
      )}
    </>
  );
}

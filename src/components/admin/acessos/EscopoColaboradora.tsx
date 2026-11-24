import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Globe2, MapPin, Search, Users } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { colabEscopoLer, colabEscopoSalvar } from "@/lib/colab-acesso.functions";

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface pl-9 pr-3 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25";

const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function Lista({ titulo, icone: Icone, itens, marcados, onToggle, desabilitado, vazio }: {
  titulo: string; icone: typeof Users; itens: { id: string; nome: string; extra?: string | null }[];
  marcados: Set<string>; onToggle: (id: string) => void; desabilitado: boolean; vazio: string;
}) {
  const [busca, setBusca] = useState("");
  const filtrados = useMemo(() => {
    const partes = semAcento(busca).split(/\s+/).filter(Boolean);
    return itens.filter((i) => partes.every((p) => semAcento(`${i.nome} ${i.extra ?? ""}`).includes(p)));
  }, [itens, busca]);
  return (
    <section className="space-y-3 rounded-[12px] border border-line p-4">
      <h3 className="flex items-center justify-between gap-2 text-sm font-semibold text-ledger-text">
        <span className="flex items-center gap-2"><Icone className="h-4 w-4" /> {titulo}</span>
        <span className="text-xs font-medium text-ledger-muted">{marcados.size} liberado(s)</span>
      </h3>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ledger-muted" />
        <input className={inputCls} placeholder="Buscar por nome ou código" value={busca} disabled={desabilitado}
          aria-label={`Buscar ${titulo.toLowerCase()}`} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-[10px] border border-line">
        {filtrados.length === 0 && <p className="px-4 py-3 text-sm text-ledger-muted">{busca ? "Nada encontrado." : vazio}</p>}
        {filtrados.map((i) => {
          const on = marcados.has(i.id);
          return (
            <button key={i.id} type="button" disabled={desabilitado} onClick={() => onToggle(i.id)} aria-pressed={on}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-muted disabled:opacity-50">
              <span className="font-medium text-ledger-text">{i.nome}{i.extra ? <span className="ml-2 text-xs text-ledger-muted">{i.extra}</span> : null}</span>
              <span className={`grid h-5 w-5 place-items-center rounded-md border ${on ? "border-primary bg-primary text-primary-foreground" : "border-line"}`}>
                {on && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** 0372: Master libera praças e representantes que cada colaboradora pode ver e montar. */
export function EscopoColaboradora({ partyId }: { partyId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["colab-escopo", partyId], queryFn: () => colabEscopoLer({ data: { party_id: partyId } }) });
  const [rede, setRede] = useState(false);
  const [reps, setReps] = useState<Set<string>>(new Set());
  const [pracas, setPracas] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setRede(q.data.rede_toda);
    setReps(new Set(q.data.representantes));
    setPracas(new Set(q.data.pracas));
  }, [q.data]);

  if (q.isLoading) return <p className="p-5 text-sm text-ledger-muted">Carregando…</p>;
  if (q.error) return <p className="p-5 text-sm text-ledger-muted">{(q.error as Error).message}</p>;
  const d = q.data!;
  if (!d.user_id)
    return <p className="p-5 text-sm text-ledger-muted">Crie primeiro o código e a senha na aba <strong>Acesso</strong>. Depois libere aqui as praças e representantes.</p>;

  const alterna = (set: Set<string>, fn: (s: Set<string>) => void) => (id: string) => {
    const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n);
  };

  async function salvar() {
    setBusy(true);
    try {
      await colabEscopoSalvar({ data: { user_id: d.user_id!, rede_toda: rede, representantes: [...reps], pracas: [...pracas] } });
      toast.success("Liberação salva. Vale no próximo carregamento da tela dela.");
      await qc.invalidateQueries({ queryKey: ["colab-escopo", partyId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const travado = rede || d.qualidade;
  return (
    <div className="space-y-5 p-5">
      <p className="text-sm text-ledger-muted">
        Escolha o que ela pode ver e montar. {d.representantePrincipal
          ? <>Ela já vê sempre a carteira de <strong>{d.representantePrincipal.nome}</strong> (vínculo do cadastro).</>
          : "Ela ainda não tem representante no cadastro."}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-line p-4">
        <div className="flex items-start gap-3">
          <Globe2 className="mt-0.5 h-5 w-5 text-ledger-text" />
          <div>
            <p className="text-sm font-semibold text-ledger-text">Liberar toda a rede</p>
            <p className="text-xs text-ledger-muted">Qualquer praça, qualquer representante e qualquer consultora.</p>
            {d.qualidade && <p className="mt-1 text-xs text-ledger-muted">Já vê toda a rede por ser gerente da Qualidade.</p>}
          </div>
        </div>
        <Switch checked={rede || d.qualidade} disabled={d.qualidade} onCheckedChange={setRede} aria-label="Liberar toda a rede" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Lista titulo="Representantes" icone={Users} itens={d.opcoesReps} marcados={reps} onToggle={alterna(reps, setReps)}
          desabilitado={travado} vazio="Nenhum representante ativo." />
        <Lista titulo="Praças" icone={MapPin} itens={d.opcoesPracas.map((p) => ({ id: p.id, nome: p.nome, extra: p.codigo }))}
          marcados={pracas} onToggle={alterna(pracas, setPracas)} desabilitado={travado} vazio="Nenhuma praça cadastrada." />
      </div>
      {travado && <p className="text-xs text-ledger-muted">Com toda a rede liberada, as listas acima não são necessárias.</p>}
      <button type="button" disabled={busy} onClick={salvar}
        className="h-11 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground disabled:opacity-60">
        Salvar liberação
      </button>
    </div>
  );
}

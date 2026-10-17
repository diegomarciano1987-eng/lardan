import { Cake, MessageCircle, Clock } from "lucide-react";
import { linkWhats, type Cliente } from "@/lib/consultora";

const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Lembretes automáticos de recompra: aniversariantes do mês e clientes sem contato há 30+ dias. */
export function LembretesClientes({ clientes, abrir }: { clientes: Cliente[]; abrir: (id: string) => void }) {
  const hoje = hojeSP();
  const mes = hoje.slice(5, 7);
  const ativas = clientes.filter((c) => !c.encerrada);
  const aniversario = ativas.filter((c) => c.aniversario?.slice(5, 7) === mes)
    .sort((a, b) => (a.aniversario!.slice(8, 10) < b.aniversario!.slice(8, 10) ? -1 : 1));
  const limite = new Date(new Date(hoje + "T12:00:00").getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const sumidas = ativas.filter((c) => c.etapa === "cliente" && (c.ultima_interacao ?? c.created_at).slice(0, 10) < limite).slice(0, 8);
  if (!aniversario.length && !sumidas.length) return null;

  const Linha = ({ c, sub, texto }: { c: Cliente; sub: string; texto: string }) => {
    const w = linkWhats(c.telefone, texto);
    return (
      <li className="flex items-center gap-3 py-3">
        <button type="button" onClick={() => abrir(c.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[1.05rem] font-semibold">{c.nome}</span>
          <span className="block text-[0.95rem] text-muted-foreground">{sub}</span>
        </button>
        {w && <a href={w} target="_blank" rel="noreferrer" className="admin-btn min-h-12 shrink-0 text-base"><MessageCircle className="size-5" aria-hidden /> Mensagem</a>}
      </li>
    );
  };
  const nome = (c: Cliente) => c.nome.split(" ")[0];

  return (
    <section aria-label="Lembretes" className="mb-5 grid gap-3 lg:grid-cols-2">
      {aniversario.length > 0 && (
        <div className="rounded-2xl border border-border bg-card px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Cake className="size-5 text-primary" aria-hidden /> Aniversariantes do mês ({aniversario.length})</h2>
          <ul className="divide-y divide-border">
            {aniversario.map((c) => <Linha key={c.id} c={c} sub={`Dia ${c.aniversario!.slice(8, 10)}${c.aniversario!.slice(5, 10) === hoje.slice(5, 10) ? " · é hoje!" : ""}`}
              texto={`Oi, ${nome(c)}! Feliz aniversário! Separei algumas peças LARDAN que são a sua cara. Quer ver?`} />)}
          </ul>
        </div>
      )}
      {sumidas.length > 0 && (
        <div className="rounded-2xl border border-border bg-card px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Clock className="size-5 text-primary" aria-hidden /> Sem contato há mais de 30 dias</h2>
          <ul className="divide-y divide-border">
            {sumidas.map((c) => <Linha key={c.id} c={c} sub={c.preferencias ? `Gosta de: ${c.preferencias.slice(0, 60)}` : "Cliente que já comprou"}
              texto={`Oi, ${nome(c)}! Chegaram peças novas na minha maleta LARDAN e lembrei de você. Posso te mostrar?`} />)}
          </ul>
        </div>
      )}
    </section>
  );
}

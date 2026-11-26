/**
 * 0393 — Fila de atendimento e mapa de expansão das candidaturas.
 * Fila: abertas e ainda sem primeiro atendimento, na ordem verde (maior IPL) → amarelo → teste não respondido → vermelho.
 * Expansão: cidades com candidatas abertas sem representante (fila de espera que vira mapa de crescimento).
 * Só leitura: atender continua pelo cockpit da candidata.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/admin/ui";
import {
  carregarExpansao,
  carregarFila,
  linkWhatsapp,
  registrarCliqueWhatsapp,
  type Filtros,
  type TesteResumo,
} from "@/lib/crm/api";
import { cn } from "@/lib/utils";

const COR: Record<string, { rotulo: string; classe: string }> = {
  verde: { rotulo: "Verde", classe: "bg-success/15 text-success" },
  amarelo: { rotulo: "Amarelo", classe: "bg-warning/15 text-warning" },
  vermelho: { rotulo: "Vermelho", classe: "bg-danger/15 text-danger" },
};

function Semaforo({ t }: { t: TesteResumo }) {
  if (t.situacao !== "concluido" || !t.semaforo) {
    return (
      <span className="inline-flex rounded-full bg-surface-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-ledger-muted">
        {t.situacao === "pendente" ? "Teste não respondido" : "Sem teste"}
      </span>
    );
  }
  const c = COR[t.semaforo] ?? { rotulo: t.semaforo, classe: "bg-surface-muted text-ledger-muted" };
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold", c.classe)}>{c.rotulo}</span>
  );
}

function espera(horas: number) {
  if (horas < 1) return "agora";
  if (horas < 24) return `${horas} h`;
  const d = Math.floor(horas / 24);
  return `${d} dia${d > 1 ? "s" : ""}`;
}

export function FilaAtendimento({ filtros }: { filtros: Filtros }) {
  const fila = useQuery({ queryKey: ["crm", "fila", filtros], queryFn: () => carregarFila(filtros) });
  if (fila.isLoading) return <Skeleton className="h-[420px] w-full" />;
  if (fila.error) return <ErrorState message={(fila.error as Error).message} onRetry={() => void fila.refetch()} />;
  const { resumo, itens } = fila.data!;
  return (
    <Panel
      title={`Fila de atendimento · ${resumo.total} sem primeiro contato`}
      flush
    >
      <p className="border-b border-line px-5 py-3 text-xs text-ledger-muted">
        Atenda de cima para baixo: verdes de maior nota primeiro, depois amarelas, depois quem ainda não respondeu o teste.
        As vermelhas ficam por último, mas continuam na fila: o teste nunca é motivo de recusa sozinho.
      </p>
      <div className="flex flex-wrap gap-4 border-b border-line px-5 py-3 text-xs text-ledger-muted">
        <span><strong className="text-success">{resumo.verde}</strong> verdes</span>
        <span><strong className="text-warning">{resumo.amarelo}</strong> amarelas</span>
        <span><strong className="text-ledger-text">{resumo.sem_teste}</strong> sem teste</span>
        <span><strong className="text-danger">{resumo.vermelho}</strong> vermelhas</span>
        <span>· {resumo.com_representante} já com representante, {resumo.sem_representante} sem</span>
        {resumo.espera_media_horas != null && <span>· espera média {espera(resumo.espera_media_horas)}</span>}
      </div>
      {itens.length === 0 ? (
        <div className="px-5">
          <EmptyState title="Fila zerada." description="Todas as candidaturas abertas já tiveram o primeiro atendimento." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["#", "Candidata", "Cidade", "Teste", "IPL", "Representante", "Esperando", ""].map((h) => (
                  <th key={h} className="ledger-eyebrow whitespace-nowrap px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {itens.map((c) => (
                <tr key={c.id} className="hover:bg-warm-ivory/60">
                  <td className="px-4 py-3 text-xs text-ledger-muted num">{c.posicao}</td>
                  <td className="px-4 py-3">
                    <Link to="/admin/candidaturas/$id" params={{ id: c.id }} className="font-semibold text-ledger-text hover:text-bronze">
                      {c.nome}
                    </Link>
                    <span className="block text-[0.6875rem] text-ledger-muted num">{c.protocolo}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ledger-muted">{c.cidade}/{c.uf}</td>
                  <td className="px-4 py-3"><Semaforo t={c.teste} /></td>
                  <td className="px-4 py-3 text-xs num">{c.teste.ipl ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-ledger-muted">{c.representante ?? "Sem representante"}</td>
                  <td className={cn("px-4 py-3 text-xs", c.espera_horas >= 48 && "font-semibold text-danger")}>{espera(c.espera_horas)}</td>
                  <td className="px-4 py-3 text-right">
                    <a
                      href={linkWhatsapp(c.whatsapp)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => void registrarCliqueWhatsapp(c.id).catch(() => undefined)}
                      className="admin-btn inline-flex items-center gap-1.5"
                    >
                      <MessageCircle aria-hidden className="size-4" /> WhatsApp
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function MapaExpansao() {
  const q = useQuery({ queryKey: ["crm", "expansao"], queryFn: () => carregarExpansao(180) });
  if (q.isLoading) return <Skeleton className="h-[320px] w-full" />;
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const cidades = q.data ?? [];
  const total = cidades.reduce((a, c) => a + c.candidatas, 0);
  return (
    <Panel
      title={`Cidades sem representante · ${cidades.length} cidade(s), ${total} candidata(s)`}
      flush
    >
      <p className="border-b border-line px-5 py-3 text-xs text-ledger-muted">
        Candidatas abertas dos últimos 180 dias em cidades que ainda não têm um representante único. É a fila de espera e o
        mapa de onde abrir novas praças.
      </p>
      {cidades.length === 0 ? (
        <div className="px-5">
          <EmptyState title="Nenhuma cidade sem representante." description="Todas as candidatas abertas já caíram na carteira de um representante." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Cidade", "Candidatas", "Últimos 30 dias", "Verdes", "Situação", "Última candidatura"].map((h) => (
                  <th key={h} className="ledger-eyebrow whitespace-nowrap px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {cidades.map((c) => (
                <tr key={`${c.cidade}/${c.uf}/${c.praca ?? ""}`}>
                  <td className="px-4 py-3 font-semibold text-ledger-text">{c.cidade}/{c.uf}</td>
                  <td className="px-4 py-3 num">{c.candidatas}</td>
                  <td className="px-4 py-3 num">{c.ultimos_30_dias}</td>
                  <td className="px-4 py-3 num text-success">{c.verdes}</td>
                  <td className="px-4 py-3 text-xs text-ledger-muted">
                    {c.motivo === "cidade_fora_das_pracas" ? "Fora das praças atendidas" : `Praça ${c.praca ?? ""} sem representante único`}
                  </td>
                  <td className="px-4 py-3 text-xs text-ledger-muted">{new Date(c.ultima).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

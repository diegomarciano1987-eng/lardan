import { useQuery } from "@tanstack/react-query";
import { Panel, StatusBadge } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";

type Prontidao = {
  pronto: boolean;
  bloqueios: string[];
  configuracao: { emissao_ligada: boolean; provedor: string | null; ambiente: string };
  consultoras: Record<string, number>;
  pecas: { variantes_em_maletas_ativas: number; sem_ncm: number; ncm_invalido: number; sem_preco_referencia: number; ncms: { ncm: string; variantes: number }[] };
  volume: Record<string, number>;
  emissor: { definido: boolean; cnpj_ok: boolean; ie_ok: boolean; uf: string | null; endereco_ok: boolean; ibge_ok: boolean };
};

const CONSULTORAS: Record<string, string> = {
  total: "Total", com_maleta_ativa: "Com maleta ativa", prontas: "Cadastro fiscal completo",
  documento_invalido: "Documento inválido", cnpj: "Pessoa jurídica", sem_endereco: "Sem endereço",
  sem_rua: "Sem rua", sem_numero: "Sem número", sem_bairro: "Sem bairro", cep_invalido: "CEP inválido",
  sem_ibge: "Sem município IBGE", ibge_deduzivel: "Município IBGE identificável", fora_do_pr: "Fora do Paraná",
};
const VOLUME: Record<string, string> = {
  maletas_ativas: "Maletas ativas", maletas_expedidas_30d: "Expedidas em 30 dias",
  maletas_expedidas_90d: "Expedidas em 90 dias", maletas_encerradas_30d: "Encerradas em 30 dias",
};

function Contagens({ titulo, valores, rotulos }: { titulo: string; valores: Record<string, number>; rotulos: Record<string, string> }) {
  return <div className="min-w-0 space-y-3">
    <h3 className="font-semibold text-ledger-text">{titulo}</h3>
    <dl className="space-y-2 text-sm">{Object.entries(rotulos).map(([key, label]) => (
      <div key={key} className="flex items-start justify-between gap-4">
        <dt className="text-ledger-muted">{label}</dt>
        <dd className="shrink-0 font-semibold tabular-nums text-ledger-text">{valores[key]?.toLocaleString("pt-BR") ?? "Sem dados"}</dd>
      </div>
    ))}</dl>
  </div>;
}

export function FiscalProntidao() {
  const q = useQuery({
    queryKey: ["fiscal-prontidao"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fiscal_prontidao");
      if (error) throw new Error(error.message);
      return data as unknown as Prontidao;
    },
  });
  const r = q.data;
  return <Panel title="Nota fiscal — prontidão">
    {q.isPending ? <p className="text-sm text-ledger-muted">Carregando prontidão fiscal…</p>
      : q.error ? <p role="alert" className="text-sm text-danger">Não foi possível consultar a prontidão fiscal: {q.error.message}</p>
      : r ? <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={r.pronto ? "success" : "warning"}>{r.pronto ? "Pronto" : "Pendências para emissão"}</StatusBadge>
          <span className="text-sm text-ledger-muted">Emissão {r.configuracao.emissao_ligada ? "ligada" : "desligada"} · {r.configuracao.provedor ?? "Sem provedor"} · {r.configuracao.ambiente}</span>
        </div>
        {r.bloqueios.length > 0 && <div className="space-y-2">
          <h3 className="font-semibold text-ledger-text">Bloqueios</h3>
          <ul className="list-disc space-y-2 pl-5 text-sm text-ledger-muted">{r.bloqueios.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>}
        <div className="grid gap-6 border-t border-line-soft pt-5 lg:grid-cols-4">
          <Contagens titulo="Consultoras" valores={r.consultoras} rotulos={CONSULTORAS} />
          <div className="space-y-3">
            <Contagens titulo="Peças" valores={{ variantes: r.pecas.variantes_em_maletas_ativas, sem_ncm: r.pecas.sem_ncm, ncm_invalido: r.pecas.ncm_invalido, sem_preco: r.pecas.sem_preco_referencia }} rotulos={{ variantes: "Variantes em maletas ativas", sem_ncm: "Sem NCM", ncm_invalido: "NCM inválido", sem_preco: "Sem preço de referência" }} />
            {r.pecas.ncms.map((n) => <p key={n.ncm} className="text-xs text-ledger-muted">NCM {n.ncm}: {n.variantes} variantes</p>)}
          </div>
          <Contagens titulo="Volume" valores={r.volume} rotulos={VOLUME} />
          <div className="space-y-3">
            <h3 className="font-semibold text-ledger-text">Emissor</h3>
            <dl className="space-y-2 text-sm">{([
              ["Empresa definida", r.emissor.definido], ["CNPJ válido", r.emissor.cnpj_ok],
              ["Inscrição estadual", r.emissor.ie_ok], ["Endereço completo", r.emissor.endereco_ok],
              ["Município IBGE", r.emissor.ibge_ok],
            ] as const).map(([label, ok]) => <div key={label} className="flex justify-between gap-4"><dt className="text-ledger-muted">{label}</dt><dd className={ok ? "text-success" : "text-warning"}>{ok ? "Sim" : "Pendente"}</dd></div>)}
              <div className="flex justify-between gap-4"><dt className="text-ledger-muted">UF</dt><dd>{r.emissor.uf ?? "Sem dados"}</dd></div>
            </dl>
          </div>
        </div>
      </div> : <p className="text-sm text-ledger-muted">Sem dados.</p>}
  </Panel>;
}
/**
 * 0248 — Atendimento presencial (completar dados + perfil rápido) e devolução da candidata para a Lardan.
 * Grava só por rep_lead_atendimento / rep_lead_devolver (carteira do representante, auditado).
 */
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck, Undo2, X } from "lucide-react";
import { repLeadAtendimento, repLeadDevolver, type RepCrm } from "@/lib/representante";

type Card = RepCrm["cards"][number];

const PERGUNTAS = [
  { id: "metas", t: "Ela tem uma meta clara de quanto quer ganhar?" },
  { id: "comunicacao", t: "Ela conversa com facilidade e conhece muita gente?" },
  { id: "organizacao", t: "Ela parece organizada com dinheiro e compromissos?" },
  { id: "pontualidade", t: "Ela foi pontual e respondeu rápido até aqui?" },
];
const NOTAS = [{ v: 1, r: "Pouco" }, { v: 2, r: "Mais ou menos" }, { v: 3, r: "Muito" }];
export const MOTIVOS_DEVOLUCAO = ["Fora da minha rota de visita", "Não atende as mensagens", "Sem interesse no momento", "Outro"];

function Folha({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 md:items-center" role="dialog" aria-label={titulo}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-background p-5 md:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{titulo}</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid size-10 place-items-center rounded-full border border-border"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
const campo = "h-12 w-full rounded-xl border border-border bg-background px-3 text-base";

export function AtendimentoPresencial({ rep, card, onFeito }: { rep: string; card: Card; onFeito: () => void }) {
  const [aberto, setAberto] = React.useState(false);
  const [d, setD] = React.useState({ cpf: "", email: "", cep: "", rua: "", numero: "" });
  const [perfil, setPerfil] = React.useState<Record<string, number>>({});
  const salvar = useMutation({
    mutationFn: () => repLeadAtendimento(rep, card.lead_id, d, perfil),
    onSuccess: (r) => { toast.success(r.perfil ? `Atendimento salvo. ${r.perfil}.` : "Dados salvos."); setAberto(false); onFeito(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  const completo = Object.keys(perfil).length === PERGUNTAS.length;
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-medium">
        <ClipboardCheck className="size-4" /> Atendimento
      </button>
      {aberto && (
        <Folha titulo={`Atendimento · ${card.nome.split(" ")[0]}`} onFechar={() => setAberto(false)}>
          <p className="mb-3 text-sm text-muted-foreground">Preencha só o que estiver faltando. O que já existe não é apagado.</p>
          <div className="space-y-2">
            {!card.tem_cpf && <input className={campo} inputMode="numeric" placeholder="CPF" value={d.cpf} onChange={set("cpf")} />}
            <input className={campo} type="email" placeholder="E-mail (se tiver)" value={d.email} onChange={set("email")} />
            <input className={campo} inputMode="numeric" placeholder="CEP" value={d.cep} onChange={set("cep")} />
            <input className={campo} placeholder="Rua" value={d.rua} onChange={set("rua")} />
            <input className={campo} placeholder="Número" value={d.numero} onChange={set("numero")} />
          </div>
          <h4 className="mt-5 text-sm font-semibold">Perfil rápido</h4>
          <div className="mt-2 space-y-3">
            {PERGUNTAS.map((p) => (
              <div key={p.id}>
                <p className="text-sm">{p.t}</p>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {NOTAS.map((n) => (
                    <button key={n.v} type="button" onClick={() => setPerfil({ ...perfil, [p.id]: n.v })}
                      className={`h-11 rounded-xl border text-sm ${perfil[p.id] === n.v ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{n.r}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button type="button" disabled={salvar.isPending || (Object.keys(perfil).length > 0 && !completo)} onClick={() => salvar.mutate()}
            className="mt-5 h-12 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {Object.keys(perfil).length > 0 && !completo ? "Responda as 4 perguntas" : "Salvar atendimento"}
          </button>
        </Folha>
      )}
    </>
  );
}

export function DevolverLead({ rep, card, onFeito }: { rep: string; card: Card; onFeito: () => void }) {
  const [aberto, setAberto] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [obs, setObs] = React.useState("");
  const devolver = useMutation({
    mutationFn: () => repLeadDevolver(rep, card.lead_id, motivo, obs),
    onSuccess: () => { toast.success("Candidata devolvida para a Lardan."); setAberto(false); onFeito(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-border text-sm text-muted-foreground">
        <Undo2 className="size-4" /> Devolver
      </button>
      {aberto && (
        <Folha titulo="Devolver para a Lardan" onFechar={() => setAberto(false)}>
          <p className="mb-3 text-sm text-muted-foreground">{card.nome} sai da sua lista e volta para a equipe da Lardan.</p>
          <div className="space-y-2">
            {MOTIVOS_DEVOLUCAO.map((m) => (
              <button key={m} type="button" onClick={() => setMotivo(m)}
                className={`h-12 w-full rounded-xl border px-3 text-left text-sm ${motivo === m ? "border-primary bg-primary/10 font-semibold" : "border-border"}`}>{m}</button>
            ))}
            <input className={campo} placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
          <button type="button" disabled={!motivo || (motivo === "Outro" && !obs.trim()) || devolver.isPending} onClick={() => devolver.mutate()}
            className="mt-4 h-12 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">Confirmar devolução</button>
        </Folha>
      )}
    </>
  );
}

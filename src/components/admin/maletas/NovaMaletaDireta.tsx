import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { supabase } from "@/integrations/supabase/client";
import { traduzir } from "@/lib/maletas";
import {
  abrirMaletaDireta, consultorasMaletaDireta, isoDia, responsaveisMaletaDireta, rotuloConsultora,
  type ConsultoraDireta, type TipoEnvio,
} from "@/lib/remessas";

/**
 * 0352 (Diego, 19/11/2026): "Nova maleta" ao lado de "Nova remessa". Sai sem representante:
 * consultora, data de acerto (obrigatória) e responsável (colaborador da Lardan). A praça é a da consultora.
 */
async function buscarDepositos() {
  const { data, error } = await supabase.rpc("kit_depositos_operacao");
  if (error) throw error;
  return (data ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }));
}
async function buscarPracas() {
  const { data, error } = await supabase.rpc("pracas_resumo" as never);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; nome: string; ativo: boolean }[]).filter((p) => p.ativo).map((p) => ({ value: p.id, label: p.nome }));
}

export function NovaMaletaDireta({ aoCriar }: { aoCriar: (cycleId: string) => void }) {
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const [consultora, setConsultora] = React.useState("");
  const [escolhida, setEscolhida] = React.useState<ConsultoraDireta | null>(null);
  const [acerto, setAcerto] = React.useState<Date | undefined>();
  const [responsavel, setResponsavel] = React.useState("");
  const [deposito, setDeposito] = React.useState("");
  const [praca, setPraca] = React.useState("");
  const [envio, setEnvio] = React.useState<TipoEnvio>("pessoal");

  const achadas = useQuery({ queryKey: ["maleta-direta", "consultoras", busca], queryFn: () => consultorasMaletaDireta(busca), enabled: aberto });
  const resps = useQuery({ queryKey: ["maleta-direta", "responsaveis"], queryFn: responsaveisMaletaDireta, enabled: aberto, staleTime: 60_000 });
  const depositos = useQuery({ queryKey: ["remessas", "depositos"], queryFn: buscarDepositos, enabled: aberto });
  const semPraca = !!escolhida && !escolhida.praca_id;
  const pracas = useQuery({ queryKey: ["remessas", "pracas-ativas"], queryFn: buscarPracas, enabled: aberto && semPraca });
  React.useEffect(() => {
    const principal = depositos.data?.find((d) => d.label.startsWith("DEP-01")) ?? (depositos.data?.length === 1 ? depositos.data[0] : undefined);
    if (principal && !deposito) setDeposito(principal.value);
  }, [depositos.data, deposito]);

  const opcoes = React.useMemo(() => {
    const l = (achadas.data ?? []).map((p) => ({
      value: p.party_id,
      label: rotuloConsultora(p),
      hint: [p.cpf ? `CPF ${p.cpf}` : null, p.praca ? `Praça ${p.praca}` : "Sem praça"].filter(Boolean).join(" · "),
    }));
    if (escolhida && !l.some((o) => o.value === escolhida.party_id)) l.unshift({ value: escolhida.party_id, label: rotuloConsultora(escolhida), hint: escolhida.praca ? `Praça ${escolhida.praca}` : "Sem praça" });
    return l;
  }, [achadas.data, escolhida]);

  function escolher(id: string) {
    setConsultora(id);
    setEscolhida((achadas.data ?? []).find((p) => p.party_id === id) ?? (id === escolhida?.party_id ? escolhida : null));
    setPraca("");
  }

  const pronto = !!consultora && !!acerto && !!responsavel && (!semPraca || !!praca);
  const abrir = useMutation({
    mutationFn: () => {
      if (!consultora) throw new Error("Escolha a consultora.");
      if (!acerto) throw new Error("Informe a data de acerto: ela é obrigatória.");
      if (!responsavel) throw new Error("Escolha o responsável.");
      return abrirMaletaDireta({ consultora, data_acerto: isoDia(acerto)!, responsavel, deposito: deposito || null, praca: semPraca ? praca : null, tipo_envio: envio });
    },
    onSuccess: (r) => {
      toast.success(r.repetida ? "Essa maleta já tinha sido aberta agora há pouco." : `Maleta direta aberta (remessa nº ${r.remessa_numero}).`);
      setAberto(false);
      aoCriar(r.cycle_id);
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  if (!aberto) {
    return (
      <button type="button" className="admin-btn admin-btn-primary" onClick={() => setAberto(true)}
        title="Maleta direta para a consultora, sem representante: data de acerto e responsável.">
        <BriefcaseBusiness aria-hidden className="size-4" /> Nova maleta
      </button>
    );
  }

  return (
    <Panel title="Nova maleta direta" className="w-full">
      <p className="mb-4 text-sm text-ledger-muted">
        Sem representante. A maleta fica na praça da consultora (as vendas continuam na cidade dela) e sai com a data de acerto e o responsável escolhidos.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="grid gap-1.5 text-sm md:col-span-2">
          <span className="ledger-eyebrow">Consultora <span className="text-destructive">*</span></span>
          <SmartSelect value={consultora} onChange={escolher} onSearch={setBusca} options={opcoes} loading={achadas.isFetching}
            searchPlaceholder="Nome, código ou CPF (mín. 2 letras)" placeholder="Buscar consultora"
            footer={busca.trim().length < 2 ? "Digite ao menos 2 letras do nome, o código ou o CPF" : achadas.data?.length === 30 ? "Mostrando as 30 primeiras: refine a busca" : undefined} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Data de acerto <span className="text-destructive">*</span> (obrigatória)</span>
          <DateField value={acerto} onChange={setAcerto} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Responsável <span className="text-destructive">*</span></span>
          <SmartSelect value={responsavel} onChange={setResponsavel} loading={resps.isFetching}
            options={(resps.data ?? []).map((r) => ({ value: r.user_id, label: r.nome }))} placeholder="Colaborador da Lardan" searchPlaceholder="Buscar colaborador" />
        </label>
        {semPraca ? (
          <label className="grid gap-1.5 text-sm">
            <span className="ledger-eyebrow">Praça da cidade dela <span className="text-destructive">*</span></span>
            <SmartSelect value={praca} onChange={setPraca} options={pracas.data ?? []} loading={pracas.isFetching} placeholder="Ela ainda não tem praça" searchPlaceholder="Buscar praça" />
          </label>
        ) : (
          <div className="grid gap-1.5 text-sm">
            <span className="ledger-eyebrow">Praça</span>
            <span className="admin-input flex items-center text-ledger-muted">{escolhida?.praca ?? "Vem do cadastro da consultora"}</span>
          </div>
        )}
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Como a maleta vai</span>
          <SmartSelect value={envio} onChange={(v) => setEnvio((v || "pessoal") as TipoEnvio)}
            options={[{ value: "pessoal", label: "Pessoalmente (entrega ou retirada)" }, { value: "correio", label: "Pelo correio" }]} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Depósito de origem</span>
          <SmartSelect value={deposito} onChange={setDeposito} options={depositos.data ?? []} placeholder="Escolher depósito" />
        </label>
      </div>
      <div className="mt-5 flex gap-2">
        <button type="button" className="admin-btn admin-btn-primary" disabled={abrir.isPending || !pronto} onClick={() => abrir.mutate()}>
          {abrir.isPending ? "Abrindo…" : "Abrir maleta"}
        </button>
        <button type="button" className="admin-btn" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </Panel>
  );
}

/**
 * Abertura (0224): o representante sai com maletas sem consultora para abrir
 * consultoras novas na praça dele. Aqui ele confirma que recebeu a maleta,
 * escolhe a consultora (ou a candidata que cadastrou na Captação) e vincula.
 * Depois de vincular, já manda o contrato e a promissória para ela assinar
 * pela ZapSign. A nota fiscal de remessa sai só depois do vínculo.
 */
import * as React from "react";
import { MaletasRepresentante } from "@/components/representante/MaletasRepresentante";
import { AssinaturaDigital } from "@/components/representante/AssinaturaDigital";

export function AberturaConsultora({ rep }: { rep: string }) {
  const [vinculadas, setVinculadas] = React.useState<{ partyId: string; nome: string; nova: boolean }[]>([]);
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-4 text-sm">
        <p className="font-semibold">Abertura de consultora</p>
        <p className="mt-1 text-muted-foreground">
          1. Confirme que recebeu a maleta de abertura. 2. Cadastre a nova consultora na <strong>Captação</strong> (ou escolha uma da sua carteira).
          3. Vincule a maleta a ela aqui. 4. Mande o contrato e a promissória para ela assinar pelo celular.
        </p>
      </div>

      {vinculadas.map((v) => (
        <div key={v.partyId} className="space-y-2">
          <p className="text-sm font-semibold">Maleta vinculada a {v.nome}{v.nova ? " (nova consultora)" : ""}: mande os documentos</p>
          <AssinaturaDigital party={v.partyId} rep={rep} />
        </div>
      ))}

      <MaletasRepresentante rep={rep} onRepasse={(r) => setVinculadas((l) => [r, ...l.filter((x) => x.partyId !== r.partyId)])} />
    </div>
  );
}

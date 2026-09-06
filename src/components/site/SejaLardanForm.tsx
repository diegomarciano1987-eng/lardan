import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PRIVACY_VERSION, captureUtm, entryUrl } from "@/lib/privacy";
import { SmartSelect } from "@/components/premium/SmartSelect";

type Args = Record<string, unknown>;
function semVazios<T extends Args>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

const field =
  "w-full rounded-md border border-input bg-card px-4 py-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="brand-eyebrow mb-2 block">
      {children}
    </label>
  );
}

export function SejaLardanForm() {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [protocolo, setProtocolo] = useState<string | null>(null);
  const [semNumero, setSemNumero] = useState(false);
  const [uf, setUf] = useState("");

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const texto = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
    };

    const { data, error } = await supabase.rpc(
      "submit_lead",
      semVazios({
        p_full_name: texto("full_name") ?? "",
        p_whatsapp: texto("whatsapp") ?? "",
        p_city: texto("city") ?? "",
        p_uf: texto("uf") ?? "",
        p_street: texto("street"),
        p_street_number: semNumero ? undefined : texto("street_number"),
        p_no_number: semNumero,
        p_postal_code: texto("postal_code"),
        p_financial_goal: texto("financial_goal"),
        p_availability: texto("availability"),
        p_experience: texto("experience"),
        p_audience: texto("audience"),
        p_motivation: texto("motivation"),
        p_source: "site/seja-lardan",
        p_entry_url: entryUrl() ?? undefined,
        p_utm: captureUtm(),
        p_privacy_version: PRIVACY_VERSION,
        p_marketing_consent: form.get("marketing_consent") === "on",
      }) as never,
    );

    setBusy(false);
    if (error || !data) {
      setErro(
        "Não foi possível registrar a candidatura. Confira os dados obrigatórios e tente novamente.",
      );
      return;
    }
    setProtocolo(data);
  }

  if (protocolo) {
    return (
      <div
        role="status"
        className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-8 text-center"
      >
        <p className="brand-eyebrow mb-3">Candidatura registrada</p>
        <h2 className="text-3xl text-foreground">Recebemos os seus dados</h2>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          O seu protocolo é <strong className="text-foreground">{protocolo}</strong>. Guarde este
          número. A equipe Lardan analisa cada candidatura; não há promessa de aprovação, prazo ou
          renda.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="mx-auto max-w-2xl space-y-8" noValidate={false}>
      <fieldset className="space-y-4">
        <legend className="brand-eyebrow mb-4">Dados de contato</legend>
        <div>
          <Label htmlFor="full_name">Nome completo</Label>
          <input id="full_name" name="full_name" required minLength={2} className={field} />
        </div>
        <div>
          <Label htmlFor="whatsapp">WhatsApp com DDD</Label>
          <input
            id="whatsapp"
            name="whatsapp"
            required
            inputMode="tel"
            placeholder="(00) 00000-0000"
            className={field}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="brand-eyebrow mb-4">Endereço</legend>
        <div>
          <Label htmlFor="street">Rua</Label>
          <input id="street" name="street" className={field} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="street_number">Número</Label>
            <input
              id="street_number"
              name="street_number"
              disabled={semNumero}
              className={`${field} disabled:opacity-50`}
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={semNumero}
                onChange={(e) => setSemNumero(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Sem número
            </label>
          </div>
          <div>
            <Label htmlFor="postal_code">CEP</Label>
            <input
              id="postal_code"
              name="postal_code"
              inputMode="numeric"
              placeholder="00000-000"
              className={field}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <div>
            <Label htmlFor="city">Cidade</Label>
            <input id="city" name="city" required className={field} />
          </div>
          <div>
            <Label htmlFor="uf">UF</Label>
            <SmartSelect
              id="uf"
              name="uf"
              required
              value={uf}
              onChange={setUf}
              placeholder="UF"
              searchPlaceholder="Buscar estado..."
              searchThreshold={1}
              options={UFS.map((u) => ({ value: u, label: u }))}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="brand-eyebrow mb-4">Sobre você</legend>
        <div>
          <Label htmlFor="financial_goal">Objetivo financeiro</Label>
          <input id="financial_goal" name="financial_goal" className={field} />
        </div>
        <div>
          <Label htmlFor="availability">Disponibilidade de tempo</Label>
          <input id="availability" name="availability" className={field} />
        </div>
        <div>
          <Label htmlFor="experience">Experiência com vendas</Label>
          <input id="experience" name="experience" className={field} />
        </div>
        <div>
          <Label htmlFor="audience">Pessoas a quem pretende vender</Label>
          <input id="audience" name="audience" className={field} />
        </div>
        <div>
          <Label htmlFor="motivation">Motivação</Label>
          <textarea id="motivation" name="motivation" rows={4} className={field} />
        </div>
      </fieldset>

      <label className="flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
        <input
          type="checkbox"
          name="marketing_consent"
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        Aceito receber comunicações da Lardan sobre novidades e oportunidades (opcional, pode ser
        cancelado a qualquer momento).
      </label>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Ao enviar, os dados acima são registrados para análise da candidatura, sob o aviso de
        privacidade versão {PRIVACY_VERSION}.
      </p>

      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-primary px-8 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        {busy ? "Enviando…" : "Enviar candidatura"}
      </button>
    </form>
  );
}

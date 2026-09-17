import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PRIVACY_VERSION, captureUtm, entryUrl } from "@/lib/privacy";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { consultarCepPublico, listarMunicipiosPublico } from "@/lib/br/lookup.functions";
import {
  formatarCep,
  formatarTelefone,
  normalizarCep,
  normalizarWhatsapp,
} from "@/lib/br/canonico";

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
  const [cep, setCep] = useState("");
  const [rua, setRua] = useState("");
  const [cidade, setCidade] = useState("");
  const [codigoIbge, setCodigoIbge] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [consultandoCep, setConsultandoCep] = useState(false);
  const [estadoCep, setEstadoCep] = useState<string | null>(null);
  const consultarCepFn = useServerFn(consultarCepPublico);
  const listarMunicipiosFn = useServerFn(listarMunicipiosPublico);

  const municipios = useQuery({
    queryKey: ["ibge-municipios-publico", uf],
    enabled: Boolean(uf),
    queryFn: async () => {
      const r = await listarMunicipiosFn({ data: { uf } });
      if (r.status !== "ok") throw new Error(r.mensagem ?? "Municípios indisponíveis.");
      return r.dados ?? [];
    },
    staleTime: 1000 * 60 * 60 * 24,
  });

  async function buscarCep() {
    const c = normalizarCep(cep);
    if (c.estado !== "valido") {
      setEstadoCep(c.erro);
      return;
    }
    setConsultandoCep(true);
    setEstadoCep(null);
    try {
      const r = await consultarCepFn({ data: { cep: c.canonico ?? "" } });
      if (r.status !== "ok" || !r.dados) throw new Error(r.mensagem ?? "CEP não localizado.");
      const d = r.dados;
      setCep(formatarCep(d.cep));
      if (d.logradouro) setRua(d.logradouro);
      if (d.cidade) setCidade(d.cidade);
      if (d.uf) setUf(d.uf);
      if (d.ibge) setCodigoIbge(d.ibge);
      setEstadoCep(`Endereço localizado · fonte ${r.provider}${r.cache ? " (cache)" : ""}.`);
    } catch (e) {
      setEstadoCep(e instanceof Error ? e.message : "Consulta indisponível. Preencha manualmente.");
    } finally {
      setConsultandoCep(false);
    }
  }

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const texto = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
    };
    const whatsappCanonico = normalizarWhatsapp(whatsapp);
    if (whatsappCanonico.estado !== "valido" || !whatsappCanonico.canonico) {
      setBusy(false);
      setErro(whatsappCanonico.erro ?? "WhatsApp inválido.");
      return;
    }

    const { data, error } = await supabase.rpc(
      "submit_lead",
      semVazios({
        p_full_name: texto("full_name") ?? "",
        p_whatsapp: whatsappCanonico.canonico,
        p_city: texto("city") ?? "",
        p_uf: texto("uf") ?? "",
        p_street: texto("street"),
        p_street_number: semNumero ? undefined : texto("street_number"),
        p_no_number: semNumero,
        p_postal_code: normalizarCep(cep).canonico ?? undefined,
        p_financial_goal: texto("financial_goal"),
        p_availability: texto("availability"),
        p_experience: texto("experience"),
        p_audience: texto("audience"),
        p_motivation: texto("motivation"),
        p_source: "site/seja-lardan",
        p_entry_url: entryUrl() ?? undefined,
        p_utm: captureUtm(),
        p_privacy_version: PRIVACY_VERSION,
        p_marketing_consent: marketingConsent,
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
            value={whatsapp}
            onChange={(e) => setWhatsapp(formatarTelefone(e.target.value))}
            className={field}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="brand-eyebrow mb-4">Endereço</legend>
        <div>
          <Label htmlFor="street">Rua</Label>
          <input
            id="street"
            name="street"
            value={rua}
            onChange={(e) => setRua(e.target.value)}
            className={field}
          />
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
              <Checkbox checked={semNumero} onCheckedChange={(v) => setSemNumero(v === true)} />
              Sem número
            </label>
          </div>
          <div>
            <Label htmlFor="postal_code">CEP</Label>
            <div className="flex gap-2">
              <input
                id="postal_code"
                name="postal_code"
                inputMode="numeric"
                placeholder="00000-000"
                value={cep}
                onChange={(e) => {
                  setCep(formatarCep(e.target.value));
                  setEstadoCep(null);
                }}
                onBlur={() => {
                  if (normalizarCep(cep).estado === "valido") void buscarCep();
                }}
                className={field}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label="Consultar CEP"
                title="Consultar CEP"
                disabled={consultandoCep}
                onClick={() => void buscarCep()}
              >
                {consultandoCep ? (
                  <Loader2 aria-hidden className="animate-spin" />
                ) : (
                  <Search aria-hidden />
                )}
              </Button>
            </div>
            {estadoCep ? (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                {estadoCep}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <div>
            <Label htmlFor="city">Cidade</Label>
            {uf && (municipios.data?.length ?? 0) > 0 ? (
              <SmartSelect
                id="city-select"
                required
                value={codigoIbge}
                onChange={(v) => {
                  const m = municipios.data?.find((item) => item.codigo_ibge === v);
                  setCodigoIbge(v);
                  setCidade(m?.nome ?? cidade);
                }}
                options={(municipios.data ?? []).map((m) => ({
                  value: m.codigo_ibge,
                  label: m.nome,
                }))}
                placeholder={municipios.isLoading ? "Carregando…" : "Selecione a cidade"}
                searchPlaceholder="Buscar município…"
              />
            ) : (
              <input
                id="city"
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                required
                className={field}
              />
            )}
            <input type="hidden" name="city" value={cidade} />
          </div>
          <div>
            <Label htmlFor="uf">UF</Label>
            <SmartSelect
              id="uf"
              name="uf"
              required
              value={uf}
              onChange={(v) => {
                setUf(v);
                setCidade("");
                setCodigoIbge("");
              }}
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
          <Label htmlFor="financial_goal">Qual é seu principal objetivo ao começar?</Label>
          <SmartSelect
            id="financial_goal"
            name="financial_goal"
            value={objetivo}
            onChange={setObjetivo}
            placeholder="Selecione o seu objetivo"
            searchPlaceholder="Buscar…"
            options={OBJETIVOS.map((o) => ({ value: o, label: o }))}
          />
        </div>
        <div>
          <Label htmlFor="availability">
            Quanto tempo por semana você acredita que consegue dedicar?
          </Label>
          <SmartSelect
            id="availability"
            name="availability"
            value={disponibilidade}
            onChange={setDisponibilidade}
            placeholder="Selecione a disponibilidade"
            searchPlaceholder="Buscar…"
            options={DISPONIBILIDADES.map((o) => ({ value: o, label: o }))}
          />
        </div>
        <div>
          <Label htmlFor="experience">Você já trabalhou com vendas?</Label>
          <SmartSelect
            id="experience"
            name="experience"
            value={experiencia}
            onChange={setExperiencia}
            placeholder="Selecione uma opção"
            searchPlaceholder="Buscar…"
            options={EXPERIENCIAS.map((o) => ({ value: o, label: o }))}
          />
        </div>
        <div>
          <Label htmlFor="audience">
            Hoje você costuma vender ou se relacionar comercialmente por onde?
          </Label>
          <input
            id="audience"
            name="audience"
            placeholder="WhatsApp, Instagram, presencialmente, indicação…"
            className={field}
          />
        </div>
        <div>
          <Label htmlFor="motivation">
            Conte um pouco sobre você e sua motivação para começar agora
          </Label>
          <textarea id="motivation" name="motivation" rows={5} className={field} />
        </div>
      </fieldset>

      <label className="flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
        <Checkbox
          checked={marketingConsent}
          onCheckedChange={(v) => setMarketingConsent(v === true)}
          className="mt-0.5"
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

      <Button
        type="submit"
        disabled={busy}
        className="h-11 rounded-full px-8 text-[0.75rem] uppercase"
      >
        {busy ? "Enviando…" : "Enviar candidatura"}
      </Button>
    </form>
  );
}

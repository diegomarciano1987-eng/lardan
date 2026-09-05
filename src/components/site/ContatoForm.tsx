import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PRIVACY_VERSION, captureUtm, entryUrl } from "@/lib/privacy";

const field =
  "w-full rounded-md border border-input bg-card px-4 py-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function ContatoForm() {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [protocolo, setProtocolo] = useState<string | null>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const texto = (k: string) => String(form.get(k) ?? "").trim();

    const { data, error } = await supabase.rpc("submit_contact_request", {
      p_full_name: texto("full_name"),
      p_contact_channel: texto("contact_channel"),
      p_contact_value: texto("contact_value"),
      p_subject: texto("subject"),
      p_message: texto("message"),
      p_source: "site/contato",
      p_entry_url: entryUrl() ?? undefined,
      p_utm: captureUtm(),
      p_privacy_version: PRIVACY_VERSION,
      p_marketing_consent: form.get("marketing_consent") === "on",
    });

    setBusy(false);
    if (error || !data) {
      setErro("Não foi possível enviar a mensagem. Confira os campos e tente novamente.");
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
        <p className="brand-eyebrow mb-3">Mensagem registrada</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          O seu protocolo é <strong className="text-foreground">{protocolo}</strong>.
          A equipe responde pelo canal informado. Não há prazo de retorno
          declarado.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="mx-auto max-w-2xl space-y-6 px-6 pb-24">
      <div>
        <label htmlFor="full_name" className="brand-eyebrow mb-2 block">
          Nome
        </label>
        <input id="full_name" name="full_name" required minLength={2} className={field} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact_channel" className="brand-eyebrow mb-2 block">
            Canal de retorno
          </label>
          <select id="contact_channel" name="contact_channel" required defaultValue="WhatsApp" className={field}>
            <option value="WhatsApp">WhatsApp</option>
            <option value="E-mail">E-mail</option>
            <option value="Telefone">Telefone</option>
          </select>
        </div>
        <div>
          <label htmlFor="contact_value" className="brand-eyebrow mb-2 block">
            Contato
          </label>
          <input id="contact_value" name="contact_value" required className={field} />
        </div>
      </div>
      <div>
        <label htmlFor="subject" className="brand-eyebrow mb-2 block">
          Assunto
        </label>
        <input id="subject" name="subject" required className={field} />
      </div>
      <div>
        <label htmlFor="message" className="brand-eyebrow mb-2 block">
          Mensagem
        </label>
        <textarea id="message" name="message" required rows={6} minLength={5} className={field} />
      </div>

      <label className="flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
        <input
          type="checkbox"
          name="marketing_consent"
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        Aceito receber comunicações da Lardan (opcional).
      </label>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Mensagem registrada sob o aviso de privacidade versão {PRIVACY_VERSION}.
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
        {busy ? "Enviando…" : "Enviar mensagem"}
      </button>
    </form>
  );
}

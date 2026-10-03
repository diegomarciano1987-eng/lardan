import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Loader2, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { convidarConsultora } from "@/lib/acessos.functions";

type Convite = { id: string; email: string; status: string; expira: string; envios: number; ultimo_envio: string | null; erro: string | null; aceito_em: string | null };
type Acesso = { party_id: string; nome: string; conta_email: string | null; consultora_ativa: boolean; email: string | null; whatsapp: string | null; convite: Convite | null };
type SitLead = { lead_id: string; nome: string; email: string | null; whatsapp: string | null; aprovada: boolean; acesso: Acesso | null };

const ROTULO: Record<string, { t: string; c: string }> = {
  pendente: { t: "Convite enviado — aguardando ela criar a senha", c: "text-bronze" },
  falha_envio: { t: "E-mail não saiu — use o link no WhatsApp ou reenvie", c: "text-destructive" },
  expirado: { t: "Convite vencido (48 horas) — gere um novo", c: "text-destructive" },
  revogado: { t: "Convite cancelado", c: "text-ledger-muted" },
  aceito: { t: "Convite aceito", c: "text-success" },
};

const fone = (w: string | null) => {
  const d = (w ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.length <= 11 ? `55${d}` : d;
};

/**
 * Cartão de acesso ao Portal da Consultora. Pela candidatura (leadId) ou pelo
 * cadastro (partyId). `auto` gera e envia sozinho quando ainda não há convite.
 */
export function ConviteConsultora({ leadId, partyId, auto = false }: { leadId?: string; partyId?: string; auto?: boolean }) {
  const qc = useQueryClient();
  const convidar = useServerFn(convidarConsultora);
  const chave = ["acesso-consultora", leadId ?? partyId];
  const q = useQuery({
    queryKey: chave,
    queryFn: async () => {
      if (leadId) {
        const { data, error } = await supabase.rpc("candidata_acesso_situacao" as never, { _lead: leadId } as never);
        if (error) throw error;
        return data as unknown as SitLead;
      }
      const { data, error } = await supabase.rpc("consultora_acesso_situacao" as never, { _party: partyId } as never);
      if (error) throw error;
      const a = data as unknown as Acesso;
      return { lead_id: "", nome: a.nome, email: a.email, whatsapp: a.whatsapp, aprovada: true, acesso: a } as SitLead;
    },
  });
  const [email, setEmail] = React.useState("");
  const [link, setLink] = React.useState("");
  const [ocupado, setOcupado] = React.useState(false);
  const [copiado, setCopiado] = React.useState(false);
  const disparou = React.useRef(false);

  const s = q.data;
  const a = s?.acesso ?? null;
  React.useEffect(() => {
    if (s && !email) setEmail(a?.convite?.email ?? a?.email ?? s.email ?? "");
  }, [s, a, email]);

  async function gerar() {
    setOcupado(true);
    try {
      const r = await convidar({ data: { lead_id: leadId, party_id: leadId ? undefined : partyId, email, origem: window.location.origin } });
      if (!r.ok) { toast.error(r.erro); return; }
      setLink(r.link);
      if (r.enviado) toast.success(r.reenvio ? "Novo link gerado e e-mail reenviado. O link anterior deixou de valer." : "Convite enviado por e-mail.");
      else toast.warning(`Convite criado, mas o e-mail não saiu: ${r.erro}. Use o link no WhatsApp.`);
      await qc.invalidateQueries({ queryKey: chave });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o convite.");
    } finally {
      setOcupado(false);
    }
  }

  React.useEffect(() => {
    if (!auto || disparou.current || !s || !s.aprovada) return;
    if (a?.conta_email || (a?.convite && a.convite.status !== "revogado")) return;
    const e = s.email ?? a?.email;
    if (!e) return;
    disparou.current = true;
    void gerar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, s]);

  if (q.isLoading) return <p className="text-sm text-ledger-muted">Conferindo acesso…</p>;
  if (q.error || !s) return <p className="text-sm text-destructive">Não foi possível ler a situação do acesso.</p>;
  if (!s.aprovada) return <p className="text-sm text-ledger-muted">O convite de acesso fica disponível quando a candidatura estiver em Aprovada.</p>;

  if (a?.conta_email) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-success"><ShieldCheck className="size-4" aria-hidden /> Acesso ativo ao Portal da Consultora</p>
        <p className="text-sm text-ledger-muted">Entra com <strong className="text-ledger-text">{a.conta_email}</strong>. Se esquecer a senha, ela usa “Esqueci minha senha” na tela de entrada.</p>
      </div>
    );
  }

  const c = a?.convite;
  const nomeCurto = s.nome.split(" ")[0];
  const msg = `Olá, ${nomeCurto}! Sua candidatura foi aprovada e você já pode entrar no Portal da Consultora Lardan. Crie sua senha por este link (vale 48 horas): ${link}`;
  const zap = fone(s.whatsapp ?? a?.whatsapp ?? null);

  return (
    <div className="space-y-4">
      {c && ROTULO[c.status] && (
        <div className="rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm">
          <p className={`font-semibold ${ROTULO[c.status]!.c}`}>{ROTULO[c.status]!.t}</p>
          <p className="mt-1 text-ledger-muted">
            Para {c.email} · {c.envios} envio(s){c.ultimo_envio ? ` · último em ${new Date(c.ultimo_envio).toLocaleString("pt-BR")}` : ""}
            {c.status === "pendente" ? ` · vale até ${new Date(c.expira).toLocaleString("pt-BR")}` : ""}
          </p>
          {c.erro && <p className="mt-1 text-destructive">Motivo: {c.erro}</p>}
        </div>
      )}

      <label className="block text-sm">
        <span className="font-semibold text-ledger-text">E-mail de acesso</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com"
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
      </label>

      <button type="button" className="admin-btn border-champagne w-full justify-center" disabled={ocupado || !email} onClick={() => void gerar()}>
        {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : c && c.status !== "revogado" ? <KeyRound className="size-4" aria-hidden /> : <Mail className="size-4" aria-hidden />}
        {c && c.status !== "revogado" ? "Gerar novo link e reenviar e-mail" : "Gerar convite e enviar por e-mail"}
      </button>

      {link && (
        <div className="space-y-2 rounded-lg border border-success/40 bg-success/5 p-3">
          <p className="text-xs font-semibold text-ledger-text">Link de convite (copia e cola) — vale 48 horas, uso único</p>
          <p className="break-all rounded-md bg-surface px-3 py-2 font-mono text-xs">{link}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="admin-btn justify-center" onClick={() => { void navigator.clipboard.writeText(msg); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>
              {copiado ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copiado ? "Copiado" : "Copiar mensagem"}
            </button>
            <a className="admin-btn justify-center" target="_blank" rel="noreferrer"
              href={`https://wa.me/${zap}?text=${encodeURIComponent(msg)}`}>
              <MessageCircle className="size-4" aria-hidden /> Enviar no WhatsApp
            </a>
          </div>
          <p className="text-xs text-ledger-muted">O link só é mostrado agora, por segurança. Para ter outro, gere um novo (o anterior deixa de valer).</p>
        </div>
      )}
      {!link && c?.status === "pendente" && (
        <p className="text-xs text-ledger-muted">Precisa do link para o WhatsApp? Gere um novo acima — o anterior deixa de valer.</p>
      )}
    </div>
  );
}

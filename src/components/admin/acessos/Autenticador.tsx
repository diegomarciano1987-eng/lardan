import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { removerAutenticador } from "@/lib/acessos.functions";

/** Cadastro do autenticador por aplicativo do próprio usuário. */
export function MeuAutenticador() {
  const qc = useQueryClient();
  const fatores = useQuery({
    queryKey: ["mfa-fatores"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data.totp;
    },
  });
  const [qr, setQr] = React.useState<{ id: string; svg: string; segredo: string } | null>(null);
  const [codigo, setCodigo] = React.useState("");

  async function iniciar() {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Lardan ${Date.now()}` });
    if (error) { toast.error(error.message); return; }
    setQr({ id: data.id, svg: data.totp.qr_code, segredo: data.totp.secret });
  }
  async function confirmar() {
    if (!qr) return;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: qr.id, code: codigo.trim() });
    if (error) { toast.error("Código incorreto. Confira a hora do celular e tente de novo."); return; }
    toast.success("Autenticador cadastrado.");
    setQr(null);
    setCodigo("");
    void qc.invalidateQueries({ queryKey: ["mfa-fatores"] });
  }

  const ativos = (fatores.data ?? []).filter((f) => f.status === "verified");
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-xl text-foreground">Autenticador por aplicativo</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Use Google Authenticator, Microsoft Authenticator ou similar. Obrigatório para quem administra acessos ou financeiro quando a Lardan ligar a exigência.
      </p>
      {ativos.length > 0 ? (
        <p className="mt-4 rounded-xl bg-muted p-3 text-sm text-foreground">Autenticador ativo desde {new Date(ativos[0]!.created_at).toLocaleDateString("pt-BR")}.</p>
      ) : qr ? (
        <div className="mt-4 space-y-3">
          <div className="w-48 rounded-xl bg-background p-2" dangerouslySetInnerHTML={{ __html: qr.svg }} />
          <p className="break-all text-xs text-muted-foreground">Ou digite a chave: {qr.segredo}</p>
          <input inputMode="numeric" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
            placeholder="Código de 6 dígitos" className="w-48 rounded-xl border border-input bg-background px-3 py-2 text-base tracking-widest" />
          <button onClick={() => void confirmar()} disabled={codigo.length !== 6}
            className="ml-2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Confirmar</button>
        </div>
      ) : (
        <button onClick={() => void iniciar()} className="mt-4 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">
          Cadastrar autenticador
        </button>
      )}
    </section>
  );
}

/** Painel do Master: quem já cadastrou, exigência e recuperação auditada. */
export function PainelSegundoFator() {
  const qc = useQueryClient();
  const remover = useServerFn(removerAutenticador);
  const dados = useQuery({
    queryKey: ["mfa-situacao"],
    queryFn: async () => {
      const [s, c] = await Promise.all([
        supabase.rpc("access_mfa_situacao" as never),
        supabase.from("access_security_settings" as never).select("mfa_obrigatorio").maybeSingle(),
      ]);
      if (s.error) throw s.error;
      return {
        pessoas: (s.data ?? []) as unknown as { user_id: string; email: string | null; tem_autenticador: boolean }[],
        ligado: Boolean((c.data as { mfa_obrigatorio?: boolean } | null)?.mfa_obrigatorio),
      };
    },
  });

  async function alternar() {
    const ligar = !dados.data?.ligado;
    const { data, error } = await supabase.rpc("access_mfa_exigir" as never, { _ligar: ligar } as never);
    if (error) { toast.error(error.message); return; }
    const r = data as unknown as { ok: boolean; faltam?: string[] };
    if (!r.ok) { toast.error(`Ainda sem autenticador: ${r.faltam?.join(", ")}`); return; }
    toast.success(ligar ? "Exigência ligada." : "Exigência desligada.");
    void qc.invalidateQueries({ queryKey: ["mfa-situacao"] });
  }
  async function recuperar(uid: string, email: string | null) {
    const motivo = prompt(`Remover o autenticador de ${email ?? uid}? Informe o motivo (confirme a identidade antes):`);
    if (!motivo || motivo.trim().length < 5) return;
    try {
      await remover({ data: { user_id: uid, motivo: motivo.trim() } });
      toast.success("Autenticador removido e registrado na auditoria. A pessoa deve cadastrar um novo.");
      void qc.invalidateQueries({ queryKey: ["mfa-situacao"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha"); }
  }

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl text-foreground">Segundo fator dos administradores</h2>
        <button onClick={() => void alternar()} className="rounded-full border border-border px-4 py-2 text-sm">
          {dados.data?.ligado ? "Exigência ligada — desligar" : "Ligar exigência"}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Só liga quando todos abaixo tiverem autenticador e você tiver entrado com o código.</p>
      <div className="mt-4 divide-y divide-border">
        {dados.data?.pessoas.map((p) => (
          <div key={p.user_id} className="flex items-center justify-between py-2 text-sm">
            <span className="text-foreground">{p.email ?? p.user_id}</span>
            <span className="flex items-center gap-2">
              <span className={p.tem_autenticador ? "text-foreground" : "text-destructive"}>{p.tem_autenticador ? "Cadastrado" : "Pendente"}</span>
              {p.tem_autenticador && (
                <button onClick={() => void recuperar(p.user_id, p.email)} className="text-xs text-muted-foreground underline">recuperar</button>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Pede o código do aplicativo quando a conta tem autenticador e a sessão ainda não passou por ele. */
export function PortaoSegundoFator({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = React.useState<"conferindo" | "codigo" | "ok">("conferindo");
  const [codigo, setCodigo] = React.useState("");
  const [erro, setErro] = React.useState("");
  React.useEffect(() => {
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      setEstado(data?.nextLevel === "aal2" && data.currentLevel !== "aal2" ? "codigo" : "ok");
    }).catch(() => setEstado("ok"));
  }, []);
  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    const { data } = await supabase.auth.mfa.listFactors();
    const f = data?.totp.find((x) => x.status === "verified");
    if (!f) return setEstado("ok");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code: codigo.trim() });
    if (error) return setErro("Código incorreto.");
    setEstado("ok");
  }
  if (estado === "ok") return <>{children}</>;
  if (estado === "conferindo") return null;
  return (
    <form onSubmit={verificar} className="mx-auto mt-24 max-w-sm space-y-3 rounded-2xl border border-border bg-card p-6">
      <h1 className="text-xl text-foreground">Código do autenticador</h1>
      <p className="text-sm text-muted-foreground">Digite o código de 6 dígitos do seu aplicativo.</p>
      <input autoFocus inputMode="numeric" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded-xl border border-input bg-background px-4 py-3 text-center text-lg tracking-[0.4em]" />
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <button disabled={codigo.length !== 6} className="w-full rounded-full bg-primary px-5 py-3 text-sm text-primary-foreground disabled:opacity-50">Entrar</button>
      <button type="button" onClick={() => void supabase.auth.signOut()} className="w-full text-sm text-muted-foreground underline">Sair</button>
    </form>
  );
}

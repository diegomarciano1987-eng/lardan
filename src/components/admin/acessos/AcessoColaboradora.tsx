import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, Wand2 } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { colabAcessoAtivo, colabAcessoLer, colabAcessoSalvar, colabModulosSalvar } from "@/lib/colab-acesso.functions";
import { gerarSenhaForte } from "@/lib/senha-forte";
import { COLAB_MODULOS, PACOTE_MONTAGEM, capsDeEscolha, escolhaDeCaps, type Escolha } from "@/lib/colab-modulos";

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25";

const OPCOES: { v: "nao" | "ver" | "alterar"; t: string }[] = [
  { v: "nao", t: "Sem acesso" },
  { v: "ver", t: "Ver" },
  { v: "alterar", t: "Ver e alterar" },
];

/** Código + senha da colaboradora e módulos liberados. Só o Master usa. */
export function AcessoColaboradora({ partyId }: { partyId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["colab-acesso", partyId], queryFn: () => colabAcessoLer({ data: { party_id: partyId } }) });
  const [codigo, setCodigo] = useState("");
  const [senha, setSenha] = useState("");
  const [escolha, setEscolha] = useState<Escolha>({});
  const [fin, setFin] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setCodigo(q.data.acesso?.codigo ?? q.data.proximo);
    setEscolha(escolhaDeCaps(q.data.caps));
    setFin(q.data.financeiro);
  }, [q.data]);

  if (q.isLoading) return <p className="p-5 text-sm text-ledger-muted">Carregando acesso…</p>;
  if (q.error) return <p className="p-5 text-sm text-ledger-muted">{(q.error as Error).message}</p>;
  const d = q.data!;
  if (!d.ehColaboradora)
    return (
      <p className="p-5 text-sm text-ledger-muted">
        Para criar código e senha da operação, marque primeiro o papel <strong>Colaborador</strong> em Vínculos de atuação.
      </p>
    );

  async function salvarAcesso() {
    setBusy(true);
    try {
      await colabAcessoSalvar({ data: { party_id: partyId, codigo, senha } });
      setSenha("");
      toast.success(d.acesso ? "Acesso atualizado." : `Acesso criado. Código ${codigo}.`);
      await qc.invalidateQueries({ queryKey: ["colab-acesso", partyId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function salvarModulos() {
    if (!d.acesso) return;
    setBusy(true);
    try {
      await colabModulosSalvar({ data: { user_id: d.acesso.user_id, caps: capsDeEscolha(escolha), financeiro: fin } });
      toast.success("Módulos salvos. Valem no próximo carregamento da tela dela.");
      await qc.invalidateQueries({ queryKey: ["colab-acesso", partyId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function alternarAtivo(v: boolean) {
    if (!d.acesso) return;
    try {
      await colabAcessoAtivo({ data: { user_id: d.acesso.user_id, ativo: v } });
      toast.success(v ? "Acesso liberado." : "Acesso suspenso.");
      await qc.invalidateQueries({ queryKey: ["colab-acesso", partyId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6 p-5">
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ledger-text">
          <KeyRound className="h-4 w-4" /> Código e senha da operação
        </h3>
        <p className="text-sm text-ledger-muted">
          Ela entra em Sistema Lardan → Operação → <strong>Entrar com código</strong>, sem precisar de e-mail.
          {d.emailReal && " Ela já tem login com o e-mail dela: o código usa a mesma senha (ela troca em “Esqueci minha senha”)."}
        </p>
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-ledger-text">
            Código da colaboradora
            <input className={inputCls + " mt-1"} inputMode="numeric" maxLength={8} value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} />
          </label>
          {!d.emailReal && (
            <label className="text-sm font-medium text-ledger-text">
              {d.acesso ? "Nova senha (deixe vazio para manter)" : "Senha"}
              <PasswordInput className={inputCls + " mt-1"} autoComplete="new-password" value={senha}
                onChange={(e) => setSenha(e.target.value)} />
              <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-ledger-text underline-offset-2 hover:underline"
                onClick={() => { const s = gerarSenhaForte(); setSenha(s); void navigator.clipboard?.writeText(s).catch(() => undefined); toast.success(`Senha gerada: ${s}`, { description: "Anote e passe para ela. Já copiei." }); }}>
                <Wand2 className="h-3.5 w-3.5" /> Gerar senha forte
              </button>
              {senha && <span className="mt-1 block text-xs text-ledger-muted">Senhas fáceis (123456, nome+ano) são recusadas pela proteção de senhas vazadas.</span>}
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" disabled={busy} onClick={salvarAcesso}
            className="h-11 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {d.acesso ? (d.emailReal ? "Salvar código" : "Salvar código/senha") : "Criar acesso"}
          </button>
          {d.acesso && (
            <label className="flex items-center gap-2 text-sm text-ledger-text">
              <Switch checked={d.acesso.ativo} onCheckedChange={alternarAtivo} /> Acesso liberado
            </label>
          )}
          {d.acesso?.bloqueado && (
            <span className="text-sm text-destructive">Bloqueado por tentativas erradas — salvar libera.</span>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ledger-text">
            <ShieldCheck className="h-4 w-4" /> Módulos liberados
          </h3>
          <button type="button" disabled={!d.acesso}
            onClick={() => setEscolha((e) => ({ ...e, ...Object.fromEntries(PACOTE_MONTAGEM.map((id) => [id, "alterar" as const])) }))}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm text-ledger-text disabled:opacity-50">
            <Wand2 className="h-4 w-4" /> Tudo para montar maleta
          </button>
        </div>
        {!d.acesso && <p className="text-sm text-ledger-muted">Crie o código e a senha para escolher os módulos.</p>}
        <div className="divide-y divide-line rounded-[12px] border border-line">
          {COLAB_MODULOS.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ledger-text">{m.nome}</p>
                <p className="text-xs text-ledger-muted">{m.texto}</p>
              </div>
              <div className="flex rounded-full border border-line p-1" role="radiogroup" aria-label={m.nome}>
                {OPCOES.filter((o) => o.v !== "alterar" || m.alterar.length > 0).map((o) => (
                  <button key={o.v} type="button" role="radio" aria-checked={(escolha[m.id] ?? "nao") === o.v}
                    disabled={!d.acesso}
                    onClick={() => setEscolha((e) => ({ ...e, [m.id]: o.v }))}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${(escolha[m.id] ?? "nao") === o.v ? "bg-primary text-primary-foreground" : "text-ledger-muted"}`}>
                    {o.t}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ledger-text">Financeiro completo</p>
              <p className="text-xs text-ledger-muted">Contas, títulos, baixas e conciliação. Exige segundo fator (autenticador) ao entrar.</p>
            </div>
            <Switch checked={fin} disabled={!d.acesso} onCheckedChange={setFin} aria-label="Financeiro completo" />
          </div>
        </div>
        <button type="button" disabled={busy || !d.acesso} onClick={salvarModulos}
          className="h-11 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground disabled:opacity-60">
          Salvar módulos
        </button>
      </section>
    </div>
  );
}

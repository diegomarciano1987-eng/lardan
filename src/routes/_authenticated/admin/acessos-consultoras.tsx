/**
 * Acessos das consultoras (0245): para o Daniel (diretoria) e o Master. Mostra quem tem login, o
 * e-mail, o último acesso e a situação do convite, e permite definir uma senha nova.
 * A senha atual de ninguém é legível — o sistema guarda só a versão cifrada. Para ajudar uma
 * consultora, o Daniel define uma senha nova aqui e passa para ela.
 */
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, KeyRound, Search } from "lucide-react";
import { PageHeader, Panel, StatusBadge } from "@/components/admin/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { consultoraDefinirSenha } from "@/lib/acessos.functions";

export const Route = createFileRoute("/_authenticated/admin/acessos-consultoras")({
  component: Pagina,
  head: () => ({ meta: [{ title: "Acessos das consultoras — LARDAN Cloud" }, { name: "robots", content: "noindex, nofollow" }] }),
});

interface Item {
  id: string; codigo: string | null; nome: string; situacao: string; user_id: string | null; email: string | null;
  ultimo_acesso: string | null; conta_criada: string | null; convite: string | null; pode_definir_senha: boolean;
}
const quando = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

/** Senha fácil de ditar: 3 sílabas + 4 números (ex.: Lumaresa4821). */
function sugerirSenha() {
  const s = ["la", "re", "mi", "so", "lu", "na", "ri", "to", "be", "ca", "do", "fe", "ga", "ju", "ma", "pe"];
  const r = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0]! % n;
  const p = Array.from({ length: 3 }, () => s[r(s.length)]).join("");
  return p.charAt(0).toUpperCase() + p.slice(1) + String(1000 + r(9000));
}

function Pagina() {
  const [busca, setBusca] = React.useState("");
  const [pag, setPag] = React.useState(0);
  const [alvo, setAlvo] = React.useState<Item | null>(null);
  const q = useQuery({
    queryKey: ["consultoras-acessos", busca, pag],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consultoras_acessos" as never, { _busca: busca || null, _offset: pag * 50 } as never);
      if (error) throw error;
      return data as unknown as { total: number; com_login: number; itens: Item[] };
    },
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Cadastros" title="Acessos das consultoras" description="Quem já entra no app, com qual e-mail e quando entrou pela última vez." />
      <Panel title={d ? `${d.total} consultoras · ${d.com_login} com login` : "Consultoras"}>
        <div className="space-y-4 text-sm">
          <p className="rounded-xl bg-muted px-4 py-3 text-ledger-muted">
            Por segurança, nenhuma senha fica guardada de um jeito que dê para ler — nem a Lardan, nem o sistema conseguem ver a senha
            que a consultora criou. Para ajudar uma consultora que não consegue entrar, use <strong>Definir senha nova</strong> e passe a senha para ela.
          </p>
          <label className="relative block">
            <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" />
            <input className="admin-input w-full pl-9" placeholder="Buscar por nome, código, e-mail ou CPF" value={busca}
              onChange={(e) => { setBusca(e.target.value); setPag(0); }} />
          </label>
          {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ledger-muted">
                <tr><th className="py-2">Consultora</th><th>E-mail de acesso</th><th>Último acesso</th><th>Situação</th><th /></tr>
              </thead>
              <tbody>
                {(d?.itens ?? []).map((c) => (
                  <tr key={c.id} className="border-t border-line-soft">
                    <td className="py-2"><span className="font-medium">{c.nome}</span>{c.codigo ? <span className="ml-1 text-xs text-ledger-muted">{c.codigo}</span> : null}</td>
                    <td className="break-all">{c.email ?? "—"}</td>
                    <td>{quando(c.ultimo_acesso)}</td>
                    <td>
                      {c.user_id ? <StatusBadge tone={c.ultimo_acesso ? "success" : "warning"}>{c.ultimo_acesso ? "Com login" : "Login criado, nunca entrou"}</StatusBadge>
                        : <StatusBadge tone="neutral">{c.convite === "pendente" ? "Convite enviado" : "Sem login"}</StatusBadge>}
                    </td>
                    <td className="text-right">
                      {c.pode_definir_senha && (
                        <button type="button" className="admin-btn h-9 px-3 text-xs" onClick={() => setAlvo(c)}><KeyRound className="size-3.5" /> Definir senha nova</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d && d.total > 50 && (
            <div className="flex items-center gap-2">
              <button type="button" className="admin-btn h-9" disabled={pag === 0} onClick={() => setPag(pag - 1)}>Anterior</button>
              <span>Página {pag + 1} de {Math.ceil(d.total / 50)}</span>
              <button type="button" className="admin-btn h-9" disabled={(pag + 1) * 50 >= d.total} onClick={() => setPag(pag + 1)}>Próxima</button>
            </div>
          )}
        </div>
      </Panel>
      {alvo && <DefinirSenha alvo={alvo} fechar={() => setAlvo(null)} />}
    </div>
  );
}

function DefinirSenha({ alvo, fechar }: { alvo: Item; fechar: () => void }) {
  const fn = useServerFn(consultoraDefinirSenha);
  const [senha, setSenha] = React.useState(sugerirSenha);
  const [feito, setFeito] = React.useState(false);
  const salvar = useMutation({
    mutationFn: () => fn({ data: { partyId: alvo.id, senha } }),
    onSuccess: () => { setFeito(true); toast.success("Senha definida."); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha."),
  });
  const texto = `Olá, ${alvo.nome.split(" ")[0]}! Seu acesso ao app Lardan: e-mail ${alvo.email ?? ""} e senha ${senha}. Entre em www.lardan.com.br/acesso. Se quiser, troque a senha depois em "Minha conta".`;
  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Senha nova para {alvo.nome}</DialogTitle>
          <DialogDescription>A senha antiga deixa de valer na hora. Fica registrado que foi você quem trocou.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="grid gap-1"><span className="ledger-eyebrow">Senha nova (mínimo 8)</span>
            <input className="admin-input font-mono" value={senha} disabled={feito} onChange={(e) => setSenha(e.target.value)} /></label>
          {!feito ? (
            <div className="flex gap-2">
              <button type="button" className="admin-btn" onClick={() => setSenha(sugerirSenha())}>Sugerir outra</button>
              <button type="button" className="admin-btn admin-btn-primary flex-1" disabled={senha.length < 8 || salvar.isPending} onClick={() => salvar.mutate()}>
                {salvar.isPending ? "Salvando…" : "Definir senha"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="rounded-xl bg-muted p-3">{texto}</p>
              <div className="flex gap-2">
                <button type="button" className="admin-btn flex-1" onClick={() => { void navigator.clipboard.writeText(texto); toast.success("Mensagem copiada."); }}><Copy className="size-4" /> Copiar mensagem</button>
                <button type="button" className="admin-btn admin-btn-primary" onClick={fechar}>Fechar</button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

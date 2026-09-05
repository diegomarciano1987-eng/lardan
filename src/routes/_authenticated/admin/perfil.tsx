import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, Panel, ErrorState, formatDateTime } from "@/components/admin/ui";
import { Avatar } from "@/components/admin/UserMenu";
import { useAdminRoles } from "@/components/admin/AdminShell";
import { ROLE_LABEL } from "@/lib/roles";
import {
  changePassword,
  fetchMyProfile,
  removeAvatar,
  signedAvatarUrl,
  updateMyProfile,
} from "@/lib/profile";

export const Route = createFileRoute("/_authenticated/admin/perfil")({
  component: PerfilPage,
  head: () => ({
    meta: [
      { title: "Meu perfil — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function PerfilPage() {
  const roles = useAdminRoles();
  const qc = useQueryClient();
  const perfil = useQuery({ queryKey: ["my-profile"], queryFn: fetchMyProfile });
  const foto = useQuery({
    queryKey: ["my-avatar", perfil.data?.avatar_url],
    queryFn: () => signedAvatarUrl(perfil.data?.avatar_url ?? null),
    enabled: Boolean(perfil.data?.avatar_url),
  });

  useEffect(() => {
    const alvo = window.location.hash.replace("#", "");
    if (!alvo) return;
    const t = window.setTimeout(() => {
      document.getElementById(alvo)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => window.clearTimeout(t);
  }, [perfil.isSuccess]);

  if (perfil.isError) {
    return (
      <Panel title="Meu perfil">
        <ErrorState
          message="Não foi possível carregar seus dados."
          onRetry={() => void perfil.refetch()}
        />
      </Panel>
    );
  }

  const p = perfil.data;
  const initials = (p?.full_name || p?.email || "?").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="MINHA CONTA"
        title="Meu perfil"
        description="Seus dados, sua foto, sua senha e os acessos liberados para você no sistema."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <FotoCard
            id="foto"
            url={foto.data ?? null}
            initials={initials}
            path={p?.avatar_url ?? null}
            onChanged={() => void qc.invalidateQueries({ queryKey: ["my-profile"] })}
          />
          <AcessoCard
            id="acesso"
            roles={roles}
            email={p?.email ?? null}
            ativo={p?.is_active ?? true}
            desde={p?.created_at ?? null}
          />
        </div>

        <div className="space-y-6">
          <DadosCard
            key={p?.updated_at ?? "novo"}
            initial={{
              full_name: p?.full_name ?? "",
              display_name: p?.display_name ?? "",
              job_title: p?.job_title ?? "",
              phone: p?.phone ?? "",
            }}
            email={p?.email ?? ""}
            onSaved={() => void qc.invalidateQueries({ queryKey: ["my-profile"] })}
          />
          <SenhaCard id="senha" />
        </div>
      </div>
    </div>
  );
}

function FotoCard({
  id,
  url,
  initials,
  path,
  onChanged,
}: {
  id: string;
  url: string | null;
  initials: string;
  path: string | null;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = useMutation({
    mutationFn: async (file: File) => {
      const { uploadAvatar } = await import("@/lib/profile");
      await uploadAvatar(file);
    },
    onSuccess: () => {
      setErro(null);
      onChanged();
    },
    onError: (e: Error) => setErro(e.message),
  });

  const apagar = useMutation({
    mutationFn: () => removeAvatar(path),
    onSuccess: onChanged,
    onError: (e: Error) => setErro(e.message),
  });

  return (
    <Panel title="Foto do perfil">
      <div id={id} className="scroll-mt-24 space-y-4 px-5 py-5">
        <div className="flex items-center gap-4">
          <Avatar url={url} initials={initials} className="size-20 text-lg" />
          <div className="space-y-2">
            <button
              type="button"
              className="admin-btn"
              onClick={() => input.current?.click()}
              disabled={enviar.isPending}
            >
              {enviar.isPending ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <Camera aria-hidden className="size-3.5" />
              )}
              Enviar nova foto
            </button>
            {path && (
              <button
                type="button"
                className="admin-btn"
                onClick={() => apagar.mutate()}
                disabled={apagar.isPending}
              >
                <Trash2 aria-hidden className="size-3.5" /> Remover
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-ledger-muted">
          JPG, PNG, WEBP ou AVIF, até 5 MB. A foto é visível apenas para pessoas com
          acesso ao sistema.
        </p>
        {erro && <p className="text-xs text-danger">{erro}</p>}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) enviar.mutate(f);
            e.target.value = "";
          }}
        />
      </div>
    </Panel>
  );
}

function DadosCard({
  initial,
  email,
  onSaved,
}: {
  initial: { full_name: string; display_name: string; job_title: string; phone: string };
  email: string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [ok, setOk] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: () =>
      updateMyProfile({
        full_name: form.full_name.trim() || null,
        display_name: form.display_name.trim() || null,
        job_title: form.job_title.trim() || null,
        phone: form.phone.trim() || null,
      }),
    onSuccess: () => {
      setErro(null);
      setOk(true);
      window.setTimeout(() => setOk(false), 2500);
      onSaved();
    },
    onError: (e: Error) => setErro(e.message),
  });

  const campo = (
    name: keyof typeof form,
    label: string,
    placeholder: string,
    type = "text",
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type={type}
        value={form[name]}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
      />
    </div>
  );

  return (
    <Panel title="Meus dados">
      <form
        className="space-y-4 px-5 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {campo("full_name", "Nome completo", "Como está no documento")}
          {campo("display_name", "Como quer ser chamada(o)", "Nome de exibição")}
          {campo("job_title", "Cargo ou função", "Consultora, representante, financeiro...")}
          {campo("phone", "Telefone / WhatsApp", "(11) 90000-0000", "tel")}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="email">E-mail de acesso</Label>
            <Input id="email" value={email} readOnly disabled />
            <p className="text-xs text-ledger-muted">
              O e-mail de acesso só pode ser alterado pelo Master.
            </p>
          </div>
        </div>

        {erro && <p className="text-xs text-danger">{erro}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="admin-btn" disabled={salvar.isPending}>
            {salvar.isPending && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
            Salvar alterações
          </button>
          {ok && (
            <span className="inline-flex items-center gap-1.5 text-xs text-success">
              <Check aria-hidden className="size-3.5" /> Dados atualizados
            </span>
          )}
        </div>
      </form>
    </Panel>
  );
}

function SenhaCard({ id }: { id: string }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [ok, setOk] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const trocar = useMutation({
    mutationFn: () => changePassword(atual, nova),
    onSuccess: () => {
      setErro(null);
      setOk(true);
      setAtual("");
      setNova("");
      setConfirma("");
      window.setTimeout(() => setOk(false), 3000);
    },
    onError: (e: Error) => setErro(e.message),
  });

  return (
    <Panel title="Trocar senha">
      <form
        id={id}
        className="scroll-mt-24 space-y-4 px-5 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (nova !== confirma) {
            setErro("A confirmação não confere com a nova senha.");
            return;
          }
          trocar.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="senha-atual">Senha atual</Label>
            <Input
              id="senha-atual"
              type="password"
              autoComplete="current-password"
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="senha-nova">Nova senha</Label>
            <Input
              id="senha-nova"
              type="password"
              autoComplete="new-password"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="senha-confirma">Repetir nova senha</Label>
            <Input
              id="senha-confirma"
              type="password"
              autoComplete="new-password"
              value={confirma}
              onChange={(e) => setConfirma(e.target.value)}
              required
              minLength={8}
            />
          </div>
        </div>
        <p className="text-xs text-ledger-muted">
          Use pelo menos 8 caracteres. Pedimos a senha atual para confirmar que é você.
        </p>
        {erro && <p className="text-xs text-danger">{erro}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="admin-btn" disabled={trocar.isPending}>
            {trocar.isPending ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <KeyRound aria-hidden className="size-3.5" />
            )}
            Trocar senha
          </button>
          {ok && (
            <span className="inline-flex items-center gap-1.5 text-xs text-success">
              <Check aria-hidden className="size-3.5" /> Senha alterada
            </span>
          )}
        </div>
      </form>
    </Panel>
  );
}

function AcessoCard({
  id,
  roles,
  email,
  ativo,
  desde,
}: {
  id: string;
  roles: string[];
  email: string | null;
  ativo: boolean;
  desde: string | null;
}) {
  return (
    <Panel title="Acesso e papéis">
      <div id={id} className="scroll-mt-24 space-y-4 px-5 py-5">
        <Linha rotulo="E-mail" valor={email ?? "—"} />
        <Linha rotulo="Situação" valor={ativo ? "Conta ativa" : "Conta desativada"} />
        <Linha
          rotulo="No sistema desde"
          valor={desde ? formatDateTime(desde) : "—"}
        />
        <div>
          <p className="ledger-eyebrow">Papéis</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {roles.length === 0 ? (
              <span className="text-sm text-ledger-muted">
                Nenhum papel atribuído. Peça liberação ao Master.
              </span>
            ) : (
              roles.map((r) => (
                <span
                  key={r}
                  className="rounded-lg border border-champagne px-2 py-0.5 text-[0.6875rem] uppercase tracking-[0.08em] text-bronze"
                >
                  {ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r}
                </span>
              ))
            )}
          </div>
        </div>
        <p className="text-xs text-ledger-muted">
          Papéis são concedidos apenas pelo Master e toda mudança fica registrada na
          auditoria.
        </p>
      </div>
    </Panel>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft pb-2">
      <span className="text-xs text-ledger-muted">{rotulo}</span>
      <span className="text-sm text-ledger-text">{valor}</span>
    </div>
  );
}

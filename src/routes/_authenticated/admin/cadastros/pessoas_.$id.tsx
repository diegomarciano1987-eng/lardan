import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, ShieldAlert, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatusBadge, formatDateTime } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { useCapabilities } from "@/lib/capabilities";
import {
  addRole,
  completude,
  findPossibleDuplicates,
  getParty,
  PARTY_ROLE_LABEL,
  PARTY_STATUS_LABEL,
  removeContact,
  removeRole,
  saveAddress,
  saveConsultant,
  saveContact,
  saveParty,
  type ConsultantProfile,
  type Party,
  type PartyRoleKind,
  type PartyStatus,
} from "@/lib/registry";
import { DOC_ESTADO_LABEL, docEstado, formatDoc, maskCepInput, maskDoc, maskDocInput, maskPhoneInput } from "@/lib/docs-br";
import { UFS } from "@/lib/catalog";

export const Route = createFileRoute("/_authenticated/admin/cadastros/pessoas_/$id")({
  component: FichaPessoa,
  head: () => ({
    meta: [
      { title: "Ficha do cadastro — Central de Cadastros LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function Campo({
  label,
  children,
  help,
}: {
  label: string;
  children: React.ReactNode;
  help?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-semibold text-ledger-text">{label}</span>
      {children}
      {help && <span className="text-xs font-medium text-ledger-muted">{help}</span>}
    </label>
  );
}

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

function FichaPessoa() {
  const { id } = Route.useParams();
  const caps = useCapabilities();
  const podeEditar = caps.includes("registry.manage");
  const podeVerDoc = caps.includes("registry.doc.view");
  const podeVerFin = caps.includes("registry.finance.view");
  const qc = useQueryClient();

  const query = useQuery({ queryKey: ["registry", "party", id], queryFn: () => getParty(id) });

  const [form, setForm] = useState<Partial<Party>>({});
  const [sujo, setSujo] = useState(false);

  useEffect(() => {
    if (query.data) {
      setForm(query.data.party);
      setSujo(false);
    }
  }, [query.data]);

  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  const set = <K extends keyof Party>(k: K, v: Party[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSujo(true);
  };

  const salvar = useMutation({
    mutationFn: async () => {
      await saveParty(
        {
          kind: form.kind ?? "pessoa",
          display_name: form.display_name?.trim() || null,
          legal_name: form.legal_name?.trim() || null,
          social_name: form.social_name?.trim() || null,
          doc: form.doc?.trim() || null,
          rg: form.rg?.trim() || null,
          rg_issuer: form.rg_issuer?.trim() || null,
          birth_date: form.birth_date || null,
          profession: form.profession?.trim() || null,
          marital_status: form.marital_status?.trim() || null,
          notes: form.notes?.trim() || null,
          status: form.status ?? "rascunho",
          is_active: form.is_active ?? true,
        },
        id,
      );
    },
    onSuccess: async () => {
      setSujo(false);
      toast.success("Cadastro salvo.");
      await qc.invalidateQueries({ queryKey: ["registry"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const duplicados = useQuery({
    queryKey: ["registry", "dups", id, form.doc],
    enabled: Boolean(form.doc),
    queryFn: () => findPossibleDuplicates({ doc: form.doc ?? null, ignoreId: id }),
  });

  const historico = useQuery({
    queryKey: ["registry", "hist", id],
    enabled: caps.includes("audit.view"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, entity, created_at, payload")
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const estadoDoc = docEstado(form.doc, (duplicados.data?.length ?? 0) > 0);

  const progresso = useMemo(() => {
    if (!query.data) return null;
    return completude({ party: { ...query.data.party, ...form } as Party, contatos: query.data.contatos, enderecos: query.data.enderecos });
  }, [query.data, form]);

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.error || !query.data) {
    return <ErrorState message={query.error instanceof Error ? query.error.message : "Cadastro não encontrado."} onRetry={() => void query.refetch()} />;
  }

  const d = query.data;
  const nome = form.display_name?.trim() || form.legal_name?.trim() || "Cadastro sem nome";

  return (
    <div className="space-y-6">
      <Link to="/admin/cadastros/pessoas" className="admin-link inline-flex items-center gap-1.5 text-sm">
        <ArrowLeft aria-hidden className="size-4" /> Pessoas e empresas
      </Link>

      <PageHeader
        eyebrow={`${d.party.code} · ${d.party.kind === "pessoa" ? "Pessoa" : "Empresa"}`}
        title={nome}
        description={`Última alteração em ${formatDateTime(d.party.updated_at)}. ${progresso?.pct ?? 0}% da ficha preenchida.`}
        actions={
          <>
            {sujo && <StatusBadge tone="warning">Alterações não salvas</StatusBadge>}
            {podeEditar && (
              <button type="button" className="btn-premium" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
                {salvar.isPending && <Loader2 aria-hidden className="size-4 animate-spin" />} Salvar
              </button>
            )}
          </>
        }
      />

      {(duplicados.data?.length ?? 0) > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-warning bg-surface p-4 shadow-sm">
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-semibold text-ledger-text">Possível duplicidade</p>
            <p className="text-sm font-medium text-ledger-muted">
              Este documento já aparece em {duplicados.data!.length} outro(s) cadastro(s). Nada é unido automaticamente — confira antes de continuar.
            </p>
            <ul className="mt-2 space-y-1">
              {duplicados.data!.map((p) => (
                <li key={p.id}>
                  <Link to="/admin/cadastros/pessoas/$id" params={{ id: p.id }} className="admin-link text-sm">
                    {p.display_name ?? p.legal_name ?? p.code} — {p.code}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Tabs defaultValue="resumo">
        <TabsList className="flex-wrap">
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="identificacao">Identificação</TabsTrigger>
          <TabsTrigger value="contatos">Contatos</TabsTrigger>
          <TabsTrigger value="enderecos">Endereços</TabsTrigger>
          <TabsTrigger value="comercial">Dados comerciais</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro / PIX</TabsTrigger>
          <TabsTrigger value="vinculos">Vínculos</TabsTrigger>
          <TabsTrigger value="operacao">Estoque e maletas</TabsTrigger>
          <TabsTrigger value="acesso">Acesso</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        {/* RESUMO */}
        <TabsContent value="resumo" className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Panel title="Completude da ficha">
            <div className="space-y-3 p-5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full bg-bronze" style={{ width: `${progresso?.pct ?? 0}%` }} />
              </div>
              <p className="num text-2xl font-semibold text-ledger-text">{progresso?.pct ?? 0}%</p>
              {progresso && progresso.faltando.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-ledger-text">Ainda falta</p>
                  <ul className="mt-1 list-disc pl-5 text-sm font-medium text-ledger-muted">
                    {progresso.faltando.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs font-medium text-ledger-muted">
                    Nada disso impede salvar. São apenas recomendações desta etapa.
                  </p>
                </div>
              ) : (
                <p className="text-sm font-medium text-ledger-muted">Ficha completa para a etapa atual.</p>
              )}
            </div>
          </Panel>

          <Panel title="Papéis desta pessoa">
            <div className="space-y-3 p-5">
              {d.papeis.length === 0 ? (
                <p className="text-sm font-medium text-ledger-muted">Nenhum papel atribuído ainda.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {d.papeis.map((p) => (
                    <li key={p.id} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ledger-text shadow-sm">
                      {PARTY_ROLE_LABEL[p.role]}
                      {podeEditar && (
                        <button
                          type="button"
                          aria-label={`Remover papel ${PARTY_ROLE_LABEL[p.role]}`}
                          onClick={async () => {
                            await removeRole(p.id);
                            await qc.invalidateQueries({ queryKey: ["registry"] });
                          }}
                          className="text-ledger-muted hover:text-danger"
                        >
                          <Trash2 aria-hidden className="size-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {podeEditar && (
                <AdicionarPapel
                  jaTem={d.papeis.map((p) => p.role)}
                  onAdd={async (role) => {
                    await addRole(id, role);
                    await qc.invalidateQueries({ queryKey: ["registry"] });
                    toast.success("Papel adicionado.");
                  }}
                />
              )}
            </div>
          </Panel>
        </TabsContent>

        {/* IDENTIFICAÇÃO */}
        <TabsContent value="identificacao" className="mt-4">
          <Panel title="Identificação">
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Campo label="Nome completo / razão social">
                <input
                  className={inputCls}
                  disabled={!podeEditar}
                  value={form.display_name ?? ""}
                  onChange={(e) => set("display_name", e.target.value)}
                  placeholder="Como a pessoa se chama"
                />
              </Campo>
              <Campo label="Nome social / nome fantasia">
                <input
                  className={inputCls}
                  disabled={!podeEditar}
                  value={form.social_name ?? ""}
                  onChange={(e) => set("social_name", e.target.value)}
                />
              </Campo>
              <Campo
                label="CPF / CNPJ"
                help={`Situação do documento: ${DOC_ESTADO_LABEL[estadoDoc]}. A validação é apenas estrutural — não consultamos nenhum órgão externo.`}
              >
                <input
                  className={inputCls}
                  disabled={!podeEditar}
                  value={podeVerDoc ? maskDocInput(form.doc ?? "") : maskDoc(form.doc)}
                  onChange={(e) => set("doc", maskDocInput(e.target.value))}
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                />
              </Campo>
              <Campo label="Situação do cadastro">
                <SmartSelect
                  disabled={!podeEditar}
                  value={form.status ?? "rascunho"}
                  onChange={(v) => set("status", v as PartyStatus)}
                  options={Object.entries(PARTY_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
                />
              </Campo>
              {form.kind === "pessoa" && (
                <>
                  <Campo label="RG / CNH">
                    <input className={inputCls} disabled={!podeEditar} value={form.rg ?? ""} onChange={(e) => set("rg", e.target.value)} />
                  </Campo>
                  <Campo label="Órgão emissor">
                    <input className={inputCls} disabled={!podeEditar} value={form.rg_issuer ?? ""} onChange={(e) => set("rg_issuer", e.target.value)} />
                  </Campo>
                  <Campo label="Nascimento">
                    <DateField
                      value={form.birth_date ?? ""}
                      onChange={(v) => set("birth_date", v || null)}
                      disabled={!podeEditar}
                    />
                  </Campo>
                  <Campo label="Profissão">
                    <input className={inputCls} disabled={!podeEditar} value={form.profession ?? ""} onChange={(e) => set("profession", e.target.value)} />
                  </Campo>
                  <Campo label="Estado civil">
                    <input className={inputCls} disabled={!podeEditar} value={form.marital_status ?? ""} onChange={(e) => set("marital_status", e.target.value)} />
                  </Campo>
                </>
              )}
              <Campo label="Cadastro ativo">
                <Switch checked={form.is_active ?? true} disabled={!podeEditar} onCheckedChange={(v) => set("is_active", v)} />
              </Campo>
              <div className="md:col-span-2">
                <Campo label="Observações">
                  <textarea
                    className={`${inputCls} h-24 py-2`}
                    disabled={!podeEditar}
                    value={form.notes ?? ""}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </Campo>
              </div>
            </div>
          </Panel>
        </TabsContent>

        {/* CONTATOS */}
        <TabsContent value="contatos" className="mt-4">
          <Panel title="Contatos">
            <div className="space-y-3 p-5">
              {d.contatos.length === 0 && (
                <p className="text-sm font-medium text-ledger-muted">Nenhum contato registrado.</p>
              )}
              <ul className="space-y-2">
                {d.contatos.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-lg border border-line-soft bg-surface px-3 py-2.5">
                    <span className="w-24 text-xs font-semibold tracking-[0.08em] text-bronze uppercase">{c.kind}</span>
                    <span className="num flex-1 text-sm font-medium text-ledger-text">{c.value}</span>
                    {podeEditar && (
                      <button
                        type="button"
                        aria-label="Remover contato"
                        onClick={async () => {
                          await removeContact(c.id);
                          await qc.invalidateQueries({ queryKey: ["registry"] });
                        }}
                        className="text-ledger-muted hover:text-danger"
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {podeEditar && (
                <NovoContato
                  onAdd={async (kind, value) => {
                    await saveContact(id, { kind, value });
                    await qc.invalidateQueries({ queryKey: ["registry"] });
                    toast.success("Contato adicionado.");
                  }}
                />
              )}
            </div>
          </Panel>
        </TabsContent>

        {/* ENDEREÇOS */}
        <TabsContent value="enderecos" className="mt-4">
          <Panel title="Endereço principal">
            <EnderecoForm
              partyId={id}
              inicial={d.enderecos[0] ?? null}
              podeEditar={podeEditar}
              onSaved={() => qc.invalidateQueries({ queryKey: ["registry"] })}
            />
          </Panel>
        </TabsContent>

        {/* COMERCIAL */}
        <TabsContent value="comercial" className="mt-4">
          {d.papeis.some((p) => p.role === "consultora") ? (
            <ConsultoraForm
              partyId={id}
              inicial={d.consultora}
              podeEditar={podeEditar}
              secao="comercial"
              onSaved={() => qc.invalidateQueries({ queryKey: ["registry"] })}
            />
          ) : (
            <Panel>
              <EmptyState
                title="Sem relacionamento comercial"
                description="Adicione o papel de consultora, representante ou revendedora no Resumo para liberar os dados comerciais."
              />
            </Panel>
          )}
        </TabsContent>

        {/* FINANCEIRO */}
        <TabsContent value="financeiro" className="mt-4">
          {!podeVerFin ? (
            <Panel>
              <EmptyState title="Acesso restrito" description="Seu perfil não tem permissão para ver dados financeiros deste cadastro." />
            </Panel>
          ) : d.papeis.some((p) => p.role === "consultora") ? (
            <ConsultoraForm
              partyId={id}
              inicial={d.consultora}
              podeEditar={podeEditar}
              secao="financeiro"
              onSaved={() => qc.invalidateQueries({ queryKey: ["registry"] })}
            />
          ) : (
            <Panel>
              <EmptyState title="Sem ficha financeira" description="Os dados de PIX e limite pertencem ao papel de consultora." />
            </Panel>
          )}
        </TabsContent>

        {/* VÍNCULOS */}
        <TabsContent value="vinculos" className="mt-4">
          <Panel title="Onde este cadastro é usado">
            <div className="p-5">
              {d.vinculos.length === 0 ? (
                <p className="text-sm font-medium text-ledger-muted">Nenhum módulo especializado usa este cadastro ainda.</p>
              ) : (
                <ul className="space-y-2 text-sm font-medium text-ledger-text">
                  {d.vinculos.map((v) => (
                    <li key={`${v.entity_type}-${v.entity_id}`} className="flex items-center gap-3">
                      <span className="w-40 text-xs font-semibold tracking-[0.08em] text-bronze uppercase">{v.entity_type}</span>
                      <span className="num text-xs text-ledger-muted">{v.entity_id}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs font-medium text-ledger-muted">
                Vendas, comissões, contas a receber e minisite aparecem aqui quando esses módulos entrarem no ar. Em implantação.
              </p>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="operacao" className="mt-4">
          <Panel title="Estoque e maletas">
            <EmptyState
              title="Em implantação"
              description="Maletas, peças sob custódia, acertos e devoluções dependem do motor de estoque. Nada é exibido aqui até existir movimento real."
            />
          </Panel>
        </TabsContent>

        <TabsContent value="acesso" className="mt-4">
          <Panel title="Acesso ao sistema">
            <div className="p-5">
              {d.vinculos.some((v) => v.entity_type === "profile") ? (
                <p className="text-sm font-medium text-ledger-text">
                  Esta pessoa tem um usuário de acesso vinculado. Papéis de acesso são administrados em{" "}
                  <Link to="/admin/usuarios" className="admin-link">
                    Usuários e papéis
                  </Link>
                  .
                </p>
              ) : (
                <p className="text-sm font-medium text-ledger-muted">
                  Nenhum login vinculado. Desvincular ou vincular um acesso nunca apaga a pessoa.
                </p>
              )}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <Panel title="Histórico e auditoria">
            <div className="p-5">
              {!caps.includes("audit.view") ? (
                <p className="text-sm font-medium text-ledger-muted">Seu perfil não consulta a auditoria.</p>
              ) : historico.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (historico.data?.length ?? 0) === 0 ? (
                <p className="text-sm font-medium text-ledger-muted">Sem registros de alteração.</p>
              ) : (
                <ul className="space-y-2">
                  {historico.data!.map((h) => (
                    <li key={h.id} className="flex items-center gap-3 text-sm">
                      <span className="num w-40 text-xs text-ledger-muted">{formatDateTime(h.created_at)}</span>
                      <span className="font-semibold text-ledger-text">{h.action}</span>
                      <span className="text-xs text-ledger-muted">{h.entity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AdicionarPapel({ jaTem, onAdd }: { jaTem: PartyRoleKind[]; onAdd: (r: PartyRoleKind) => Promise<void> }) {
  const [role, setRole] = useState<string>("");
  const disponiveis = (Object.keys(PARTY_ROLE_LABEL) as PartyRoleKind[]).filter((r) => !jaTem.includes(r));
  if (disponiveis.length === 0) return null;
  return (
    <div className="flex items-end gap-2">
      <SmartSelect
        className="flex-1"
        value={role}
        onChange={setRole}
        placeholder="Adicionar papel"
        options={disponiveis.map((r) => ({ value: r, label: PARTY_ROLE_LABEL[r] }))}
      />
      <button
        type="button"
        className="admin-btn"
        disabled={!role}
        onClick={async () => {
          await onAdd(role as PartyRoleKind);
          setRole("");
        }}
      >
        <Plus aria-hidden className="size-4" /> Adicionar
      </button>
    </div>
  );
}

function NovoContato({ onAdd }: { onAdd: (kind: "whatsapp" | "telefone" | "email", value: string) => Promise<void> }) {
  const [kind, setKind] = useState<"whatsapp" | "telefone" | "email">("whatsapp");
  const [valor, setValor] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <SmartSelect
        className="w-40"
        value={kind}
        onChange={(v) => setKind(v as typeof kind)}
        options={[
          { value: "whatsapp", label: "WhatsApp" },
          { value: "telefone", label: "Telefone" },
          { value: "email", label: "E-mail" },
        ]}
      />
      <input
        className={`${inputCls} w-64`}
        value={valor}
        onChange={(e) => setValor(kind === "email" ? e.target.value : maskPhoneInput(e.target.value))}
        placeholder={kind === "email" ? "nome@email.com" : "(00) 00000-0000"}
      />
      <button
        type="button"
        className="admin-btn"
        disabled={valor.trim().length < 5}
        onClick={async () => {
          await onAdd(kind, valor.trim());
          setValor("");
        }}
      >
        <Plus aria-hidden className="size-4" /> Adicionar contato
      </button>
    </div>
  );
}

function EnderecoForm({
  partyId,
  inicial,
  podeEditar,
  onSaved,
}: {
  partyId: string;
  inicial: { id?: string; [k: string]: unknown } | null;
  podeEditar: boolean;
  onSaved: () => void | Promise<unknown>;
}) {
  const [a, setA] = useState<Record<string, unknown>>(inicial ?? {});
  useEffect(() => setA(inicial ?? {}), [inicial]);
  const v = (k: string) => (a[k] as string) ?? "";
  const set = (k: string, val: unknown) => setA((s) => ({ ...s, [k]: val }));

  return (
    <div className="grid gap-4 p-5 md:grid-cols-2">
      <Campo label="CEP">
        <input className={inputCls} disabled={!podeEditar} value={maskCepInput(v("postal_code"))} onChange={(e) => set("postal_code", maskCepInput(e.target.value))} />
      </Campo>
      <Campo label="Logradouro">
        <input className={inputCls} disabled={!podeEditar} value={v("street")} onChange={(e) => set("street", e.target.value)} />
      </Campo>
      <Campo label="Número">
        <input className={inputCls} disabled={!podeEditar || Boolean(a["no_number"])} value={v("street_number")} onChange={(e) => set("street_number", e.target.value)} />
      </Campo>
      <Campo label="Sem número">
        <Switch checked={Boolean(a["no_number"])} disabled={!podeEditar} onCheckedChange={(x) => set("no_number", x)} />
      </Campo>
      <Campo label="Complemento">
        <input className={inputCls} disabled={!podeEditar} value={v("complement")} onChange={(e) => set("complement", e.target.value)} />
      </Campo>
      <Campo label="Bairro">
        <input className={inputCls} disabled={!podeEditar} value={v("district")} onChange={(e) => set("district", e.target.value)} />
      </Campo>
      <Campo label="Cidade">
        <input className={inputCls} disabled={!podeEditar} value={v("city")} onChange={(e) => set("city", e.target.value)} />
      </Campo>
      <Campo label="UF">
        <SmartSelect
          disabled={!podeEditar}
          value={v("uf")}
          onChange={(x) => set("uf", x)}
          options={UFS.map((u) => ({ value: u, label: u }))}
          placeholder="UF"
        />
      </Campo>
      <div className="md:col-span-2">
        <Campo label="Ponto de referência">
          <input className={inputCls} disabled={!podeEditar} value={v("reference")} onChange={(e) => set("reference", e.target.value)} />
        </Campo>
      </div>
      {podeEditar && (
        <div className="md:col-span-2">
          <button
            type="button"
            className="btn-premium"
            onClick={async () => {
              await saveAddress(partyId, a as never);
              await onSaved();
              toast.success("Endereço salvo.");
            }}
          >
            Salvar endereço
          </button>
        </div>
      )}
    </div>
  );
}

function ConsultoraForm({
  partyId,
  inicial,
  podeEditar,
  secao,
  onSaved,
}: {
  partyId: string;
  inicial: ConsultantProfile | null;
  podeEditar: boolean;
  secao: "comercial" | "financeiro";
  onSaved: () => void | Promise<unknown>;
}) {
  const [p, setP] = useState<Partial<ConsultantProfile>>(inicial ?? {});
  useEffect(() => setP(inicial ?? {}), [inicial]);
  const set = (k: keyof ConsultantProfile, v: unknown) => setP((s) => ({ ...s, [k]: v }));
  const v = (k: keyof ConsultantProfile) => (p[k] as string) ?? "";

  const comercial: [keyof ConsultantProfile, string][] = [
    ["origin", "Origem"],
    ["region", "Região"],
    ["wallet", "Carteira"],
    ["level", "Nível"],
    ["cycle", "Ciclo"],
    ["sale_profile", "Perfil de venda"],
    ["experience", "Experiência"],
    ["audience", "Público"],
    ["availability", "Disponibilidade"],
    ["block_reason", "Motivo de bloqueio ou desligamento"],
  ];

  const financeiro: [keyof ConsultantProfile, string][] = [
    ["pix_key_type", "Tipo de chave PIX"],
    ["pix_key", "Chave PIX"],
    ["pix_holder", "Titular"],
    ["pix_holder_doc", "Documento do titular"],
    ["bank_info", "Conta bancária (opcional)"],
    ["financial_status", "Situação financeira"],
    ["restricted_notes", "Observações restritas"],
  ];

  const campos = secao === "comercial" ? comercial : financeiro;

  return (
    <Panel title={secao === "comercial" ? "Relacionamento comercial" : "Financeiro e PIX"}>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        {secao === "comercial" && (
          <Campo label="Data de entrada">
            <DateField value={v("joined_at")} onChange={(x) => set("joined_at", x || null)} disabled={!podeEditar} />
          </Campo>
        )}
        {campos.map(([k, label]) => (
          <Campo key={String(k)} label={label}>
            <input className={inputCls} disabled={!podeEditar} value={v(k)} onChange={(e) => set(k, e.target.value)} />
          </Campo>
        ))}
        {podeEditar && (
          <div className="md:col-span-2">
            <button
              type="button"
              className="btn-premium"
              onClick={async () => {
                await saveConsultant(partyId, p);
                await onSaved();
                toast.success("Ficha da consultora salva.");
              }}
            >
              Salvar
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

export { formatDoc };

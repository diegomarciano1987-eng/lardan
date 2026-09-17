import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { PageHeader, Panel } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { useCapabilities } from "@/lib/capabilities";
import {
  addRole,
  saveAddress,
  saveContact,
  saveParty,
  PARTY_ROLE_LABEL,
  type PartyKind,
  type PartyRoleKind,
} from "@/lib/registry";
import { maskCepInput, maskPhoneInput } from "@/lib/docs-br";
import {
  formatarDocumento,
  normalizarDocumento,
  normalizarEmail,
  normalizarWhatsapp,
} from "@/lib/br/canonico";
import { consultarCep, consultarCnpj, listarMunicipios } from "@/lib/br/lookup.functions";
import { UFS } from "@/lib/catalog";

interface Busca {
  kind?: PartyKind | undefined;
  papel?: PartyRoleKind | undefined;
}

export const Route = createFileRoute("/_authenticated/admin/cadastros/pessoas_/novo")({
  validateSearch: (s: Record<string, unknown>): Busca => ({
    kind: s["kind"] === "organizacao" ? "organizacao" : "pessoa",
    papel: typeof s["papel"] === "string" ? (s["papel"] as PartyRoleKind) : undefined,
  }),
  component: NovoCadastro,
  head: () => ({
    meta: [
      { title: "Novo cadastro — Central de Cadastros LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

function Campo({
  label,
  children,
  help,
}: {
  label: string;
  children: React.ReactNode;
  help?: string | undefined;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-semibold text-ledger-text">{label}</span>
      {children}
      {help && <span className="text-xs font-medium text-ledger-muted">{help}</span>}
    </label>
  );
}

function dataParaIso(d?: Date): string | null {
  if (!d) return null;
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Formulário imediato de criação: nada é gravado antes de o usuário salvar. */
function NovoCadastro() {
  const { kind, papel } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const caps = useCapabilities();
  const podeEditar = caps.includes("registry.manage");

  const pessoa = kind !== "organizacao";
  const [form, setForm] = useState({
    display_name: "",
    social_name: "",
    doc: "",
    rg: "",
    profession: "",
    notes: "",
    whatsapp: "",
    email: "",
    postal_code: "",
    street: "",
    street_number: "",
    district: "",
    city: "",
    uf: "",
    ibge_city_code: "",
  });
  const [nascimento, setNascimento] = useState<Date | undefined>(undefined);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const consultarCepFn = useServerFn(consultarCep);
  const consultarCnpjFn = useServerFn(consultarCnpj);
  const listarMunicipiosFn = useServerFn(listarMunicipios);
  const [consultandoCep, setConsultandoCep] = useState(false);
  const [consultandoDoc, setConsultandoDoc] = useState(false);

  const municipios = useQuery({
    queryKey: ["ibge-municipios", form.uf],
    enabled: Boolean(form.uf),
    queryFn: async () => {
      const r = await listarMunicipiosFn({ data: { uf: form.uf } });
      if (r.status !== "ok") throw new Error(r.mensagem ?? "Municípios indisponíveis.");
      return r.dados ?? [];
    },
    staleTime: 1000 * 60 * 60 * 24,
  });

  async function conferirDocumento() {
    const c = normalizarDocumento(form.doc, pessoa ? "cpf" : "cnpj");
    set("doc", c.formatado);
    if (c.estado !== "valido") {
      toast.error(c.erro ?? "Documento inválido.");
      return;
    }
    if (pessoa) {
      toast.success(
        "CPF estruturalmente válido. Isso não comprova titularidade ou situação cadastral.",
      );
      return;
    }
    setConsultandoDoc(true);
    try {
      const r = await consultarCnpjFn({ data: { cnpj: c.canonico ?? "", comQsa: false } });
      if (r.status !== "ok" || !r.dados) throw new Error(r.mensagem ?? "CNPJ não localizado.");
      const d = r.dados;
      setForm((f) => ({
        ...f,
        doc: formatarDocumento(d.cnpj),
        display_name: d.razao_social ?? f.display_name,
        social_name: d.nome_fantasia ?? f.social_name,
        email: d.email ?? f.email,
        whatsapp: d.telefone ? maskPhoneInput(d.telefone) : f.whatsapp,
        postal_code: d.cep ? maskCepInput(d.cep) : f.postal_code,
        street: d.logradouro ?? f.street,
        street_number: d.numero ?? f.street_number,
        district: d.bairro ?? f.district,
        city: d.cidade ?? f.city,
        uf: d.uf ?? f.uf,
      }));
      toast.success(`Dados públicos preenchidos · fonte ${r.provider}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Consulta indisponível.");
    } finally {
      setConsultandoDoc(false);
    }
  }

  async function conferirCep() {
    setConsultandoCep(true);
    try {
      const r = await consultarCepFn({ data: { cep: form.postal_code } });
      if (r.status !== "ok" || !r.dados) throw new Error(r.mensagem ?? "CEP não localizado.");
      const d = r.dados;
      setForm((f) => ({
        ...f,
        postal_code: maskCepInput(d.cep),
        street: d.logradouro ?? f.street,
        district: d.bairro ?? f.district,
        city: d.cidade ?? f.city,
        uf: d.uf ?? f.uf,
        ibge_city_code: d.ibge ?? f.ibge_city_code,
      }));
      toast.success(`Endereço preenchido · fonte ${r.provider}${r.cache ? " (cache)" : ""}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Consulta indisponível. Preencha manualmente.");
    } finally {
      setConsultandoCep(false);
    }
  }

  const criar = useMutation({
    mutationFn: async () => {
      const nome = form.display_name.trim();
      if (!nome) throw new Error("Informe o nome para criar o cadastro.");
      const doc = normalizarDocumento(form.doc, pessoa ? "cpf" : "cnpj");
      if (form.doc.trim() && doc.estado !== "valido")
        throw new Error(doc.erro ?? "Documento inválido.");
      const whatsapp = normalizarWhatsapp(form.whatsapp);
      if (form.whatsapp.trim() && whatsapp.estado !== "valido")
        throw new Error(whatsapp.erro ?? "WhatsApp inválido.");
      const email = normalizarEmail(form.email);
      if (form.email.trim() && email.estado !== "valido")
        throw new Error(email.erro ?? "E-mail inválido.");
      const id = await saveParty({
        kind: pessoa ? "pessoa" : "organizacao",
        display_name: nome,
        social_name: form.social_name.trim() || null,
        doc: doc.canonico,
        rg: form.rg.trim() || null,
        birth_date: dataParaIso(nascimento),
        profession: form.profession.trim() || null,
        notes: form.notes.trim() || null,
        status: "em_analise",
        is_active: true,
      });
      if (papel) await addRole(id, papel);
      if (whatsapp.canonico)
        await saveContact(id, { kind: "whatsapp", value: whatsapp.canonico, is_primary: true });
      if (email.canonico) await saveContact(id, { kind: "email", value: email.canonico });
      if (form.city.trim() || form.street.trim() || form.postal_code.trim()) {
        await saveAddress(id, {
          label: "Principal",
          postal_code: form.postal_code.trim() || null,
          street: form.street.trim() || null,
          street_number: form.street_number.trim() || null,
          district: form.district.trim() || null,
          city: form.city.trim() || null,
          uf: form.uf || null,
          ibge_city_code: form.ibge_city_code || null,
          is_primary: true,
        });
      }
      return id;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ["registry"] });
      toast.success("Cadastro criado. Continue na ficha completa.");
      void navigate({ to: "/admin/cadastros/pessoas/$id", params: { id }, replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível criar."),
  });

  const titulo = papel ? PARTY_ROLE_LABEL[papel] : pessoa ? "Pessoa" : "Empresa";

  return (
    <div className="space-y-6">
      <Link
        to="/admin/cadastros/pessoas"
        className="admin-link inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft aria-hidden className="size-4" /> Pessoas e empresas
      </Link>

      <PageHeader
        eyebrow="Novo cadastro"
        title={titulo}
        description="Preencha e salve. Nada é gravado antes disso — depois de salvar você segue na ficha completa, com todas as abas."
        actions={
          podeEditar ? (
            <button
              type="button"
              className="admin-btn-primary"
              disabled={criar.isPending}
              onClick={() => criar.mutate()}
            >
              {criar.isPending && <Loader2 aria-hidden className="size-4 animate-spin" />} Criar
              cadastro
            </button>
          ) : null
        }
      />

      <Panel title="Identificação" flush>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <Campo label={pessoa ? "Nome completo" : "Razão social"}>
            <input
              className={inputCls}
              value={form.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              placeholder={pessoa ? "Como a pessoa se chama" : "Razão social"}
            />
          </Campo>
          <Campo label={pessoa ? "Nome social" : "Nome fantasia"}>
            <input
              className={inputCls}
              value={form.social_name}
              onChange={(e) => set("social_name", e.target.value)}
            />
          </Campo>
          <Campo
            label={pessoa ? "CPF" : "CNPJ"}
            help={
              pessoa
                ? "Validação matemática; não consulta titularidade ou situação na Receita."
                : "A lupa consulta os dados públicos da empresa."
            }
          >
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={form.doc}
                onChange={(e) =>
                  set("doc", normalizarDocumento(e.target.value, pessoa ? "cpf" : "cnpj").formatado)
                }
                inputMode={pessoa ? "numeric" : "text"}
              />
              <button
                type="button"
                className="admin-btn h-11 px-3"
                aria-label="Conferir documento"
                title="Conferir documento"
                disabled={consultandoDoc}
                onClick={() => void conferirDocumento()}
              >
                {consultandoDoc ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <Search aria-hidden className="size-4" />
                )}
              </button>
            </div>
          </Campo>
          {pessoa ? (
            <Campo label="RG">
              <input
                className={inputCls}
                value={form.rg}
                onChange={(e) => set("rg", e.target.value)}
              />
            </Campo>
          ) : (
            <div />
          )}
          {pessoa && (
            <>
              <Campo label="Data de nascimento">
                <DateField value={nascimento} onChange={setNascimento} />
              </Campo>
              <Campo label="Profissão">
                <input
                  className={inputCls}
                  value={form.profession}
                  onChange={(e) => set("profession", e.target.value)}
                />
              </Campo>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Contato" flush>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <Campo label="WhatsApp">
            <input
              className={inputCls}
              value={form.whatsapp}
              onChange={(e) => set("whatsapp", maskPhoneInput(e.target.value))}
              inputMode="tel"
              placeholder="(00) 00000-0000"
            />
          </Campo>
          <Campo label="E-mail">
            <input
              className={inputCls}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              inputMode="email"
            />
          </Campo>
        </div>
      </Panel>

      <Panel title="Endereço principal" flush>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <Campo label="CEP">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={form.postal_code}
                onChange={(e) => set("postal_code", maskCepInput(e.target.value))}
                onBlur={() => {
                  if (form.postal_code.replace(/\D/g, "").length === 8) void conferirCep();
                }}
                inputMode="numeric"
              />
              <button
                type="button"
                className="admin-btn h-11 px-3"
                aria-label="Consultar CEP"
                title="Consultar CEP"
                disabled={consultandoCep}
                onClick={() => void conferirCep()}
              >
                {consultandoCep ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <Search aria-hidden className="size-4" />
                )}
              </button>
            </div>
          </Campo>
          <Campo label="Rua">
            <input
              className={inputCls}
              value={form.street}
              onChange={(e) => set("street", e.target.value)}
            />
          </Campo>
          <Campo label="Número">
            <input
              className={inputCls}
              value={form.street_number}
              onChange={(e) => set("street_number", e.target.value)}
            />
          </Campo>
          <Campo label="Bairro">
            <input
              className={inputCls}
              value={form.district}
              onChange={(e) => set("district", e.target.value)}
            />
          </Campo>
          <Campo
            label="Cidade"
            help={
              municipios.isError ? "IBGE indisponível; digite a cidade manualmente." : undefined
            }
          >
            {form.uf && (municipios.data?.length ?? 0) > 0 ? (
              <SmartSelect
                options={(municipios.data ?? []).map((m) => ({
                  value: m.codigo_ibge,
                  label: m.nome,
                }))}
                value={form.ibge_city_code}
                onChange={(v) => {
                  const m = municipios.data?.find((item) => item.codigo_ibge === v);
                  setForm((f) => ({ ...f, ibge_city_code: v, city: m?.nome ?? f.city }));
                }}
                placeholder={
                  municipios.isLoading ? "Carregando municípios…" : "Selecione o município"
                }
              />
            ) : (
              <input
                className={inputCls}
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              />
            )}
          </Campo>
          <Campo label="Estado">
            <SmartSelect
              options={UFS.map((u) => ({ value: u, label: u }))}
              value={form.uf}
              onChange={(v) => setForm((f) => ({ ...f, uf: v, city: "", ibge_city_code: "" }))}
              placeholder="UF"
            />
          </Campo>
        </div>
      </Panel>

      <Panel title="Observações" flush>
        <div className="p-5">
          <textarea
            className="min-h-24 w-full rounded-[10px] border border-line bg-surface p-3 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>
      </Panel>

      <div className="flex justify-end">
        {podeEditar && (
          <button
            type="button"
            className="admin-btn-primary"
            disabled={criar.isPending}
            onClick={() => criar.mutate()}
          >
            {criar.isPending && <Loader2 aria-hidden className="size-4 animate-spin" />} Criar
            cadastro
          </button>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Panel } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { supabase } from "@/integrations/supabase/client";

/** Ficha da vendedora interna (equipe de balcão das lojas/PDV). */
type Ficha = Record<string, string | number | null>;
const db = supabase as unknown as { from: (t: string) => any };

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

function Campo({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-semibold text-ledger-text">{label}</span>
      {children}
      {help && <span className="text-xs font-medium text-ledger-muted">{help}</span>}
    </label>
  );
}

const iso = (d?: Date) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;
const deIso = (s: unknown) => (typeof s === "string" && s ? new Date(`${s}T12:00:00`) : undefined);

export function VendedoraInternaForm({
  partyId,
  podeEditar,
  podeVerFin,
}: {
  partyId: string;
  podeEditar: boolean;
  podeVerFin: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["registry", "vendedora", partyId],
    queryFn: async () => {
      const [f, u] = await Promise.all([
        db.from("vendedora_profiles").select("*").eq("party_id", partyId).maybeSingle(),
        db.from("pdv_unidades").select("id,nome,numero").order("nome"),
      ]);
      if (f.error) throw f.error;
      return { ficha: (f.data ?? null) as Ficha | null, lojas: (u.data ?? []) as { id: string; nome: string; numero: string | null }[] };
    },
  });
  const [p, setP] = useState<Ficha>({});
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setP(q.data?.ficha ?? { situacao: "ativa" }), [q.data]);
  const set = (k: string, v: string | number | null) => setP((s) => ({ ...s, [k]: v }));
  const v = (k: string) => (p[k] == null ? "" : String(p[k]));

  const salvar = async () => {
    const pct = v("comissao_padrao_pct").replace(",", ".");
    const meta = v("meta_mensal_cents");
    const payload = {
      ...p,
      party_id: partyId,
      comissao_padrao_pct: pct ? Number(pct) : null,
      meta_mensal_cents: meta ? Math.round(Number(meta)) : null,
      updated_at: new Date().toISOString(),
    };
    delete (payload as Ficha)["created_at"];
    if (payload.comissao_padrao_pct != null && !(payload.comissao_padrao_pct >= 0 && payload.comissao_padrao_pct <= 100)) {
      toast.error("Comissão deve ficar entre 0 e 100%.");
      return;
    }
    setSalvando(true);
    const { error } = await db.from("vendedora_profiles").upsert(payload, { onConflict: "party_id" });
    setSalvando(false);
    if (error) return toast.error(error.message);
    toast.success("Ficha da vendedora salva.");
    await qc.invalidateQueries({ queryKey: ["registry"] });
  };

  const metaReais = p["meta_mensal_cents"] != null ? (Number(p["meta_mensal_cents"]) / 100).toFixed(2).replace(".", ",") : "";

  return (
    <div className="space-y-4">
      <Panel title="Vendedora interna — loja e trabalho" flush>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <Campo label="Loja base" help="Ela ainda precisa ser adicionada à equipe da loja em Configurações → PDV Loja.">
            <SmartSelect
              value={v("unidade_base_id")}
              onChange={(x) => set("unidade_base_id", x || null)}
              disabled={!podeEditar}
              options={(q.data?.lojas ?? []).map((l) => ({ value: l.id, label: l.nome, hint: l.numero ? `Loja nº ${l.numero}` : "Sem número" }))}
            />
          </Campo>
          <Campo label="Situação">
            <SmartSelect
              value={v("situacao") || "ativa"}
              onChange={(x) => set("situacao", x)}
              disabled={!podeEditar}
              options={[
                { value: "ativa", label: "Ativa" },
                { value: "treinamento", label: "Em treinamento" },
                { value: "afastada", label: "Afastada" },
                { value: "desligada", label: "Desligada", hint: "Perde o acesso a todas as lojas" },
              ]}
            />
          </Campo>
          <Campo label="Data de início">
            <DateField value={deIso(p["admitida_em"])} onChange={(d) => set("admitida_em", iso(d))} />
          </Campo>
          <Campo label="Vínculo">
            <SmartSelect
              value={v("vinculo")}
              onChange={(x) => set("vinculo", x || null)}
              disabled={!podeEditar}
              options={[
                { value: "clt", label: "CLT" },
                { value: "pj", label: "PJ / MEI" },
                { value: "temporaria", label: "Temporária" },
                { value: "estagio", label: "Estágio" },
                { value: "outro", label: "Outro" },
              ]}
            />
          </Campo>
          <Campo label="Comissão padrão (%)" help="Referência. A comissão que vale na venda é a definida na equipe da loja.">
            <input className={inputCls} disabled={!podeEditar} value={v("comissao_padrao_pct").replace(".", ",")} onChange={(e) => set("comissao_padrao_pct", e.target.value)} placeholder="0,00" />
          </Campo>
          <Campo label="Meta mensal de referência (R$)">
            <input
              className={inputCls}
              disabled={!podeEditar}
              defaultValue={metaReais}
              key={metaReais}
              onBlur={(e) => { const n = Number(e.target.value.replace(/\./g, "").replace(",", ".")); set("meta_mensal_cents", e.target.value.trim() && n >= 0 ? Math.round(n * 100) : null); }}
              placeholder="0,00"
            />
          </Campo>
          <Campo label="Tamanho do uniforme">
            <input className={inputCls} disabled={!podeEditar} value={v("tamanho_uniforme")} onChange={(e) => set("tamanho_uniforme", e.target.value)} />
          </Campo>
          <div />
          <Campo label="Contato de emergência — nome">
            <input className={inputCls} disabled={!podeEditar} value={v("contato_emergencia_nome")} onChange={(e) => set("contato_emergencia_nome", e.target.value)} />
          </Campo>
          <Campo label="Contato de emergência — telefone">
            <input className={inputCls} disabled={!podeEditar} value={v("contato_emergencia_fone")} onChange={(e) => set("contato_emergencia_fone", e.target.value)} />
          </Campo>
          <div className="md:col-span-2">
            <Campo label="Observações">
              <textarea className={inputCls + " h-24 py-2"} disabled={!podeEditar} value={v("observacoes")} onChange={(e) => set("observacoes", e.target.value)} />
            </Campo>
          </div>
        </div>
      </Panel>

      {podeVerFin && (
        <Panel title="Pagamento de comissões (PIX)" flush>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Campo label="Tipo de chave PIX">
              <SmartSelect
                value={v("pix_key_type")}
                onChange={(x) => set("pix_key_type", x || null)}
                disabled={!podeEditar}
                options={[
                  { value: "cpf", label: "CPF" },
                  { value: "email", label: "E-mail" },
                  { value: "celular", label: "Celular" },
                  { value: "aleatoria", label: "Chave aleatória" },
                ]}
              />
            </Campo>
            <Campo label="Chave PIX"><input className={inputCls} disabled={!podeEditar} value={v("pix_key")} onChange={(e) => set("pix_key", e.target.value)} /></Campo>
            <Campo label="Titular"><input className={inputCls} disabled={!podeEditar} value={v("pix_holder")} onChange={(e) => set("pix_holder", e.target.value)} /></Campo>
            <Campo label="Conta bancária (opcional)"><input className={inputCls} disabled={!podeEditar} value={v("bank_info")} onChange={(e) => set("bank_info", e.target.value)} /></Campo>
          </div>
        </Panel>
      )}

      {podeEditar && (
        <button type="button" className="admin-btn-primary" disabled={salvando || q.isLoading} onClick={salvar}>
          {salvando && <Loader2 aria-hidden className="size-4 animate-spin" />} Salvar ficha da vendedora
        </button>
      )}
    </div>
  );
}

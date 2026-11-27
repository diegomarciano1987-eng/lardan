/**
 * 0332 — "Ficha completa": dados, endereço e todas as respostas do formulário (rep_candidata_ficha).
 * 0284 — no app do representante: sonho da candidata, perfil DISC, rede (alta/média/baixa) e acompanhamento.
 * Nunca mostra risco de acerto, restrição ou as respostas de organização (regra do documento do Daniel).
 * Daqui ele manda o link do teste no WhatsApp ou faz o teste com ela no próprio celular.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ClipboardCheck, IdCard, MapPin, MessageCircle } from "lucide-react";
import { fichaCandidata, type FichaCandidata } from "@/lib/rep-assinaturas";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TesteCandidatura } from "@/components/candidatura-teste/TesteCandidatura";
import { FATORES } from "@/lib/candidatura-teste/perguntas";
import { wa } from "@/components/representante/AcoesRepresentante";

type Perfil = {
  sonho: string | null; sonho_valor_cents: number | null; concluido_em: string | null; disc_perfil: string | null;
  disc_pct: Record<string, number> | null; rede: "alta" | "media" | "baixa" | null; acompanhamento: string | null;
  link_aberto: string | null; link_parte: number | null;
};
const REDE: Record<string, string> = { alta: "Rede alta", media: "Rede média", baixa: "Rede baixa" };
const url = (t: string) => `${window.location.origin}/candidatura/${t}`;

export function PerfilCandidata({ lead, nome, whatsapp }: { lead: string; nome: string; whatsapp: string | null }) {
  return (
    <>
      <FichaCompleta lead={lead} />
      <PerfilESonho lead={lead} nome={nome} whatsapp={whatsapp} />
    </>
  );
}

/** Rótulos amigáveis dos campos que o formulário do site manda; o resto aparece com o nome do campo. */
const CAMPO: Record<string, string> = {
  full_name: "Nome", name: "Nome", cpf: "CPF", whatsapp: "WhatsApp", phone: "Telefone", email: "E-mail",
  birth_date: "Nascimento", city: "Cidade", uf: "UF", postal_code: "CEP", street: "Rua", street_number: "Número", district: "Bairro",
  complement: "Complemento", reference: "Referência", financial_goal: "Quanto quer ganhar", availability: "Tempo disponível",
  experience: "Experiência com vendas", audience: "Para quem vai vender", motivation: "Por que quer ser Lardan", dream: "Sonho",
  dream_value_cents: "Valor do sonho", source: "Como conheceu", indicado_por: "Quem indicou", marital_status: "Estado civil",
  instagram: "Instagram", occupation: "Profissão", has_experience: "Já vendeu antes",
};
const OCULTAR = new Set(["tracking", "utm", "website", "honeypot", "captcha", "turnstile", "token", "privacy_version", "marketing_consent"]);
function valorCampo(k: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (k.endsWith("_cents") && typeof v === "number") return (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return null;
  return String(v);
}
const dataBr = (s: string | null) => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

/**
 * 0332 (Diego 17/11): o representante vê a ficha completa da candidata — dados, endereço (com mapa) e tudo
 * o que ela respondeu no formulário — para pegar o endereço e conferir se ela informou certo.
 */
function FichaCompleta({ lead }: { lead: string }) {
  const [aberto, setAberto] = React.useState(false);
  const q = useQuery({ queryKey: ["rep", "candidata-ficha", lead], enabled: aberto, queryFn: () => fichaCandidata(lead) });
  const f = q.data;
  return (
    <div className="mt-3 rounded-xl border border-border">
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-sm font-medium">
        <span className="flex items-center gap-2"><IdCard className="size-4" /> Ficha completa</span>
        <ChevronDown className={`size-4 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-border p-3 text-sm">
          {q.isLoading && <p className="text-muted-foreground">Carregando…</p>}
          {q.error && <p className="text-destructive">{(q.error as Error).message.includes("sem_permissao") ? "Esta candidata não está na sua carteira." : (q.error as Error).message}</p>}
          {f && <Ficha f={f} />}
        </div>
      )}
    </div>
  );
}

function Ficha({ f }: { f: FichaCandidata }) {
  const linhas = (pares: [string, string | null | undefined][]) => pares.filter(([, v]) => v);
  const endereco = [f.rua && `${f.rua}, ${f.sem_numero ? "s/n" : f.numero ?? ""}`, f.complemento, f.bairro, f.cidade && `${f.cidade}${f.uf ? `/${f.uf}` : ""}`, f.cep].filter(Boolean).join(" · ");
  const mapa = f.rua && f.cidade ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([f.rua, f.sem_numero ? "" : f.numero, f.bairro, f.cidade, f.uf].filter(Boolean).join(", "))}` : null;
  const respostas = Object.entries(f.respostas ?? {}).filter(([, v]) => v);
  const ultimo = f.envios.length ? f.envios[f.envios.length - 1]! : null;
  const jaMostrado = new Set(["full_name", "name", "first_name", "last_name", "no_number", "quem_indicou", "cpf", "whatsapp", "email", "postal_code", "street", "street_number", "district", "complement", "reference", "city", "uf", "financial_goal", "availability", "experience", "audience", "motivation", "dream", "dream_value_cents", "source"]);
  const extras = ultimo ? Object.entries(ultimo.respostas ?? {}).filter(([k]) => !OCULTAR.has(k) && !jaMostrado.has(k)).map(([k, v]) => [CAMPO[k] ?? k.replace(/_/g, " "), valorCampo(k, v)] as const).filter(([, v]) => v) : [];
  const Bloco = ({ titulo, itens }: { titulo: string; itens: readonly (readonly [string, string | null | undefined])[] }) => itens.length ? (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <dl className="space-y-2">
        {itens.map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="whitespace-pre-line break-words">{v}</dd></div>)}
      </dl>
    </div>
  ) : null;
  return (
    <>
      <Bloco titulo="Dados" itens={linhas([["Nome", f.nome], ["CPF", f.cpf], ["Nascimento", dataBr(f.nascimento)], ["RG", f.rg ? `${f.rg}${f.rg_orgao ? ` ${f.rg_orgao}` : ""}` : null], ["Estado civil", f.estado_civil], ["WhatsApp", f.whatsapp], ["E-mail", f.email], ["Quem indicou", f.indicado_por]])} />
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Endereço</p>
        {endereco ? <p className="break-words">{endereco}</p> : <p className="text-muted-foreground">Sem endereço informado.</p>}
        {f.referencia && <p className="text-muted-foreground">Referência: {f.referencia}</p>}
        {mapa && (
          <a href={mapa} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold">
            <MapPin className="size-4" /> Abrir no mapa
          </a>
        )}
      </div>
      <Bloco titulo="Respostas da candidatura" itens={respostas} />
      <Bloco titulo="Outras respostas do formulário" itens={extras} />
      {f.perfil_presencial?.em && <p className="text-xs text-muted-foreground">Perfil presencial feito em {dataBr(f.perfil_presencial.em)}.</p>}
      <p className="text-xs text-muted-foreground">
        {f.protocolo ? `Protocolo ${f.protocolo} · ` : ""}Enviada em {dataBr(f.enviada_em)}{f.envios.length > 1 ? ` · ${f.envios.length} envios` : ""}
      </p>
    </>
  );
}

function PerfilESonho({ lead, nome, whatsapp }: { lead: string; nome: string; whatsapp: string | null }) {
  const [aberto, setAberto] = React.useState(false);
  const [testeAqui, setTesteAqui] = React.useState(false);
  const qc = useQueryClient();
  const chave = ["rep", "candidata-perfil", lead];
  const q = useQuery({
    queryKey: chave, enabled: aberto,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rep_candidata_perfil", { _lead: lead });
      if (error) throw error;
      return data as unknown as Perfil;
    },
  });
  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("candidatura_teste_gerar", { _lead: lead });
      if (error) throw error;
      return (data as unknown as { token: string }).token;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: chave }),
    onError: (e: Error) => toast.error(e.message.includes("sem_permissao") ? "Esta candidata não está na sua carteira." : e.message),
  });
  const p = q.data;
  const primeiro = nome.split(" ")[0] ?? "";
  const token = p?.link_aberto ?? gerar.data ?? null;

  return (
    <div className="mt-3 rounded-xl border border-border">
      <button type="button" onClick={() => setAberto(!aberto)} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-sm font-medium">
        <span className="flex items-center gap-2"><ClipboardCheck className="size-4" /> Perfil e sonho</span>
        <ChevronDown className={`size-4 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-border p-3 text-sm">
          {q.isLoading && <p className="text-muted-foreground">Carregando…</p>}
          {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
          {p && (
            <>
              <p>{p.sonho ? <>Sonho: <strong>{p.sonho}</strong>{p.sonho_valor_cents ? ` · ${(Number(p.sonho_valor_cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}</> : <span className="text-muted-foreground">Ela ainda não contou o sonho.</span>}</p>
              {p.concluido_em ? (
                <div className="space-y-2">
                  <p><strong>Perfil {p.disc_perfil}</strong>{p.rede ? ` · ${REDE[p.rede]}` : ""}</p>
                  {p.disc_pct && FATORES.map((f) => (
                    <div key={f} className="grid grid-cols-[1.25rem_1fr_2.5rem] items-center gap-2 text-xs">
                      <strong>{f}</strong>
                      <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${p.disc_pct![f] ?? 0}%` }} /></div>
                      <span className="text-right tabular-nums text-muted-foreground">{p.disc_pct![f] ?? 0}%</span>
                    </div>
                  ))}
                  {p.acompanhamento && <p className="whitespace-pre-line text-muted-foreground">{p.acompanhamento}</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground">{p.link_aberto ? `Teste começado (parte ${Math.min(p.link_parte ?? 1, 3)} de 3), ainda sem concluir.` : "Ela ainda não fez o teste de perfil."}</p>
                  {token ? (
                    <div className="grid grid-cols-2 gap-2">
                      <a href={wa(whatsapp, `Olá, ${primeiro}! Aqui é da Lardan Semijoias. Este é o link do seu teste de candidatura, leva uns 10 minutos e fica salvo a cada tela: ${url(token)}`)}
                        target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-2 text-center text-sm font-semibold text-primary-foreground">
                        <MessageCircle className="size-4" /> Mandar no WhatsApp
                      </a>
                      <button type="button" onClick={() => setTesteAqui(true)} className="min-h-11 rounded-xl border border-border px-2 text-sm">Fazer aqui com ela</button>
                    </div>
                  ) : (
                    <button type="button" disabled={gerar.isPending} onClick={() => gerar.mutate()} className="min-h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
                      {gerar.isPending ? "Preparando…" : "Preparar o teste DISC"}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {token && (
        <Dialog open={testeAqui} onOpenChange={(v) => { setTesteAqui(v); if (!v) void qc.invalidateQueries({ queryKey: chave }); }}>
          <DialogContent className="h-[100dvh] max-h-[100dvh] w-full max-w-none overflow-y-auto rounded-none p-0 sm:h-[92dvh] sm:max-w-2xl sm:rounded-2xl">
            <DialogTitle className="sr-only">Teste de candidatura de {nome}</DialogTitle>
            <DialogDescription className="sr-only">A candidata responde no seu celular; as respostas são dela.</DialogDescription>
            <TesteCandidatura token={token} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

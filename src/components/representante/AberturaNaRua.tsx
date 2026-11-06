/**
 * 0251 — Abertura na rua, de uma vez só (Diego/Daniel, 06/11):
 *   1. Dados completos (os mesmos que o Daniel pede no cadastro) → 2. Perfil (4 perguntas)
 *   → 3. Escolher a maleta que está com o representante → 4. Contrato + promissória (ZapSign) → Concluída.
 * A decisão é de quem está na rua: não passa por aprovação do time interno.
 * Grava só por rep_abertura_rua_cadastrar e rep_maleta_repassar (carteira do representante, auditado).
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronLeft, CircleCheckBig, Loader2, MapPin, PackageOpen, UserPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { consultarCep } from "@/lib/br/lookup.functions";
import { brl, maletasDoRepresentante, mensagem, receberMaleta, repassarMaleta } from "@/lib/maletas-perdidas";
import { AssinaturaDigital } from "@/components/representante/AssinaturaDigital";

export const ESTADOS_CIVIS = ["Solteira", "Casada", "União estável", "Divorciada", "Viúva"] as const;
const PERGUNTAS = [
  { id: "metas", t: "Ela tem uma meta clara de quanto quer ganhar?" },
  { id: "comunicacao", t: "Ela conversa com facilidade e conhece muita gente?" },
  { id: "organizacao", t: "Ela parece organizada com dinheiro e compromissos?" },
  { id: "pontualidade", t: "Ela foi pontual e respondeu rápido até aqui?" },
];
const NOTAS = [{ v: 1, r: "Pouco" }, { v: 2, r: "Mais ou menos" }, { v: 3, r: "Muito" }];
const PASSOS = ["Dados", "Perfil", "Maleta", "Assinatura"];

const so = (v: string, n: number) => v.replace(/\D/g, "").slice(0, n);
const mCpf = (v: string) => so(v, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
const mFone = (v: string) => { const d = so(v, 11); return d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d; };
const mCep = (v: string) => so(v, 8).replace(/(\d{5})(\d)/, "$1-$2");
const mData = (v: string) => so(v, 8).replace(/(\d{2})(\d)/, "$1/$2").replace(/(\d{2})(\d)/, "$1/$2");

/** dd/mm/aaaa → aaaa-mm-dd, só se for uma data real. */
export function dataIso(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  if (!m) return null;
  const [, d, mo, a] = m;
  const dt = new Date(`${a}-${mo}-${d}T12:00:00Z`);
  return dt.getUTCDate() === Number(d) && dt.getUTCMonth() + 1 === Number(mo) ? `${a}-${mo}-${d}` : null;
}
export function cpfValido(v: string) {
  const d = v.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dig = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}

function Rot({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[0.78rem] font-medium text-muted-foreground">{t}</span>{children}</label>;
}

const VAZIO = { nome: "", cpf: "", nascimento: "", rg: "", rg_orgao: "", estado_civil: "", whatsapp: "", email: "", cep: "", rua: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", ibge: "" };
type Dados = typeof VAZIO;

/** O que ainda falta preencher, na ordem da tela (texto curto para o botão). */
export function faltando(f: Dados): string[] {
  const out: string[] = [];
  if (f.nome.trim().split(/\s+/).length < 2) out.push("nome completo");
  if (!cpfValido(f.cpf)) out.push("CPF válido");
  const iso = dataIso(f.nascimento);
  if (!iso) out.push("data de nascimento");
  else { const a = new Date(); a.setFullYear(a.getFullYear() - 18); if (new Date(iso) > a) out.push("ter 18 anos ou mais"); }
  if (!f.estado_civil) out.push("estado civil");
  if (so(f.whatsapp, 11).length !== 11) out.push("WhatsApp");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) out.push("e-mail");
  if (so(f.cep, 8).length !== 8) out.push("CEP");
  if (!f.rua.trim()) out.push("rua");
  if (!f.numero.trim()) out.push("número");
  if (!f.bairro.trim()) out.push("bairro");
  if (!f.cidade.trim() || f.uf.trim().length !== 2) out.push("cidade/UF");
  return out;
}

export function AberturaNaRua({ rep }: { rep: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm">
        <UserPlus className="size-4" /> Nova candidata
      </button>
      {aberto && <Fluxo rep={rep} onFechar={() => setAberto(false)} />}
    </>
  );
}

/** Candidata que já está na lista: mesmo fluxo, com nome, WhatsApp e cidade já preenchidos. */
export function AberturaDaCandidata({ rep, card }: { rep: string; card: { nome: string; whatsapp: string | null; cidade: string | null } }) {
  const [aberto, setAberto] = React.useState(false);
  const [cid, uf] = (card.cidade ?? "").split("/").map((x) => x.trim());
  const inicial = { ...VAZIO, nome: card.nome, whatsapp: mFone(card.whatsapp ?? ""), cidade: cid ?? "", uf: (uf ?? "").slice(0, 2).toUpperCase() };
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/5 text-sm font-semibold text-primary">
        <PackageOpen className="size-4" /> Fazer abertura
      </button>
      {aberto && <Fluxo rep={rep} inicial={inicial} onFechar={() => setAberto(false)} />}
    </>
  );
}

function Fluxo({ rep, onFechar, inicial }: { rep: string; onFechar: () => void; inicial?: Dados }) {
  const qc = useQueryClient();
  const [passo, setPasso] = React.useState(0);
  const [f, setF] = React.useState<Dados>(inicial ?? VAZIO);
  const [perfil, setPerfil] = React.useState<Record<string, number>>({});
  const [feito, setFeito] = React.useState<{ lead_id: string; party_id: string; perfil: string } | null>(null);
  const [maleta, setMaleta] = React.useState<{ cycle_id: string; nome: string } | null>(null);
  const cepFn = useServerFn(consultarCep);
  const [buscandoCep, setBuscandoCep] = React.useState(false);

  const set = (k: keyof Dados, map: (v: string) => string = (v) => v) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: map(e.target.value) }));
  const falta = faltando(f);

  async function puxarCep(cep: string) {
    if (so(cep, 8).length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await cepFn({ data: { cep } });
      if (r.status === "ok" && r.dados) {
        const d = r.dados;
        setF((x) => ({ ...x, rua: d.logradouro || x.rua, bairro: d.bairro || x.bairro, cidade: d.cidade || x.cidade, uf: d.uf || x.uf, ibge: d.ibge ?? x.ibge }));
      } else toast.error("CEP não encontrado. Preencha o endereço à mão.");
    } catch { toast.error("Não consegui consultar o CEP agora. Preencha à mão."); }
    finally { setBuscandoCep(false); }
  }

  const cadastrar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("rep_abertura_rua_cadastrar" as never, {
        _rep: rep, _dados: { ...f, nascimento: dataIso(f.nascimento) }, _perfil: perfil,
      } as never);
      if (error) throw new Error(error.message);
      return data as unknown as { lead_id: string; party_id: string; perfil: string };
    },
    onSuccess: (r) => { setFeito(r); setPasso(2); toast.success(`${primeiroNome(f.nome)} cadastrada. ${r.perfil}.`); void qc.invalidateQueries({ queryKey: ["rep", rep, "crm"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const ok1 = falta.length === 0;
  const ok2 = Object.keys(perfil).length === PERGUNTAS.length;
  const campo = "h-12 w-full rounded-xl border border-border bg-background px-3.5 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-label="Nova candidata" data-tela-cheia="">
      <header className="border-b border-border px-5 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <button type="button" aria-label="Voltar" disabled={passo === 0 || passo >= 2} onClick={() => setPasso((p) => p - 1)}
            className="grid size-10 place-items-center rounded-full border border-border disabled:invisible"><ChevronLeft className="size-5" /></button>
          <p className="text-base font-semibold">{feito ? primeiroNome(f.nome) : "Nova candidata"}</p>
          <button type="button" aria-label="Fechar" onClick={onFechar} className="grid size-10 place-items-center rounded-full border border-border"><X className="size-4" /></button>
        </div>
        <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Etapas">
          {PASSOS.map((p, i) => (
            <li key={p} className="space-y-1">
              <div className={`h-1.5 rounded-full ${i <= passo ? "bg-primary" : "bg-muted"}`} />
              <p className={`text-center text-[0.7rem] ${i === passo ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{i + 1}. {p}</p>
            </li>
          ))}
        </ol>
      </header>

      <main className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto max-w-md space-y-5">
          {passo === 0 && (
            <>
              <Bloco titulo="Quem é ela">
                <Rot t="Nome completo"><input className={campo} autoComplete="off" value={f.nome} onChange={set("nome")} /></Rot>
                <div className="grid grid-cols-2 gap-3">
                  <Rot t="CPF"><input className={campo} inputMode="numeric" placeholder="000.000.000-00" value={f.cpf} onChange={set("cpf", mCpf)} /></Rot>
                  <Rot t="Nascimento"><input className={campo} inputMode="numeric" placeholder="dd/mm/aaaa" value={f.nascimento} onChange={set("nascimento", mData)} /></Rot>
                </div>
                <div className="grid grid-cols-[1fr_7rem] gap-3">
                  <Rot t="RG (opcional)"><input className={campo} value={f.rg} onChange={set("rg")} /></Rot>
                  <Rot t="Órgão"><input className={campo} placeholder="SSP/SP" value={f.rg_orgao} onChange={set("rg_orgao", (v) => v.toUpperCase())} /></Rot>
                </div>
                <div>
                  <span className="mb-1.5 block text-[0.78rem] font-medium text-muted-foreground">Estado civil</span>
                  <div className="flex flex-wrap gap-2">
                    {ESTADOS_CIVIS.map((e) => (
                      <button key={e} type="button" onClick={() => setF((x) => ({ ...x, estado_civil: e }))}
                        className={`h-10 rounded-full border px-4 text-sm ${f.estado_civil === e ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{e}</button>
                    ))}
                  </div>
                </div>
              </Bloco>
              <Bloco titulo="Contato">
                <Rot t="WhatsApp"><input className={campo} inputMode="tel" placeholder="(43) 99999-9999" value={f.whatsapp} onChange={set("whatsapp", mFone)} /></Rot>
                <Rot t="E-mail"><input className={campo} type="email" inputMode="email" autoCapitalize="none" value={f.email} onChange={set("email", (v) => v.trim())} /></Rot>
              </Bloco>
              <Bloco titulo="Endereço" icone={<MapPin className="size-4" />}>
                <Rot t="CEP">
                  <div className="relative">
                    <input className={campo} inputMode="numeric" placeholder="00000-000" value={f.cep}
                      onChange={(e) => { const v = mCep(e.target.value); setF((x) => ({ ...x, cep: v })); if (so(v, 8).length === 8) void puxarCep(v); }} />
                    {buscandoCep && <Loader2 className="absolute right-3 top-3.5 size-5 animate-spin text-muted-foreground" />}
                  </div>
                </Rot>
                <Rot t="Rua"><input className={campo} value={f.rua} onChange={set("rua")} /></Rot>
                <div className="grid grid-cols-[6rem_1fr] gap-3">
                  <Rot t="Número"><input className={campo} inputMode="numeric" value={f.numero} onChange={set("numero")} /></Rot>
                  <Rot t="Complemento"><input className={campo} placeholder="Opcional" value={f.complemento} onChange={set("complemento")} /></Rot>
                </div>
                <Rot t="Bairro"><input className={campo} value={f.bairro} onChange={set("bairro")} /></Rot>
                <div className="grid grid-cols-[1fr_5rem] gap-3">
                  <Rot t="Cidade"><input className={campo} value={f.cidade} onChange={set("cidade")} /></Rot>
                  <Rot t="UF"><input className={campo} maxLength={2} value={f.uf} onChange={set("uf", (v) => v.toUpperCase().replace(/[^A-Z]/g, ""))} /></Rot>
                </div>
              </Bloco>
            </>
          )}

          {passo === 1 && (
            <Bloco titulo={`Perfil de ${primeiroNome(f.nome)}`}>
              <p className="-mt-1 text-sm text-muted-foreground">Responda pelo que você viu na conversa. Quem decide é você.</p>
              {PERGUNTAS.map((p, i) => (
                <div key={p.id} className="rounded-2xl border border-border p-4">
                  <p className="text-sm font-medium"><span className="text-muted-foreground">{i + 1}.</span> {p.t}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {NOTAS.map((n) => (
                      <button key={n.v} type="button" onClick={() => setPerfil({ ...perfil, [p.id]: n.v })}
                        className={`h-11 rounded-xl border text-sm ${perfil[p.id] === n.v ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border"}`}>{n.r}</button>
                    ))}
                  </div>
                </div>
              ))}
            </Bloco>
          )}

          {passo === 2 && feito && <EscolherMaleta rep={rep} leadId={feito.lead_id} nome={f.nome} onEscolhida={(m) => { setMaleta(m); setPasso(3); }} />}
          {passo === 3 && feito && <Assinaturas rep={rep} party={feito.party_id} maleta={maleta} nome={f.nome} />}
        </div>
      </main>

      {passo < 2 && (
        <footer className="border-t border-border bg-background px-5 py-3">
          <div className="mx-auto max-w-md">
            {passo === 0 && (
              <button type="button" disabled={!ok1} onClick={() => setPasso(1)} className="h-13 min-h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {ok1 ? "Continuar para o perfil" : `Falta: ${falta.slice(0, 3).join(", ")}${falta.length > 3 ? "…" : ""}`}
              </button>
            )}
            {passo === 1 && (
              <button type="button" disabled={!ok2 || cadastrar.isPending} onClick={() => cadastrar.mutate()} className="min-h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {cadastrar.isPending ? "Salvando…" : ok2 ? "Salvar e escolher a maleta" : "Responda as 4 perguntas"}
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

function Bloco({ titulo, icone, children }: { titulo: string; icone?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3.5 rounded-3xl border border-border bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{icone}{titulo}</h3>
      {children}
    </section>
  );
}

function EscolherMaleta({ rep, leadId, nome, onEscolhida }: { rep: string; leadId: string; nome: string; onEscolhida: (m: { cycle_id: string; nome: string }) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rep", rep, "maletas"], queryFn: () => maletasDoRepresentante(rep) });
  const [sel, setSel] = React.useState<string | null>(null);
  const receber = useMutation({ mutationFn: (t: string) => receberMaleta(t), onSuccess: () => { toast.success("Recebimento confirmado."); void qc.invalidateQueries({ queryKey: ["rep", rep, "maletas"] }); }, onError: (e) => toast.error(mensagem(e)) });
  const passar = useMutation({
    mutationFn: () => repassarMaleta(rep, sel!, { tipo: "candidata", id: leadId, nome, codigo: null, cidade: null }),
    onSuccess: () => {
      const m = q.data!.sem_consultora.find((x) => x.cycle_id === sel)!;
      toast.success(`Maleta ${m.maleta} agora é de ${primeiroNome(nome)}.`);
      void qc.invalidateQueries({ queryKey: ["rep", rep] });
      onEscolhida({ cycle_id: m.cycle_id, nome: m.maleta });
    },
    onError: (e) => toast.error(mensagem(e)),
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando suas maletas…</p>;
  if (q.error) return <p className="text-sm text-destructive">{mensagem(q.error)}</p>;
  const d = q.data!;
  return (
    <Bloco titulo="Qual maleta fica com ela" icone={<PackageOpen className="size-4" />}>
      {d.a_receber.map((m) => (
        <div key={m.transfer_id} className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border p-4">
          <div><p className="font-medium">{m.maleta}</p><p className="text-xs text-muted-foreground">A caminho de você · {m.pecas} peças</p></div>
          <button type="button" disabled={receber.isPending} onClick={() => receber.mutate(m.transfer_id)} className="h-10 rounded-xl border border-border px-3 text-sm">Recebi</button>
        </div>
      ))}
      {d.sem_consultora.length === 0 && (
        <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
          Nenhuma maleta de abertura com você agora. O cadastro dela já está salvo: quando a maleta chegar, abra a candidata na lista e continue daqui.
        </p>
      )}
      <div className="space-y-2">
        {d.sem_consultora.map((m) => (
          <button key={m.cycle_id} type="button" onClick={() => setSel(m.cycle_id)}
            className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left ${sel === m.cycle_id ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border"}`}>
            <div>
              <p className="font-semibold">{m.maleta}</p>
              <p className="text-xs text-muted-foreground">{m.pecas} peças · {brl(m.valor_cents)}{m.remessa ? ` · remessa ${m.remessa}` : ""}</p>
            </div>
            <span className={`grid size-7 place-items-center rounded-full border ${sel === m.cycle_id ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{sel === m.cycle_id && <Check className="size-4" />}</span>
          </button>
        ))}
      </div>
      {d.sem_consultora.length > 0 && (
        <button type="button" disabled={!sel || passar.isPending} onClick={() => passar.mutate()} className="min-h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {passar.isPending ? "Vinculando…" : "Deixar esta maleta com ela"}
        </button>
      )}
    </Bloco>
  );
}

function Assinaturas({ rep, party, maleta, nome }: { rep: string; party: string; maleta: { cycle_id: string; nome: string } | null; nome: string }) {
  const q = useQuery({
    queryKey: ["assinaturas", party],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("assinaturas_da_consultora" as never, { _party: party, _rep: rep } as never);
      if (error) throw error;
      return data as unknown as { documentos: { tipo: string; status: string; cycle_id: string | null }[] };
    },
    refetchInterval: 15_000,
  });
  const docs = q.data?.documentos ?? [];
  const contrato = docs.some((d) => d.tipo === "contrato" && d.status === "assinado");
  const promissoria = docs.some((d) => d.tipo === "promissoria" && d.status === "assinado" && (!maleta || d.cycle_id === maleta.cycle_id));
  const concluida = contrato && promissoria;
  return (
    <div className="space-y-4">
      {concluida ? (
        <div className="rounded-3xl border border-primary/30 bg-primary/5 p-6 text-center">
          <CircleCheckBig className="mx-auto size-12 text-primary" />
          <p className="mt-3 text-lg font-semibold">Abertura concluída</p>
          <p className="mt-1 text-sm text-muted-foreground">{primeiroNome(nome)} assinou o contrato e a promissória{maleta ? ` da maleta ${maleta.nome}` : ""}.</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-muted/60 p-4 text-sm">
          <p className="font-semibold">Último passo: as assinaturas</p>
          <p className="mt-1 text-muted-foreground">Mande o contrato e a promissória. Ela assina pelo celular, ali na sua frente. Esta tela atualiza sozinha.</p>
          <div className="mt-3 flex gap-2 text-xs">
            <Selo ok={contrato} t="Contrato" /><Selo ok={promissoria} t="Promissória" />
          </div>
        </div>
      )}
      <AssinaturaDigital party={party} rep={rep} />
    </div>
  );
}
function Selo({ ok, t }: { ok: boolean; t: string }) {
  return <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${ok ? "bg-primary text-primary-foreground" : "border border-border bg-background"}`}>{ok && <Check className="size-3" />}{t}{ok ? " assinado" : " pendente"}</span>;
}
const primeiroNome = (n: string) => { const p = (n.trim().split(/\s+/)[0] ?? "").toLowerCase(); return p.charAt(0).toUpperCase() + p.slice(1); };

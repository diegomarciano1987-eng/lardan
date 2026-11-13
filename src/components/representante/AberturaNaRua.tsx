/**
 * 0251 — Abertura na rua, de uma vez só (Diego/Daniel, 06/11):
 *   1. Dados completos (os mesmos que o Daniel pede no cadastro) → 2. Perfil (4 perguntas)
 *   → 3. Escolher a maleta que está com o representante → 4. Contrato + promissória (ZapSign) → Concluída.
 * A decisão é de quem está na rua: não passa por aprovação do time interno.
 * Grava só por rep_abertura_rua_cadastrar e rep_maleta_repassar (carteira do representante, auditado).
 *
 * 0300 (Diego, 12/11/2026): o fluxo nunca mais fecha sozinho nem perde o que foi digitado.
 *   Antes ele vivia dentro do cartão da candidata; ao ligar a maleta (etapa 3 → 4) ela ia para
 *   "Com maleta", o cartão sumia da lista e o fluxo fechava junto. Agora o fluxo é aberto por um
 *   anfitrião fixo da tela do representante (AberturaHost) e o rascunho fica guardado no aparelho
 *   (24 h) a cada toque: sair, trocar de aplicativo para o WhatsApp ou recarregar a página e voltar
 *   continua exatamente de onde parou. O rascunho só é apagado quando as duas assinaturas terminam
 *   ou quando o representante toca em "Descartar".
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronLeft, CircleCheckBig, Loader2, MapPin, PackageOpen, UserPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { consultarCep } from "@/lib/br/lookup.functions";
import { brl, maletasDoRepresentante, mensagem, receberMaleta, repassarMaleta, rotuloAbertura, trocarDestinoMaleta } from "@/lib/maletas-perdidas";
import { AssinaturaDigital } from "@/components/representante/AssinaturaDigital";
import { CONTATOS_VAZIOS, CamposContatosRef, conferirContatos, contatosPreenchidos, salvarContatosRef, type ContatosRef } from "@/components/admin/ContatosRecado";

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

// ---------------------------------------------------------------- rascunho guardado no aparelho (0300)
type Feito = { lead_id: string; party_id: string; perfil: string };
type MaletaEscolhida = { cycle_id: string; nome: string };
export type Rascunho = {
  v: 1; rep: string; chave: string; passo: number; f: Dados; perfil: Record<string, number>;
  feito: Feito | null; maleta: MaletaEscolhida | null; salvo_em: number;
};
const VALIDADE_MS = 24 * 60 * 60 * 1000;
const chaveStorage = (rep: string) => `lardan:abertura-rua:${rep}`;
/** Quem é a candidata do rascunho: "nova" para "Nova candidata", senão os dígitos do WhatsApp (ou o nome). */
export const chaveCandidata = (card?: { nome: string; whatsapp: string | null }) =>
  card ? (so(card.whatsapp ?? "", 11) || card.nome.trim().toLowerCase()) : "nova";

export function lerRascunho(rep: string, agora = Date.now()): Rascunho | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(chaveStorage(rep));
    if (!raw) return null;
    const r = JSON.parse(raw) as Rascunho;
    if (r?.v !== 1 || r.rep !== rep || typeof r.salvo_em !== "number" || agora - r.salvo_em > VALIDADE_MS) {
      window.localStorage.removeItem(chaveStorage(rep));
      return null;
    }
    return { ...r, f: { ...VAZIO, ...r.f } };
  } catch { return null; }
}
export function gravarRascunho(r: Rascunho) {
  try { window.localStorage.setItem(chaveStorage(r.rep), JSON.stringify(r)); } catch { /* aparelho sem espaço: segue sem guardar */ }
}
export function apagarRascunho(rep: string) {
  try { window.localStorage.removeItem(chaveStorage(rep)); } catch { /* nada */ }
  avisar();
}
/** Há algo que valha guardar? (qualquer campo digitado além do que veio da lista, ou já passou da etapa 1) */
export function rascunhoTemConteudo(r: Pick<Rascunho, "passo" | "f" | "perfil" | "feito">, inicial: Dados = VAZIO) {
  if (r.passo > 0 || r.feito || Object.keys(r.perfil).length > 0) return true;
  return (Object.keys(VAZIO) as (keyof Dados)[]).some((k) => (r.f[k] ?? "") !== (inicial[k] ?? ""));
}

// ---------------------------------------------------------------- anfitrião fixo do fluxo (0300)
type Ativo = { rep: string; chave: string; inicial: Dados } | null;
let ativo: Ativo = null;
const ouvintes = new Set<() => void>();
function avisar() { for (const o of ouvintes) o(); }
function abrir(rep: string, chave: string, inicial: Dados) {
  const atual = lerRascunho(rep);
  if (atual && atual.chave !== chave && rascunhoTemConteudo(atual)) {
    const quem = primeiroNome(atual.f.nome) || "outra candidata";
    if (!window.confirm(`Você tem uma abertura em andamento de ${quem}, com os dados guardados.\n\nOK = começar esta nova e descartar a de ${quem}.\nCancelar = continuar a de ${quem}.`)) {
      ativo = { rep, chave: atual.chave, inicial: atual.f };
      avisar();
      return;
    }
    apagarRascunho(rep);
  }
  ativo = { rep, chave, inicial };
  avisar();
}
function fechar() { ativo = null; avisar(); }
function useAtivo() {
  return React.useSyncExternalStore(
    (cb) => { ouvintes.add(cb); return () => { ouvintes.delete(cb); }; },
    () => ativo,
    () => null,
  );
}

/**
 * Fica montado na tela do representante o tempo todo (fora das listas): mostra o fluxo aberto e,
 * se existe abertura guardada no aparelho, a faixa "Continuar a abertura de …".
 */
export function AberturaHost({ rep }: { rep: string }) {
  const a = useAtivo();
  const [rascunho, setRascunho] = React.useState<Rascunho | null>(null);
  React.useEffect(() => {
    const ler = () => setRascunho(lerRascunho(rep));
    ler();
    ouvintes.add(ler);
    window.addEventListener("storage", ler);
    return () => { ouvintes.delete(ler); window.removeEventListener("storage", ler); };
  }, [rep]);
  if (a && a.rep === rep) return <Fluxo key={a.chave} rep={rep} chave={a.chave} inicial={a.inicial} onFechar={fechar} />;
  if (!rascunho || !rascunhoTemConteudo(rascunho)) return null;
  const nome = primeiroNome(rascunho.f.nome) || "candidata";
  return (
    <div role="status" className="fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-primary/40 bg-card p-3 shadow-lg md:bottom-6 md:right-6 md:left-auto">
      <PackageOpen className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">Abertura de {nome} em andamento</p>
        <p className="text-xs text-muted-foreground">Etapa {Math.min(rascunho.passo, 3) + 1} de 4 · dados guardados</p>
      </div>
      <button type="button" onClick={() => { if (window.confirm(`Descartar os dados guardados da abertura de ${nome}?`)) apagarRascunho(rep); }}
        className="min-h-11 shrink-0 rounded-xl px-2 text-xs text-muted-foreground underline">Descartar</button>
      <button type="button" onClick={() => { ativo = { rep, chave: rascunho.chave, inicial: rascunho.f }; avisar(); }}
        className="min-h-11 shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Continuar</button>
    </div>
  );
}

export function AberturaNaRua({ rep }: { rep: string }) {
  return (
    <button type="button" onClick={() => abrir(rep, chaveCandidata(), VAZIO)} className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm">
      <UserPlus className="size-4" /> Nova candidata
    </button>
  );
}

/** Candidata que já está na lista: mesmo fluxo, com nome, WhatsApp e cidade já preenchidos. */
export function AberturaDaCandidata({ rep, card }: { rep: string; card: { nome: string; whatsapp: string | null; cidade: string | null } }) {
  const [cid, uf] = (card.cidade ?? "").split("/").map((x) => x.trim());
  const inicial = { ...VAZIO, nome: card.nome, whatsapp: mFone(card.whatsapp ?? ""), cidade: cid ?? "", uf: (uf ?? "").slice(0, 2).toUpperCase() };
  return (
    <button type="button" onClick={() => abrir(rep, chaveCandidata(card), inicial)} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/5 text-sm font-semibold text-primary">
      <PackageOpen className="size-4" /> Fazer abertura
    </button>
  );
}

function Fluxo({ rep, chave, onFechar, inicial }: { rep: string; chave: string; onFechar: () => void; inicial: Dados }) {
  const qc = useQueryClient();
  // 0300: começa do rascunho guardado desta mesma candidata, se houver
  const [guardado] = React.useState(() => { const r = lerRascunho(rep); return r && r.chave === chave ? r : null; });
  const [passo, setPasso] = React.useState(guardado?.passo ?? 0);
  const [f, setF] = React.useState<Dados>(guardado?.f ?? inicial);
  const [perfil, setPerfil] = React.useState<Record<string, number>>(guardado?.perfil ?? {});
  const [feito, setFeito] = React.useState<Feito | null>(guardado?.feito ?? null);
  const [maleta, setMaleta] = React.useState<MaletaEscolhida | null>(guardado?.maleta ?? null);
  const [contatosRef, setContatosRef] = React.useState<ContatosRef>(CONTATOS_VAZIOS);
  const concluidaRef = React.useRef(false);
  React.useEffect(() => {
    if (concluidaRef.current) return;
    const r = { passo, f, perfil, feito };
    if (rascunhoTemConteudo(r, inicial)) gravarRascunho({ v: 1, rep, chave, passo, f, perfil, feito, maleta, salvo_em: Date.now() });
  }, [rep, chave, passo, f, perfil, feito, maleta, inicial]);
  const concluir = React.useCallback(() => { concluidaRef.current = true; apagarRascunho(rep); }, [rep]);
  const sair = () => {
    if (!concluidaRef.current && rascunhoTemConteudo({ passo, f, perfil, feito }, inicial))
      toast.success("Dados guardados neste aparelho. Toque em Continuar para seguir de onde parou.");
    onFechar();
  };
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
      const erroRef = conferirContatos(contatosRef);
      if (erroRef) throw new Error(erroRef);
      const { data, error } = await supabase.rpc("rep_abertura_rua_cadastrar" as never, {
        _rep: rep, _dados: { ...f, nascimento: dataIso(f.nascimento) }, _perfil: perfil,
      } as never);
      if (error) throw new Error(error.message);
      const r = data as unknown as { lead_id: string; party_id: string; perfil: string };
      // 0315: recado e referência (opcionais) — falha aqui não desfaz o cadastro, só avisa
      if (contatosPreenchidos(contatosRef)) {
        await salvarContatosRef(r.party_id, contatosRef).catch((e: Error) => toast.error(`Cadastro feito, mas o recado/referência não foi salvo: ${e.message}`));
      }
      return r;
    },
    onSuccess: (r) => { setFeito(r); setPasso(2); toast.success(`${primeiroNome(f.nome)} cadastrada. ${r.perfil}.`); void qc.invalidateQueries({ queryKey: ["rep", rep, "crm"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const ok1 = falta.length === 0;
  const ok2 = Object.keys(perfil).length === PERGUNTAS.length;
  const campo = "h-12 w-full rounded-xl border border-border bg-background px-3.5 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <TelaCheia>
    <div className="fixed inset-0 z-[200] flex h-[100dvh] flex-col bg-background" role="dialog" aria-modal="true" aria-label="Nova candidata" data-tela-cheia="">
      <header className="border-b border-border px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <button type="button" aria-label="Voltar" disabled={passo === 0 || passo >= 2} onClick={() => setPasso((p) => p - 1)}
            className="grid size-11 place-items-center rounded-full border border-border disabled:invisible"><ChevronLeft className="size-5" /></button>
          <p className="text-base font-semibold">{feito ? primeiroNome(f.nome) : "Nova candidata"}</p>
          <button type="button" aria-label="Fechar" onClick={sair} className="grid size-11 place-items-center rounded-full border border-border"><X className="size-4" /></button>
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

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
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
              <Bloco titulo="Recado e referência">
                <CamposContatosRef value={contatosRef} onChange={setContatosRef} inputClass={campo} labelClass="mb-1.5 block text-[0.78rem] font-medium text-muted-foreground" />
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
          {passo === 3 && feito && <Assinaturas rep={rep} party={feito.party_id} maleta={maleta} nome={f.nome} telefone={f.whatsapp} onConcluida={concluir} />}
        </div>
      </main>

      {passo < 2 && (
        <footer className="border-t border-border bg-background px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
    </TelaCheia>
  );
}

/**
 * 0266 — o fluxo abre direto no <body> (fora do card e do vidro do app), por cima de tudo:
 * nada de botões por cima ou tela cortada. Trava a rolagem do fundo enquanto está aberto.
 */
function TelaCheia({ children }: { children: React.ReactNode }) {
  const [alvo, setAlvo] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setAlvo(document.body);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = antes; };
  }, []);
  return alvo ? createPortal(children, alvo) : null;
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
  const [verOutras, setVerOutras] = React.useState(false);
  const receber = useMutation({ mutationFn: (t: string) => receberMaleta(t), onSuccess: () => { toast.success("Recebimento confirmado."); void qc.invalidateQueries({ queryKey: ["rep", rep, "maletas"] }); }, onError: (e) => toast.error(mensagem(e)) });
  const passar = useMutation({
    mutationFn: async () => {
      const dest = { tipo: "candidata" as const, id: leadId, nome, codigo: null, cidade: null };
      // 0273: maleta designada a outra consultora (ainda com o representante) também pode virar abertura
      return outra ? trocarDestinoMaleta(rep, sel!, dest) : repassarMaleta(rep, sel!, dest);
    },
    onSuccess: () => {
      toast.success(`Maleta ${escolhida!.maleta} agora é de ${primeiroNome(nome)}.`);
      void qc.invalidateQueries({ queryKey: ["rep", rep] });
      onEscolhida({ cycle_id: escolhida!.cycle_id, nome: escolhida!.maleta });
    },
    onError: (e) => toast.error(mensagem(e)),
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando suas maletas…</p>;
  if (q.error) return <p className="text-sm text-destructive">{mensagem(q.error)}</p>;
  const d = q.data!;
  const designadas = d.para_entregar ?? [];
  const outra = designadas.find((x) => x.cycle_id === sel) ?? null;
  const escolhida: { cycle_id: string; maleta: string } | null = outra ?? d.sem_consultora.find((x) => x.cycle_id === sel) ?? null;
  const confirmar = () => {
    if (outra && !window.confirm(`A maleta ${outra.maleta} era de ${outra.consultora}. Ela vai ficar sem esta maleta e ${primeiroNome(nome)} recebe no lugar. Confirmar?`)) return;
    passar.mutate();
  };
  return (
    <Bloco titulo="Qual maleta fica com ela" icone={<PackageOpen className="size-4" />}>
      {d.a_receber.map((m) => (
        <div key={m.transfer_id} className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border p-4">
          <div><p className="font-medium">{(!m.consultora && rotuloAbertura(m.abertura_numero, m.remessa)) || m.maleta}</p><p className="text-xs text-muted-foreground">A caminho de você · {m.pecas} peças</p></div>
          <button type="button" disabled={receber.isPending} onClick={() => receber.mutate(m.transfer_id)} className="h-10 rounded-xl border border-border px-3 text-sm">Recebi</button>
        </div>
      ))}
      {d.sem_consultora.length === 0 && designadas.length === 0 && (
        <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
          Nenhuma maleta com você agora. O cadastro dela já está salvo: quando a maleta chegar, abra a candidata na lista e continue daqui.
        </p>
      )}
      {d.sem_consultora.length === 0 && designadas.length > 0 && (
        <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
          Nenhuma maleta de abertura com você. Você pode usar uma das maletas que estão com você para outra consultora.
        </p>
      )}
      <div className="space-y-2">
        {d.sem_consultora.map((m) => (
          <button key={m.cycle_id} type="button" onClick={() => setSel(m.cycle_id)}
            className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left ${sel === m.cycle_id ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border"}`}>
            <div>
              <p className="text-base font-bold tracking-wide">{rotuloAbertura(m.abertura_numero, m.remessa) ?? m.maleta}</p>
              <p className="text-xs text-muted-foreground">{rotuloAbertura(m.abertura_numero, m.remessa) ? `Maleta ${m.maleta} · ` : ""}{m.pecas} peças · {brl(m.valor_cents)}{m.remessa && !m.abertura_numero ? ` · remessa ${m.remessa}` : ""}</p>
            </div>
            <span className={`grid size-7 place-items-center rounded-full border ${sel === m.cycle_id ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{sel === m.cycle_id && <Check className="size-4" />}</span>
          </button>
        ))}
      </div>
      {designadas.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setVerOutras((v) => !v)} aria-expanded={verOutras || d.sem_consultora.length === 0}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-dashed border-border px-4 text-left text-sm font-medium">
            <span>Usar uma maleta que era de outra consultora ({designadas.length})</span>
            <span className="text-muted-foreground">{verOutras || d.sem_consultora.length === 0 ? "Fechar" : "Ver"}</span>
          </button>
          {(verOutras || d.sem_consultora.length === 0) && (
            <>
              <p className="px-1 text-xs text-muted-foreground">Só as que ainda não foram entregues em mãos. A consultora original fica sem esta maleta.</p>
              {designadas.map((m) => (
                <button key={m.cycle_id} type="button" onClick={() => setSel(m.cycle_id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left ${sel === m.cycle_id ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border"}`}>
                  <div className="min-w-0">
                    <p className="font-semibold">{m.maleta}</p>
                    <p className="text-xs text-muted-foreground">Era de {m.consultora}{m.cidade ? ` · ${m.cidade}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{m.pecas} peças · {brl(m.valor_cents)}{m.remessa ? ` · remessa ${m.remessa}` : ""}</p>
                  </div>
                  <span className={`grid size-7 shrink-0 place-items-center rounded-full border ${sel === m.cycle_id ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{sel === m.cycle_id && <Check className="size-4" />}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {(d.sem_consultora.length > 0 || designadas.length > 0) && (
        <button type="button" disabled={!escolhida || passar.isPending} onClick={confirmar} className="min-h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {passar.isPending ? "Vinculando…" : outra ? `Trocar: deixar ${outra.maleta} com ela` : "Deixar esta maleta com ela"}
        </button>
      )}
    </Bloco>
  );
}

function Assinaturas({ rep, party, maleta, nome, telefone, onConcluida }: { rep: string; party: string; maleta: { cycle_id: string; nome: string } | null; nome: string; telefone: string; onConcluida: () => void }) {
  const q = useQuery({
    queryKey: ["assinaturas", party],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("assinaturas_da_consultora" as never, { _party: party, _rep: rep } as never);
      if (error) throw error;
      return data as unknown as { documentos: { tipo: string; status: string; cycle_id: string | null; invalidada_em?: string | null }[] };
    },
    refetchInterval: 15_000,
  });
  const docs = q.data?.documentos ?? [];
  const contrato = docs.some((d) => d.tipo === "contrato" && d.status === "assinado");
  const promissoria = docs.some((d) => d.tipo === "promissoria" && d.status === "assinado" && !d.invalidada_em && (!maleta || d.cycle_id === maleta.cycle_id));
  const concluida = contrato && promissoria;
  React.useEffect(() => { if (concluida) onConcluida(); }, [concluida, onConcluida]);
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
      <AssinaturaDigital party={party} rep={rep} telefone={telefone} />
    </div>
  );
}
function Selo({ ok, t }: { ok: boolean; t: string }) {
  return <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${ok ? "bg-primary text-primary-foreground" : "border border-border bg-background"}`}>{ok && <Check className="size-3" />}{t}{ok ? " assinado" : " pendente"}</span>;
}
const primeiroNome = (n: string) => { const p = (n.trim().split(/\s+/)[0] ?? "").toLowerCase(); return p.charAt(0).toUpperCase() + p.slice(1); };

/**
 * Teste de candidatura (0284) — o que a candidata vê, celular primeiro.
 * Início (autorização) → Parte 1 Seu dia a dia → Parte 2 Como você se organiza → Parte 3 Perfil (20 grupos) → Final.
 * Salva a cada tela no servidor; o mesmo link retoma de onde parou. Pontos, cores e riscos nunca aparecem aqui.
 */
import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2 } from "lucide-react";
import { testeAbrir, testeConcluir, testeSalvar } from "@/lib/candidatura-teste/teste.functions";
import {
  ACEITE_TEXTO, DISC, DISC_ABERTURA, ESCALA, FATORES, FINAL_TEXTO, FRASES, ORGANIZACAO, PARTE1, PARTE2_ABERTURA, RESTRICAO, SITE,
  type Fator, type Opcao, type RespostaDisc, type Respostas,
} from "@/lib/candidatura-teste/perguntas";

type Estado = Awaited<ReturnType<typeof testeAbrir>>;
type Tela = { tipo: "inicio" } | { tipo: "p1" } | { tipo: "p2" } | { tipo: "disc"; grupo: number } | { tipo: "final" };

const btn = "min-h-11 rounded-xl border px-4 py-2.5 text-left text-sm transition-colors";
const marcado = "border-primary bg-primary/10 font-semibold text-foreground";
const livre = "border-border bg-card text-foreground hover:border-primary/50";

function Escolha({ titulo, opcoes, valor, onChange }: { titulo: string; opcoes: readonly Opcao[]; valor?: string | undefined; onChange: (v: string) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-base font-semibold text-foreground">{titulo}</legend>
      <div className="grid gap-2">
        {opcoes.map((o) => (
          <button key={o.codigo} type="button" aria-pressed={valor === o.codigo} onClick={() => onChange(o.codigo)} className={`${btn} ${valor === o.codigo ? marcado : livre}`}>
            {o.texto}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function primeiraTela(e: Estado): Tela {
  if (e.concluido) return { tipo: "final" };
  if (e.precisa_aceite) return { tipo: "inicio" };
  const r = e.respostas as Respostas;
  if (!r.experiencia_venda || !r.horas_semana || !r.local_trabalho || !r.contatos_semana || !r.publico_feminino || !r.onde_pretende_vender?.length || !r.contatos_whatsapp) return { tipo: "p1" };
  if (ORGANIZACAO.some((o) => !r[o.id]) || !r.restricao_declarada || FRASES.some((f) => typeof r.frases?.[f.id] !== "number")) return { tipo: "p2" };
  const d = e.disc_respostas as (RespostaDisc | null)[];
  const g = DISC.findIndex((_, i) => !d[i]);
  return { tipo: "disc", grupo: g < 0 ? DISC.length - 1 : g };
}

export function TesteCandidatura({ token }: { token: string }) {
  const abrirFn = useServerFn(testeAbrir);
  const salvarFn = useServerFn(testeSalvar);
  const concluirFn = useServerFn(testeConcluir);
  const [estado, setEstado] = React.useState<Estado | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [tela, setTela] = React.useState<Tela | null>(null);
  const [r, setR] = React.useState<Respostas>({});
  const [disc, setDisc] = React.useState<(RespostaDisc | null)[]>([]);
  const [aceite, setAceite] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [devolutiva, setDevolutiva] = React.useState<string | null>(null);
  const topo = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    abrirFn({ data: { token } })
      .then((e) => { setEstado(e); setR(e.respostas as Respostas); setDisc(e.disc_respostas as (RespostaDisc | null)[]); setDevolutiva(e.devolutiva); setTela(primeiraTela(e)); })
      .catch((x: Error) => setErro(x.message));
  }, [token, abrirFn]);
  React.useEffect(() => { topo.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [tela]);

  const set = <K extends keyof Respostas>(k: K, v: Respostas[K]) => setR((o) => ({ ...o, [k]: v }));

  async function salvar(parte: number, patch: Partial<Respostas>, extra: Record<string, unknown> = {}) {
    setBusy(true); setErro(null);
    try { await salvarFn({ data: { token, parte, respostas: patch as never, ...extra } }); return true; }
    catch (x) { setErro((x as Error).message); return false; }
    finally { setBusy(false); }
  }

  if (erro && !estado) return <Caixa><p role="alert" className="text-base text-foreground">{erro}</p></Caixa>;
  if (!estado || !tela) return <Caixa><p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Abrindo o seu teste…</p></Caixa>;
  const ordem = estado.disc_ordem as number[][];

  const passo = tela.tipo === "inicio" ? 0 : tela.tipo === "p1" ? 1 : tela.tipo === "p2" ? 2 : 3;
  const cabecalho = tela.tipo !== "final" && (
    <div className="mb-6">
      <p className="brand-eyebrow">Candidatura Lardan{estado.nome ? ` · ${estado.nome}` : ""}</p>
      {passo > 0 && (
        <div className="mt-3 flex gap-1.5" aria-label={`Parte ${passo} de 3`}>
          {[1, 2, 3].map((n) => <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= passo ? "bg-primary" : "bg-muted"}`} />)}
        </div>
      )}
    </div>
  );

  let corpo: React.ReactNode = null;
  if (tela.tipo === "inicio") {
    corpo = (
      <div className="space-y-5">
        <h1 className="text-2xl text-foreground">Vamos conhecer você melhor</h1>
        <p className="text-base leading-relaxed text-muted-foreground">São 3 partes curtas, uns 10 minutos. Tudo fica salvo a cada tela: se precisar parar, é só abrir este mesmo link depois.</p>
        <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm text-foreground">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
          {ACEITE_TEXTO}
        </label>
        <Avancar disabled={!aceite || busy} busy={busy} onClick={async () => { if (await salvar(1, {}, { aceite: ACEITE_TEXTO })) setTela({ tipo: "p1" }); }}>Começar</Avancar>
      </div>
    );
  } else if (tela.tipo === "p1") {
    const ok = r.experiencia_venda && r.horas_semana && (r.local_trabalho ?? "").trim().length >= 2 && r.contatos_semana && r.publico_feminino && r.onde_pretende_vender?.length && r.contatos_whatsapp;
    corpo = (
      <div className="space-y-7">
        <h1 className="text-2xl text-foreground">Parte 1 · Seu dia a dia</h1>
        <label className="grid gap-2">
          <span className="text-base font-semibold text-foreground">Onde você trabalha? (empresa e função)</span>
          <input value={r.local_trabalho ?? ""} onChange={(e) => set("local_trabalho", e.target.value)} maxLength={200}
            className="min-h-11 rounded-xl border border-border bg-background px-4 text-base" placeholder="Ex.: Mercado Bom Preço, caixa" />
        </label>
        <Escolha titulo={PARTE1.contatos_semana.pergunta} opcoes={PARTE1.contatos_semana.opcoes} valor={r.contatos_semana} onChange={(v) => set("contatos_semana", v)} />
        <Escolha titulo={PARTE1.publico_feminino.pergunta} opcoes={PARTE1.publico_feminino.opcoes} valor={r.publico_feminino} onChange={(v) => set("publico_feminino", v)} />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-base font-semibold text-foreground">{PARTE1.onde_pretende_vender.pergunta}</legend>
          <p className="mb-2 text-sm text-muted-foreground">Pode marcar mais de uma.</p>
          <div className="grid grid-cols-2 gap-2">
            {PARTE1.onde_pretende_vender.opcoes.map((o) => {
              const on = r.onde_pretende_vender?.includes(o.codigo) ?? false;
              return (
                <button key={o.codigo} type="button" aria-pressed={on} className={`${btn} ${on ? marcado : livre}`}
                  onClick={() => set("onde_pretende_vender", on ? (r.onde_pretende_vender ?? []).filter((x) => x !== o.codigo) : [...(r.onde_pretende_vender ?? []), o.codigo])}>
                  {on && <Check className="mr-1 inline size-4" />}{o.texto}
                </button>
              );
            })}
          </div>
        </fieldset>
        <Escolha titulo={PARTE1.contatos_whatsapp.pergunta} opcoes={PARTE1.contatos_whatsapp.opcoes} valor={r.contatos_whatsapp} onChange={(v) => set("contatos_whatsapp", v)} />
        <Escolha titulo={SITE.experiencia_venda.pergunta} opcoes={SITE.experiencia_venda.opcoes} valor={r.experiencia_venda} onChange={(v) => set("experiencia_venda", v)} />
        <Escolha titulo={SITE.horas_semana.pergunta} opcoes={SITE.horas_semana.opcoes} valor={r.horas_semana} onChange={(v) => set("horas_semana", v)} />
        <Avancar disabled={!ok || busy} busy={busy} onClick={async () => {
          const patch: Partial<Respostas> = { local_trabalho: r.local_trabalho?.trim(), contatos_semana: r.contatos_semana, publico_feminino: r.publico_feminino, onde_pretende_vender: r.onde_pretende_vender, contatos_whatsapp: r.contatos_whatsapp, experiencia_venda: r.experiencia_venda, horas_semana: r.horas_semana };
          if (await salvar(2, patch)) setTela({ tipo: "p2" });
        }}>Continuar</Avancar>
      </div>
    );
  } else if (tela.tipo === "p2") {
    const ok = ORGANIZACAO.every((o) => r[o.id]) && r.restricao_declarada && FRASES.every((f) => typeof r.frases?.[f.id] === "number");
    corpo = (
      <div className="space-y-7">
        <h1 className="text-2xl text-foreground">Parte 2 · Como você se organiza</h1>
        <p className="rounded-xl bg-muted p-4 text-sm leading-relaxed text-foreground">{PARTE2_ABERTURA}</p>
        {ORGANIZACAO.map((o) => <Escolha key={o.id} titulo={o.pergunta} opcoes={o.opcoes} valor={r[o.id]} onChange={(v) => set(o.id, v)} />)}
        <div>
          <Escolha titulo={RESTRICAO.pergunta} opcoes={RESTRICAO.opcoes} valor={r.restricao_declarada} onChange={(v) => set("restricao_declarada", v)} />
          <p className="mt-2 text-sm text-muted-foreground">{RESTRICAO.dica}</p>
        </div>
        <div className="space-y-5">
          <p className="text-base font-semibold text-foreground">Quanto cada frase parece com você?</p>
          {FRASES.map((f) => (
            <fieldset key={f.id} className="space-y-2">
              <legend className="mb-2 text-sm text-foreground">{f.texto}</legend>
              <div className="grid grid-cols-5 gap-1.5">
                {ESCALA.map((rot, i) => {
                  const v = i + 1; const on = r.frases?.[f.id] === v;
                  return (
                    <button key={v} type="button" aria-pressed={on} aria-label={rot}
                      onClick={() => setR((o) => ({ ...o, frases: { ...(o.frases ?? {}), [f.id]: v } }))}
                      className={`min-h-14 rounded-xl border px-1 py-2 text-[0.7rem] leading-tight [overflow-wrap:anywhere] ${on ? marcado : livre}`}>
                      {rot}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <Avancar disabled={!ok || busy} busy={busy} onClick={async () => {
          const patch: Partial<Respostas> = { o1: r.o1, o2: r.o2, o3: r.o3, o4: r.o4, o5: r.o5, restricao_declarada: r.restricao_declarada, frases: r.frases };
          if (await salvar(3, patch, { iniciarDisc: true })) setTela({ tipo: "disc", grupo: Math.max(0, DISC.findIndex((_, i) => !disc[i])) });
        }}>Continuar</Avancar>
      </div>
    );
  } else if (tela.tipo === "disc") {
    corpo = <GrupoDisc key={tela.grupo} grupo={tela.grupo} ordem={ordem[tela.grupo] ?? [0, 1, 2, 3]} atual={disc[tela.grupo] ?? null} busy={busy}
      onVoltar={tela.grupo > 0 ? () => setTela({ tipo: "disc", grupo: tela.grupo - 1 }) : () => setTela({ tipo: "p2" })}
      onConfirmar={async (resp) => {
        if (!(await salvar(3, {}, { disc: { grupo: tela.grupo, ...resp } }))) return;
        const novo = [...disc]; while (novo.length < DISC.length) novo.push(null); novo[tela.grupo] = resp; setDisc(novo);
        const prox = novo.findIndex((x, i) => i > tela.grupo && !x);
        const falta = novo.findIndex((x) => !x);
        if (prox >= 0) { setTela({ tipo: "disc", grupo: prox }); return; }
        if (falta >= 0) { setTela({ tipo: "disc", grupo: falta }); return; }
        setBusy(true);
        try { const f = await concluirFn({ data: { token } }); setDevolutiva(f.devolutiva); setTela({ tipo: "final" }); }
        catch (x) { setErro((x as Error).message); }
        finally { setBusy(false); }
      }} />;
  } else {
    corpo = (
      <div className="space-y-5 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary/10 text-primary"><Check className="size-7" /></span>
        <h1 className="text-2xl text-foreground">Obrigada{estado.nome ? `, ${estado.nome}` : ""}!</h1>
        {devolutiva && <p className="text-base leading-relaxed text-foreground">{devolutiva}</p>}
        <p className="text-base leading-relaxed text-muted-foreground">{FINAL_TEXTO}</p>
      </div>
    );
  }

  return (
    <Caixa>
      <div ref={topo} className="scroll-mt-24" />
      {cabecalho}
      {corpo}
      {erro && <p role="alert" className="mt-4 text-sm text-destructive">{erro}</p>}
    </Caixa>
  );
}

function GrupoDisc({ grupo, ordem, atual, busy, onVoltar, onConfirmar }: {
  grupo: number; ordem: number[]; atual: RespostaDisc | null; busy: boolean; onVoltar: () => void; onConfirmar: (r: RespostaDisc) => void;
}) {
  const [mais, setMais] = React.useState<Fator | null>(atual?.mais ?? null);
  const [menos, setMenos] = React.useState<Fator | null>(atual?.menos ?? null);
  const g = DISC[grupo]!;
  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl text-foreground">Parte 3 · Perfil</h1>
        <span className="text-sm tabular-nums text-muted-foreground">{grupo + 1} de {DISC.length}</span>
      </div>
      {grupo === 0 && <p className="rounded-xl bg-muted p-4 text-sm leading-relaxed text-foreground">{DISC_ABERTURA}</p>}
      <div className="h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${((grupo + 1) / DISC.length) * 100}%` }} /></div>
      <p className="text-base font-semibold text-foreground">{g.enunciado}</p>
      <ul className="space-y-2">
        {ordem.map((idx) => {
          const f = FATORES[idx]!;
          return (
            <li key={idx} className="rounded-xl border border-border bg-card p-3">
              <p className="mb-2 text-base text-foreground">{g.frases[idx]}</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" aria-pressed={mais === f} onClick={() => { setMais(f); if (menos === f) setMenos(null); }}
                  className={`min-h-11 rounded-lg border text-sm ${mais === f ? "border-primary bg-primary text-primary-foreground font-semibold" : "border-border"}`}>Mais</button>
                <button type="button" aria-pressed={menos === f} onClick={() => { setMenos(f); if (mais === f) setMais(null); }}
                  className={`min-h-11 rounded-lg border text-sm ${menos === f ? "border-foreground bg-foreground text-background font-semibold" : "border-border"}`}>Menos</button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button type="button" onClick={onVoltar} className="min-h-12 rounded-xl border border-border px-4 text-sm">Voltar</button>
        <Avancar disabled={!mais || !menos || busy} busy={busy} onClick={() => mais && menos && onConfirmar({ mais, menos })}>
          {grupo + 1 === DISC.length ? "Concluir" : "Próximo"}
        </Avancar>
      </div>
    </div>
  );
}

function Avancar({ children, disabled, busy, onClick }: { children: React.ReactNode; disabled: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground disabled:opacity-50">
      {busy && <Loader2 className="size-4 animate-spin" />}{children}
    </button>
  );
}

function Caixa({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">{children}</div>;
}

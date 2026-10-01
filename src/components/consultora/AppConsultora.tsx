import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, BriefcaseBusiness, CalendarClock, Check, ChevronRight, CircleHelp, Home, LogOut, Menu, MessageCircle,
  PackageCheck, Phone, Plus, Search, ShoppingBag, Store, UserPlus, Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DateField } from "@/components/premium/DateField";
import { BotaoAjuda } from "@/components/ajuda/Ajuda";
import diamanteLardan from "@/assets/lardan-diamante.png.asset.json";
import nomeLardan from "@/assets/lardan-wordmark.png.asset.json";
import { brl, chaveIdempotencia, imagem, traduzir } from "@/lib/maletas";
import {
  CANAL, carregarInicio, criarPedido, dataBR, formatarTelefone, hojeISO, linkWhats, listarAtendimentos, listarClientes,
  meuParty, obterCliente, pecasDisponiveis, registrarAtendimento, salvarCliente, type Atendimento, type Cliente, type Peca,
} from "@/lib/consultora";

export type AbaApp = "inicio" | "clientes" | "pedidos" | "maleta" | "vitrine" | "historico" | "mais" | "novo";
export type Nav = { aba: AbaApp; id?: string | undefined; modo?: "nova" | "editar" | undefined; q?: string | undefined };
export type Ir = (n: Nav) => void;

const iso = (d?: Date) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null);
const deIso = (s: string | null) => (s ? new Date(s + "T12:00:00") : undefined);

/* ------------------------------------------------------------------ casca */

const PRINCIPAIS: { aba: AbaApp; rotulo: string; icone: typeof Home }[] = [
  { aba: "inicio", rotulo: "Início", icone: Home },
  { aba: "clientes", rotulo: "Clientes", icone: Users },
  { aba: "pedidos", rotulo: "Pedidos", icone: ShoppingBag },
  { aba: "maleta", rotulo: "Maleta", icone: BriefcaseBusiness },
];
const EXTRAS: { aba: AbaApp; rotulo: string; icone: typeof Home }[] = [
  { aba: "vitrine", rotulo: "Minha vitrine", icone: Store },
  { aba: "historico", rotulo: "Entregas da maleta", icone: PackageCheck },
];

const grupoDe = (a: AbaApp): AbaApp => (a === "novo" ? "pedidos" : a === "vitrine" || a === "historico" ? "mais" : a);

export function CascaConsultora({ nav, ir, ajuda, children }: { nav: Nav; ir: Ir; ajuda: string; children: React.ReactNode }) {
  const ativo = grupoDe(nav.aba);
  const sair = async () => { await supabase.auth.signOut(); window.location.href = "/equipe"; };
  return (
    <div className="area-consultora min-h-dvh bg-background text-foreground lg:flex">
      {/* Menu lateral no computador */}
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-border bg-card px-5 py-8 lg:flex">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Minha área</p>
        <p className="mb-8 mt-1 text-xl font-semibold">Consultora</p>
        <button type="button" onClick={() => ir({ aba: "novo" })} className="btn-app-principal mb-6 w-full">
          <Plus className="size-5" aria-hidden /> Novo pedido
        </button>
        <nav aria-label="Menu" className="flex flex-col gap-1">
          {[...PRINCIPAIS, ...EXTRAS].map((i) => {
            const on = nav.aba === i.aba || (i.aba === "pedidos" && nav.aba === "novo");
            return (
              <button key={i.aba} type="button" aria-current={on ? "page" : undefined} onClick={() => ir({ aba: i.aba })}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-left text-[1.05rem] ${on ? "bg-primary/10 font-semibold text-foreground" : "text-foreground hover:bg-muted"}`}>
                <i.icone className="size-5" aria-hidden /> {i.rotulo}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <img src={nomeLardan.url} alt="LARDAN" className="mb-3 h-auto w-28 object-contain object-left" />
          <BotaoAjuda tela={ajuda} className="w-full justify-start" />
          <button type="button" onClick={sair} className="admin-btn min-h-12 w-full text-base"><LogOut className="size-5" aria-hidden /> Sair</button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="grid h-16 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border bg-card px-4 sm:px-6 lg:h-20 lg:border-0 lg:bg-transparent lg:px-10">
          <img src={nomeLardan.url} alt="LARDAN" className="h-auto w-28 object-contain object-left lg:hidden" />
          <span className="hidden lg:block" aria-hidden />
          <img src={diamanteLardan.url} alt="" aria-hidden className="h-auto w-11 object-contain lg:w-14" />
        </div>
        <main className="mx-auto w-full max-w-5xl px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
          {children}
        </main>
      </div>

      {/* Navegação inferior no celular */}
      <nav aria-label="Menu" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card/95 px-1 pt-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        {[...PRINCIPAIS, { aba: "mais" as AbaApp, rotulo: "Mais", icone: Menu }].map((i) => {
          const on = ativo === i.aba;
          return (
            <button key={i.aba} type="button" aria-current={on ? "page" : undefined} onClick={() => ir({ aba: i.aba })}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.8rem] leading-tight ${on ? "font-semibold text-acao" : "text-foreground"}`}>
              <span className={`grid h-8 w-12 place-items-center rounded-full ${on ? "bg-primary/12" : ""}`}><i.icone className="size-6" aria-hidden /></span>
              {i.rotulo}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function Topo({ titulo, voltar, ajuda, children }: { titulo: string; voltar?: (() => void) | undefined; ajuda: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6 flex items-center gap-3">
      {voltar && (
        <button type="button" onClick={voltar} className="grid size-12 shrink-0 place-items-center rounded-full border border-border bg-card" aria-label="Voltar">
          <ArrowLeft className="size-6" aria-hidden />
        </button>
      )}
      <h1 className="min-w-0 flex-1 font-display text-[1.9rem] leading-tight sm:text-4xl">{titulo}</h1>
      {children}
      <span className="lg:hidden"><BotaoAjuda tela={ajuda} /></span>
    </header>
  );
}

function Estado({ tipo, texto, acao }: { tipo: "carregando" | "erro" | "vazio"; texto: string; acao?: React.ReactNode }) {
  return (
    <div role={tipo === "erro" ? "alert" : "status"} className="rounded-2xl border border-border bg-card p-6 text-center">
      {tipo === "carregando" && <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />}
      <p className="text-[1.05rem]">{texto}</p>
      {acao && <div className="mt-4 flex justify-center">{acao}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ início */

export function Inicio({ ir }: { ir: Ir }) {
  const q = useQuery({ queryKey: ["consultora", "inicio"], queryFn: carregarInicio });
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const d = q.data;
  const primeiroNome = d?.nome?.trim().split(/\s+/)[0];

  const pendencias: { texto: string; acao: string; ir: Nav }[] = [];
  if (d) {
    if (d.maletas_receber) pendencias.push({ texto: d.maletas_receber === 1 ? "Uma maleta está a caminho. Confirme quando chegar." : `${d.maletas_receber} maletas estão a caminho.`, acao: "Ver maleta", ir: { aba: "maleta" } });
    if (d.maletas_conferir) pendencias.push({ texto: "Sua maleta chegou e precisa ser conferida.", acao: "Conferir maleta", ir: { aba: "maleta" } });
    if (d.pedidos_novos) pendencias.push({ texto: d.pedidos_novos === 1 ? "Uma cliente aguarda atendimento." : `${d.pedidos_novos} clientes aguardam atendimento.`, acao: "Atender", ir: { aba: "pedidos" } });
    if (d.retornos_atrasados) pendencias.push({ texto: d.retornos_atrasados === 1 ? "Um retorno a cliente está atrasado." : `${d.retornos_atrasados} retornos a clientes estão atrasados.`, acao: "Ver clientes", ir: { aba: "clientes" } });
    if (d.retornos_hoje) pendencias.push({ texto: d.retornos_hoje === 1 ? "Você combinou de falar com uma cliente hoje." : `Você combinou de falar com ${d.retornos_hoje} clientes hoje.`, acao: "Ver clientes", ir: { aba: "clientes" } });
  }

  return (
    <div className="space-y-7">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[1.05rem] text-muted-foreground">{saudacao}{primeiroNome ? "," : ""}</p>
          <h1 className="font-display text-4xl leading-tight">{primeiroNome ?? "Consultora"}</h1>
        </div>
        <span className="lg:hidden"><BotaoAjuda tela="inicio" /></span>
      </header>

      <section className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <button type="button" onClick={() => ir({ aba: "novo" })}
          className="flex min-h-24 items-center gap-4 rounded-3xl bg-acao px-6 py-5 text-left text-acao-foreground shadow-[var(--shadow-app)] active:scale-[0.99]">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-acao-foreground/15"><Plus className="size-7" aria-hidden /></span>
          <span>
            <span className="block text-xl font-semibold">Novo pedido</span>
            <span className="block text-[0.98rem] opacity-90">Escolha a cliente e as peças da sua maleta</span>
          </span>
        </button>
        <div className="grid grid-cols-3 gap-3">
          {[
            { r: "Cadastrar cliente", i: UserPlus, n: { aba: "clientes", modo: "nova" } as Nav },
            { r: "Meus pedidos", i: ShoppingBag, n: { aba: "pedidos" } as Nav },
            { r: "Minha vitrine", i: Store, n: { aba: "vitrine" } as Nav },
          ].map((a) => (
            <button key={a.r} type="button" onClick={() => ir(a.n)}
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card px-2 py-3 text-center text-[0.95rem] font-medium leading-tight active:bg-muted">
              <a.i className="size-7 text-primary" aria-hidden /> {a.r}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="pend">
        <h2 id="pend" className="mb-3 text-xl font-semibold">O que fazer agora</h2>
        {q.isLoading && <Estado tipo="carregando" texto="Buscando suas pendências…" />}
        {q.isError && <Estado tipo="erro" texto="Não foi possível carregar agora. Verifique sua internet." acao={<button className="admin-btn" onClick={() => q.refetch()}>Tentar de novo</button>} />}
        {d && pendencias.length === 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-5">
            <Check className="size-6 shrink-0 text-primary" aria-hidden />
            <p className="text-[1.05rem]">Tudo em dia. Nenhuma pendência no momento.</p>
          </div>
        )}
        <ul className="space-y-3">
          {pendencias.map((p) => (
            <li key={p.texto}>
              <button type="button" onClick={() => ir(p.ir)} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-5 text-left active:bg-muted">
                <CalendarClock className="size-6 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 text-[1.05rem]">{p.texto}</span>
                <span className="shrink-0 text-[0.95rem] font-semibold text-primary">{p.acao}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {d && (
        <section aria-labelledby="mes">
          <h2 id="mes" className="mb-3 text-xl font-semibold">Seu resumo</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Clientes cadastradas", d.clientes],
              ["Pedidos em aberto", d.pedidos_abertos],
              ["Pedidos neste mês", d.pedidos_mes],
              ["Peças disponíveis na maleta", d.pecas_disponiveis],
            ].map(([r, n]) => (
              <div key={r as string} className="rounded-2xl border border-border bg-card p-4">
                <dd className="num text-3xl font-semibold">{n as number}</dd>
                <dt className="mt-1 text-[0.95rem] leading-snug text-muted-foreground">{r as string}</dt>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ clientes */

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function Clientes({ nav, ir }: { nav: Nav; ir: Ir }) {
  const q = useQuery({ queryKey: ["consultora", "clientes"], queryFn: listarClientes });
  const busca = nav.q ?? "";
  const partes = semAcento(busca).split(/\s+/).filter(Boolean);
  const lista = (q.data ?? []).filter((c) => {
    const t = semAcento(`${c.nome} ${c.telefone} ${formatarTelefone(c.telefone)} ${c.email ?? ""} ${c.preferencias}`);
    return partes.every((p) => t.includes(p));
  });
  const hoje = hojeISO();

  return (
    <div>
      <Topo titulo="Clientes" ajuda="clientes" />
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="sr-only">Buscar cliente</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input type="search" value={busca} placeholder="Buscar por nome ou telefone" enterKeyHint="search"
              onChange={(e) => ir({ aba: "clientes", q: e.target.value || undefined })}
              className="admin-input min-h-14 rounded-2xl pl-12 text-[1.05rem]" />
          </span>
        </label>
        <button type="button" className="btn-app-principal" onClick={() => ir({ aba: "clientes", modo: "nova" })}>
          <UserPlus className="size-5" aria-hidden /> Cadastrar cliente
        </button>
      </div>

      {q.isLoading && <Estado tipo="carregando" texto="Carregando suas clientes…" />}
      {q.isError && <Estado tipo="erro" texto="Não foi possível carregar suas clientes." acao={<button className="admin-btn" onClick={() => q.refetch()}>Tentar de novo</button>} />}
      {q.data && q.data.length === 0 && (
        <Estado tipo="vazio" texto="Você ainda não cadastrou clientes. Comece pela primeira: só o nome é obrigatório." />
      )}
      {q.data && q.data.length > 0 && lista.length === 0 && <Estado tipo="vazio" texto={`Nenhuma cliente encontrada para “${busca}”.`} />}

      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {lista.map((c) => {
          const atrasado = c.proximo_retorno && c.proximo_retorno < hoje;
          const ehHoje = c.proximo_retorno === hoje;
          return (
            <li key={c.id} className="min-w-0">
              <button type="button" onClick={() => ir({ aba: "clientes", id: c.id, q: nav.q })}
                className="flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left active:bg-muted">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/12 text-lg font-semibold text-primary" aria-hidden>
                  {c.nome.trim().slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[1.1rem] font-semibold">{c.nome}</span>
                  <span className="block text-[0.98rem] text-muted-foreground">{c.telefone ? formatarTelefone(c.telefone) : "Sem telefone"}</span>
                  {c.proximo_retorno && (
                    <span className={`mt-1 inline-block text-[0.95rem] font-medium ${atrasado ? "text-destructive" : "text-foreground"}`}>
                      {atrasado ? "⚠ Retorno atrasado: " : ehHoje ? "Retorno hoje" : "Retorno: "}{ehHoje ? "" : dataBR(c.proximo_retorno)}
                    </span>
                  )}
                </span>
                <ChevronRight className="size-6 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FormCliente({ id, ir, depois }: { id?: string | undefined; ir: Ir; depois?: (id: string) => void }) {
  const qc = useQueryClient();
  const atual = useQuery({ queryKey: ["consultora", "cliente", id], queryFn: () => obterCliente(id!), enabled: !!id });
  const [f, setF] = React.useState<Partial<Cliente>>({});
  const [erros, setErros] = React.useState<Record<string, string>>({});
  React.useEffect(() => { if (atual.data) setF(atual.data); }, [atual.data]);
  const salvar = useMutation({
    mutationFn: async () => salvarCliente({ ...f, nome: f.nome ?? "" } as Cliente, await meuParty()),
    onSuccess: (novo) => {
      qc.invalidateQueries({ queryKey: ["consultora"] });
      toast.success(id ? "Cliente atualizada." : "Cliente cadastrada.");
      if (depois) depois(novo); else ir({ aba: "clientes", id: novo });
    },
    onError: (e) => toast.error("Não salvou. Seus dados continuam aqui. " + traduzir(e)),
  });
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!f.nome || f.nome.trim().length < 2) er["nome"] = "Escreva o nome da cliente (pelo menos 2 letras).";
    const tel = (f.telefone ?? "").replace(/\D/g, "");
    if (tel && (tel.length < 10 || tel.length > 13)) er["telefone"] = "Confira o telefone: use DDD + número, por exemplo (11) 98765-4321.";
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) er["email"] = "Confira o e-mail, por exemplo maria@gmail.com.";
    setErros(er);
    if (Object.keys(er).length === 0 && !salvar.isPending) salvar.mutate();
  };
  const campo = (k: keyof Cliente) => ({ value: (f[k] as string) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });

  return (
    <div>
      <Topo titulo={id ? "Editar cliente" : "Cadastrar cliente"} ajuda="clientes" voltar={() => ir(id ? { aba: "clientes", id } : { aba: "clientes" })} />
      <form onSubmit={enviar} noValidate className="max-w-2xl space-y-5">
        <Campo rotulo="Nome da cliente" obrigatorio erro={erros["nome"]}>
          <input className="admin-input min-h-14 text-[1.05rem]" autoComplete="off" autoCapitalize="words" {...campo("nome")} />
        </Campo>
        <Campo rotulo="Telefone / WhatsApp" dica="Com DDD. Pode colar o número como estiver." erro={erros["telefone"]}>
          <input className="admin-input min-h-14 text-[1.05rem]" type="tel" inputMode="tel" autoComplete="off"
            value={formatarTelefone(f.telefone ?? "")} onChange={(e) => setF({ ...f, telefone: e.target.value.replace(/\D/g, "").slice(0, 13) })} />
        </Campo>
        <Campo rotulo="E-mail" dica="Opcional." erro={erros["email"]}>
          <input className="admin-input min-h-14 text-[1.05rem]" type="email" inputMode="email" autoComplete="off" {...campo("email")} />
        </Campo>
        <Campo rotulo="Aniversário" dica="Opcional. Ajuda a lembrar de uma mensagem especial.">
          <DateField value={deIso(f.aniversario ?? null)} onChange={(d) => setF({ ...f, aniversario: iso(d) })} fromYear={1930} toYear={new Date().getFullYear()} shortcuts={false} />
        </Campo>
        <Campo rotulo="Do que ela gosta" dica="Ex.: brincos pequenos, prata, presente para a filha.">
          <textarea className="admin-input min-h-24 text-[1.05rem]" maxLength={600} {...campo("preferencias")} />
        </Campo>
        <Campo rotulo="Anotações" dica="Opcional.">
          <textarea className="admin-input min-h-24 text-[1.05rem]" maxLength={1000} {...campo("observacoes")} />
        </Campo>
        <Campo rotulo="Próximo retorno" dica="Quando você quer falar com ela de novo.">
          <DateField value={deIso(f.proximo_retorno ?? null)} onChange={(d) => setF({ ...f, proximo_retorno: iso(d) })} />
        </Campo>
        <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 bg-background/95 px-4 py-3 lg:bottom-0">
          <button type="submit" className="btn-app-principal w-full" disabled={salvar.isPending} aria-busy={salvar.isPending}>
            {salvar.isPending ? "Salvando…" : id ? "Salvar alterações" : "Salvar cliente"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Campo({ rotulo, dica, erro, obrigatorio, children }: { rotulo: string; dica?: string; erro?: string | undefined; obrigatorio?: boolean; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="grid gap-1.5" aria-describedby={erro ? `${id}-e` : undefined}>
      <label htmlFor={`${id}-c`} className="text-[1.05rem] font-semibold">{rotulo}{obrigatorio && <span className="font-normal text-muted-foreground"> (obrigatório)</span>}</label>
      {React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ id?: string; "aria-invalid"?: boolean }>, { id: `${id}-c`, ...(erro ? { "aria-invalid": true } : {}) }) : children}
      {dica && !erro && <p className="text-[0.95rem] text-muted-foreground">{dica}</p>}
      {erro && <p id={`${id}-e`} role="alert" className="text-[0.98rem] font-medium text-destructive">⚠ {erro}</p>}
    </div>
  );
}

export function FichaCliente({ id, nav, ir }: { id: string; nav: Nav; ir: Ir }) {
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ["consultora", "cliente", id], queryFn: () => obterCliente(id) });
  const at = useQuery({ queryKey: ["consultora", "atendimentos", id], queryFn: () => listarAtendimentos(id) });
  const [canal, setCanal] = React.useState<Atendimento["canal"]>("whatsapp");
  const [nota, setNota] = React.useState("");
  const [retorno, setRetorno] = React.useState<Date | undefined>();
  const [abrirReg, setAbrirReg] = React.useState(false);
  const reg = useMutation({
    mutationFn: async () => registrarAtendimento(id, await meuParty(), canal, nota.trim(), iso(retorno)),
    onSuccess: () => { setNota(""); setRetorno(undefined); setAbrirReg(false); qc.invalidateQueries({ queryKey: ["consultora"] }); toast.success("Atendimento registrado."); },
    onError: (e) => toast.error("Não registrou. O texto continua aqui. " + traduzir(e)),
  });
  const voltar = () => ir({ aba: "clientes", q: nav.q });

  if (c.isLoading) return <Estado tipo="carregando" texto="Abrindo ficha…" />;
  if (!c.data) return <Estado tipo="erro" texto="Cliente não encontrada." acao={<button className="admin-btn" onClick={voltar}>Voltar para clientes</button>} />;
  const cl = c.data;
  const whats = linkWhats(cl.telefone, `Olá, ${cl.nome.split(" ")[0]}! Tudo bem?`);

  return (
    <div>
      <Topo titulo={cl.nome} ajuda="clientes" voltar={voltar} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-card p-5">
            <p className="text-[1.1rem]">{cl.telefone ? formatarTelefone(cl.telefone) : "Sem telefone cadastrado"}</p>
            {cl.email && <p className="text-[1.02rem] text-muted-foreground break-all">{cl.email}</p>}
            {cl.aniversario && <p className="mt-1 text-[1.02rem]">Aniversário: {dataBR(cl.aniversario).slice(0, 5)}</p>}
            <div className="mt-4 grid grid-cols-2 gap-2">
              {whats ? <a href={whats} target="_blank" rel="noreferrer" className="admin-btn min-h-13 justify-center text-base"><MessageCircle className="size-5" aria-hidden /> WhatsApp</a>
                : <span className="admin-btn min-h-13 justify-center text-base opacity-60" aria-disabled>Sem WhatsApp</span>}
              {cl.telefone ? <a href={`tel:${cl.telefone}`} className="admin-btn min-h-13 justify-center text-base"><Phone className="size-5" aria-hidden /> Ligar</a>
                : <span className="admin-btn min-h-13 justify-center text-base opacity-60" aria-disabled>Ligar</span>}
            </div>
          </section>
          <button type="button" className="btn-app-principal w-full" onClick={() => ir({ aba: "novo", id: cl.id })}>
            <Plus className="size-5" aria-hidden /> Novo pedido para {cl.nome.split(" ")[0]}
          </button>
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Próximo retorno</h2>
            <p className="text-[1.05rem]">{cl.proximo_retorno ? dataBR(cl.proximo_retorno) : "Nenhum retorno agendado."}</p>
            <h2 className="mt-4 text-lg font-semibold">Do que ela gosta</h2>
            <p className="whitespace-pre-line text-[1.05rem]">{cl.preferencias || "Nada anotado ainda."}</p>
            {cl.observacoes && (<><h2 className="mt-4 text-lg font-semibold">Anotações</h2><p className="whitespace-pre-line text-[1.05rem]">{cl.observacoes}</p></>)}
            <button type="button" className="admin-btn mt-4 min-h-12 text-base" onClick={() => ir({ aba: "clientes", id: cl.id, modo: "editar" })}>Editar dados</button>
          </section>
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Atendimentos</h2>
            {!abrirReg && <button type="button" className="admin-btn min-h-12 text-base" onClick={() => setAbrirReg(true)}><Plus className="size-5" aria-hidden /> Registrar</button>}
          </div>
          {abrirReg && (
            <form className="space-y-4 rounded-2xl border border-primary/40 bg-card p-5" onSubmit={(e) => { e.preventDefault(); if (!reg.isPending) reg.mutate(); }}>
              <div role="radiogroup" aria-label="Como foi o contato" className="grid grid-cols-2 gap-2">
                {(Object.keys(CANAL) as Atendimento["canal"][]).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={canal === k} onClick={() => setCanal(k)}
                    className={`min-h-12 rounded-xl border text-base ${canal === k ? "border-acao bg-acao text-acao-foreground" : "border-border bg-background"}`}>
                    {canal === k ? "✓ " : ""}{CANAL[k]}
                  </button>
                ))}
              </div>
              <Campo rotulo="O que conversaram">
                <textarea className="admin-input min-h-24 text-[1.05rem]" value={nota} maxLength={1000} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: gostou do colar de pérolas, volta a falar sexta." />
              </Campo>
              <Campo rotulo="Agendar próximo retorno" dica="Opcional.">
                <DateField value={retorno} onChange={setRetorno} />
              </Campo>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="admin-btn min-h-13 justify-center text-base" onClick={() => setAbrirReg(false)}>Cancelar</button>
                <button type="submit" className="btn-app-principal" disabled={reg.isPending}>{reg.isPending ? "Salvando…" : "Salvar atendimento"}</button>
              </div>
            </form>
          )}
          {at.isLoading && <Estado tipo="carregando" texto="Carregando histórico…" />}
          {at.data?.length === 0 && !abrirReg && <Estado tipo="vazio" texto="Nenhum atendimento registrado. Toque em “Registrar” depois de conversar com ela." />}
          <ol className="space-y-2">
            {at.data?.map((a) => (
              <li key={a.id} className="rounded-2xl border border-border bg-card p-4">
                <p className="text-[0.95rem] text-muted-foreground">{new Date(a.created_at).toLocaleDateString("pt-BR")} · {CANAL[a.canal]}</p>
                {a.nota && <p className="mt-1 whitespace-pre-line text-[1.05rem]">{a.nota}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ novo pedido */

export function NovoPedido({ clienteInicial, ir }: { clienteInicial?: string | undefined; ir: Ir }) {
  const qc = useQueryClient();
  const [passo, setPasso] = React.useState<1 | 2 | 3 | 4>(clienteInicial ? 2 : 1);
  const [cliente, setCliente] = React.useState<string | undefined>(clienteInicial);
  const [qtd, setQtd] = React.useState<Record<string, number>>({});
  const [busca, setBusca] = React.useState("");
  const [chave] = React.useState(chaveIdempotencia);
  const [resultado, setResultado] = React.useState<{ codigo: string; total_cents: number } | null>(null);
  const clientes = useQuery({ queryKey: ["consultora", "clientes"], queryFn: listarClientes });
  const pecas = useQuery({ queryKey: ["consultora", "pecas"], queryFn: pecasDisponiveis });
  const cl = clientes.data?.find((c) => c.id === cliente);
  const k = (p: Peca) => `${p.cycle_id}:${p.variant_id}`;
  const escolhidas = (pecas.data ?? []).filter((p) => (qtd[k(p)] ?? 0) > 0);
  const total = escolhidas.reduce((s, p) => s + p.preco_cents * (qtd[k(p)] ?? 0), 0);
  const unidades = escolhidas.reduce((s, p) => s + (qtd[k(p)] ?? 0), 0);

  const enviar = useMutation({
    mutationFn: () => criarPedido(cliente!, escolhidas.map((p) => ({ cycle_id: p.cycle_id, variant_id: p.variant_id, quantidade: qtd[k(p)]! })), chave),
    onSuccess: (r) => { setResultado(r); setPasso(4); qc.invalidateQueries({ queryKey: ["consultora"] }); qc.invalidateQueries({ queryKey: ["consultora-pedidos"] }); },
    onError: (e) => toast.error("O pedido não foi criado. Nada se perdeu: revise e tente de novo. " + traduzir(e)),
  });

  const ETAPAS = ["Cliente", "Peças", "Revisão"];
  const voltar = () => (passo > 1 && passo < 4 ? setPasso((passo - 1) as 1 | 2 | 3) : ir(cliente && clienteInicial ? { aba: "clientes", id: cliente } : { aba: "inicio" }));

  return (
    <div>
      <Topo titulo={passo === 4 ? "Pedido criado" : "Novo pedido"} ajuda="pedidos" voltar={passo === 4 ? undefined : voltar} />
      {passo < 4 && (
        <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Etapas">
          {ETAPAS.map((e, i) => {
            const n = i + 1; const feito = passo > n; const atual = passo === n;
            return (
              <li key={e} aria-current={atual ? "step" : undefined}
                className={`rounded-xl border px-2 py-2 text-center text-[0.95rem] ${atual ? "border-primary bg-primary/10 font-semibold" : feito ? "border-border bg-card" : "border-border text-muted-foreground"}`}>
                {feito ? "✓ " : `${n}. `}{e}
              </li>
            );
          })}
        </ol>
      )}

      {cl && passo > 1 && passo < 4 && (
        <p className="mb-4 rounded-xl bg-muted px-4 py-3 text-[1.02rem]">Cliente: <strong>{cl.nome}</strong></p>
      )}

      {passo === 1 && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">Para quem é o pedido?</h2>
          {clientes.isLoading && <Estado tipo="carregando" texto="Carregando clientes…" />}
          {clientes.data?.length === 0 && <Estado tipo="vazio" texto="Cadastre a cliente primeiro." />}
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {clientes.data?.map((c) => (
              <li key={c.id} className="min-w-0">
                <button type="button" onClick={() => { setCliente(c.id); setPasso(2); }}
                  className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left ${cliente === c.id ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
                  <span className="min-w-0"><span className="block truncate text-[1.1rem] font-semibold">{c.nome}</span>
                    <span className="block text-[0.95rem] text-muted-foreground">{c.telefone ? formatarTelefone(c.telefone) : "Sem telefone"}</span></span>
                  <ChevronRight className="size-6 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="admin-btn min-h-13 w-full justify-center text-base" onClick={() => ir({ aba: "clientes", modo: "nova" })}>
            <UserPlus className="size-5" aria-hidden /> Cadastrar nova cliente
          </button>
        </div>
      )}

      {passo === 2 && (
        <div className="space-y-4 pb-28 lg:pb-0">
          <h2 className="text-xl font-semibold">Escolha as peças da sua maleta</h2>
          <input type="search" className="admin-input min-h-14 rounded-2xl text-[1.05rem]" placeholder="Buscar peça" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar peça" />
          {pecas.isLoading && <Estado tipo="carregando" texto="Carregando peças…" />}
          {pecas.isError && <Estado tipo="erro" texto="Não foi possível carregar as peças." acao={<button className="admin-btn" onClick={() => pecas.refetch()}>Tentar de novo</button>} />}
          {pecas.data?.length === 0 && <Estado tipo="vazio" texto="Você não tem peças disponíveis. Os pedidos usam as peças de uma maleta recebida e conferida." />}
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(pecas.data ?? []).filter((p) => semAcento(`${p.produto} ${p.variante ?? ""}`).includes(semAcento(busca))).map((p) => {
              const n = qtd[k(p)] ?? 0;
              const set = (v: number) => setQtd((q) => ({ ...q, [k(p)]: Math.max(0, Math.min(p.disponivel, v)) }));
              return (
                <li key={k(p)} className={`flex gap-3 rounded-2xl border bg-card p-3 ${n > 0 ? "border-primary" : "border-border"}`}>
                  {imagem(p.media_id)
                    ? <img src={imagem(p.media_id)!} alt="" loading="lazy" className="size-24 shrink-0 rounded-xl object-cover" />
                    : <div className="grid size-24 shrink-0 place-items-center rounded-xl bg-muted text-center text-sm text-muted-foreground">Sem foto</div>}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="text-[1.05rem] font-semibold leading-snug">{p.produto}</p>
                    <p className="text-[0.95rem] text-muted-foreground">{p.variante ?? "Tamanho único"} · {p.disponivel} disponível{p.disponivel > 1 ? "is" : ""}</p>
                    <p className="text-[1.1rem] font-semibold">{brl(p.preco_cents)}</p>
                    <div className="mt-auto flex items-center gap-2 pt-2" role="group" aria-label={`Quantidade de ${p.produto}`}>
                      <button type="button" className="grid size-12 place-items-center rounded-full border border-border text-2xl disabled:opacity-40" disabled={n <= 0} onClick={() => set(n - 1)} aria-label="Diminuir">−</button>
                      <span className="num w-8 text-center text-xl font-semibold" aria-live="polite">{n}</span>
                      <button type="button" className="grid size-12 place-items-center rounded-full border border-border text-2xl disabled:opacity-40" disabled={n >= p.disponivel} onClick={() => set(n + 1)} aria-label="Aumentar">+</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {(pecas.data?.length ?? 0) > 0 && <div className="fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:static lg:rounded-2xl lg:border">
            <div className="mx-auto flex max-w-5xl items-center gap-3">
              <p className="min-w-0 flex-1 text-[1.02rem]"><strong>{unidades}</strong> peça{unidades === 1 ? "" : "s"} · <strong>{brl(total)}</strong></p>
              <button type="button" className="btn-app-principal" disabled={unidades === 0} onClick={() => setPasso(3)}>Revisar pedido</button>
            </div>
          </div>}
        </div>
      )}

      {passo === 3 && (
        <div className="max-w-2xl space-y-4">
          <h2 className="text-xl font-semibold">Confira antes de criar</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {escolhidas.map((p) => (
              <li key={k(p)} className="flex items-center gap-3 p-4">
                {imagem(p.media_id) ? <img src={imagem(p.media_id)!} alt="" className="size-14 rounded-lg object-cover" /> : <div className="size-14 rounded-lg bg-muted" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="text-[1.02rem] font-semibold">{p.produto}</p>
                  <p className="text-[0.95rem] text-muted-foreground">{p.variante ?? "Tamanho único"} · {qtd[k(p)]} × {brl(p.preco_cents)}</p>
                </div>
                <p className="num text-[1.05rem] font-semibold">{brl(p.preco_cents * (qtd[k(p)] ?? 0))}</p>
              </li>
            ))}
            <li className="flex items-center justify-between p-4 text-xl"><span>Total</span><strong className="num">{brl(total)}</strong></li>
          </ul>
          <div className="rounded-2xl border border-border bg-muted/60 p-4 text-[1.02rem] leading-relaxed">
            <p><strong>Pagamento e entrega:</strong> você combina diretamente com a cliente.</p>
            <p className="mt-1">Este pedido fica <strong>em atendimento</strong>. Ele <strong>não reserva as peças</strong> e ainda <strong>não é uma venda</strong>: o registro de venda e pagamento será liberado quando a Lardan definir essas regras.</p>
          </div>
          <button type="button" className="btn-app-principal w-full" disabled={enviar.isPending} aria-busy={enviar.isPending} onClick={() => !enviar.isPending && enviar.mutate()}>
            {enviar.isPending ? "Criando pedido…" : "Confirmar pedido"}
          </button>
          <button type="button" className="admin-btn min-h-12 w-full justify-center text-base" onClick={() => setPasso(2)}>Alterar peças</button>
        </div>
      )}

      {passo === 4 && resultado && (
        <div className="max-w-xl space-y-4">
          <div className="rounded-3xl border border-primary/40 bg-card p-6 text-center">
            <span className="mx-auto mb-3 grid size-16 place-items-center rounded-full bg-acao text-acao-foreground"><Check className="size-8" aria-hidden /></span>
            <p className="text-xl font-semibold">Pedido {resultado.codigo} criado</p>
            <p className="mt-1 text-[1.05rem]">{cl?.nome} · {brl(resultado.total_cents)}</p>
            <p className="mt-2 text-[0.98rem] text-muted-foreground">Situação: em atendimento. As peças não foram reservadas.</p>
          </div>
          {cl && linkWhats(cl.telefone) && (
            <a className="btn-app-principal w-full" target="_blank" rel="noreferrer"
              href={linkWhats(cl.telefone, `Olá, ${cl.nome.split(" ")[0]}! Anotei seu pedido ${resultado.codigo}:\n${escolhidas.map((p) => `• ${qtd[k(p)]}x ${p.produto}${p.variante ? ` (${p.variante})` : ""} — ${brl(p.preco_cents * (qtd[k(p)] ?? 0))}`).join("\n")}\nTotal: ${brl(resultado.total_cents)}`)!}>
              <MessageCircle className="size-5" aria-hidden /> Enviar resumo pelo WhatsApp
            </a>
          )}
          <button type="button" className="admin-btn min-h-13 w-full justify-center text-base" onClick={() => ir({ aba: "pedidos" })}>Ver meus pedidos</button>
          <button type="button" className="admin-btn min-h-13 w-full justify-center text-base" onClick={() => ir({ aba: "inicio" })}>Voltar ao início</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ mais */

export function Mais({ ir }: { ir: Ir }) {
  const sair = async () => { await supabase.auth.signOut(); window.location.href = "/equipe"; };
  const itens = [
    { r: "Minha vitrine", d: "Foto, capa, peças e link para compartilhar", i: Store, n: { aba: "vitrine" } as Nav },
    { r: "Entregas da maleta", d: "Histórico de envios e recebimentos", i: PackageCheck, n: { aba: "historico" } as Nav },
  ];
  return (
    <div>
      <Topo titulo="Mais" ajuda="inicio" />
      <ul className="space-y-3">
        {itens.map((x) => (
          <li key={x.r}>
            <button type="button" onClick={() => ir(x.n)} className="flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left active:bg-muted">
              <x.i className="size-7 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1"><span className="block text-[1.1rem] font-semibold">{x.r}</span><span className="block text-[0.98rem] text-muted-foreground">{x.d}</span></span>
              <ChevronRight className="size-6 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
        <li className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
          <CircleHelp className="size-7 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block text-[1.1rem] font-semibold">Central de Ajuda</span><span className="block text-[0.98rem] text-muted-foreground">Passo a passo de cada tela</span></span>
          <BotaoAjuda />
        </li>
      </ul>
      <button type="button" onClick={sair} className="admin-btn mt-8 min-h-13 w-full justify-center text-base"><LogOut className="size-5" aria-hidden /> Sair da conta</button>
    </div>
  );
}

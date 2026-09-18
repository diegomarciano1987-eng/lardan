import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CreditCard,
  Gem,
  GraduationCap,
  PiggyBank,
  Target,
  WalletCards,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FERRAMENTAS } from "@/lib/seja-lardan-conteudo";

type EcossistemaContextValue = {
  abrirEcossistema: () => void;
};

const EcossistemaContext = createContext<EcossistemaContextValue | null>(null);

const CHAVES = [
  "vitrine",
  "financeiro",
  "financas",
  "pagamentos",
  "metas",
  "universidade",
] as const;
const ICONES = {
  vitrine: Gem,
  financeiro: WalletCards,
  financas: PiggyBank,
  pagamentos: CreditCard,
  metas: Target,
  universidade: GraduationCap,
} as const;

const RECURSOS = CHAVES.map((chave) => {
  const recurso = FERRAMENTAS.find((item) => item.chave === chave);
  if (!recurso) throw new Error(`Recurso do Ecossistema Lardan ausente: ${chave}`);
  return recurso;
});

export function useEcossistemaLardan() {
  const context = useContext(EcossistemaContext);
  if (!context) {
    throw new Error("useEcossistemaLardan deve ser usado dentro de EcossistemaLardanProvider");
  }
  return context;
}

export function EcossistemaLardanProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const tituloId = useId();
  const fecharRef = useRef<HTMLButtonElement>(null);
  const origemRef = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();

  const abrirEcossistema = useCallback(() => {
    origemRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAberto(true);
  }, []);

  const fechar = useCallback(() => setAberto(false), []);

  const irParaCandidatura = useCallback(() => {
    fechar();
    void navigate({ to: "/seja-lardan", hash: "inicio" });
  }, [fechar, navigate]);

  useEffect(() => {
    if (!aberto) return;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => fecharRef.current?.focus(), 80);
    const aoPressionar = (event: KeyboardEvent) => {
      if (event.key === "Escape") fechar();
    };
    window.addEventListener("keydown", aoPressionar);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", aoPressionar);
      document.body.style.overflow = overflowAnterior;
      origemRef.current?.focus();
    };
  }, [aberto, fechar]);

  return (
    <EcossistemaContext.Provider value={{ abrirEcossistema }}>
      {children}
      {aberto ? (
        <div
          className="ecossistema-modal fixed inset-0 z-[100] overflow-y-auto bg-foreground/72 p-3 backdrop-blur-lg sm:p-6 md:p-10"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) fechar();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={tituloId}
            className="ecossistema-panel relative mx-auto min-h-[calc(100dvh-1.5rem)] max-w-7xl overflow-hidden border border-background/20 bg-foreground text-background shadow-[0_40px_120px_-30px_color-mix(in_oklab,var(--foreground)_90%,transparent)] sm:min-h-0"
          >
            <div aria-hidden className="ecossistema-light pointer-events-none absolute inset-0" />

            <header className="sticky top-0 z-20 flex items-center justify-between border-b border-background/15 bg-foreground/88 px-5 py-4 backdrop-blur-xl sm:px-8 md:px-10">
              <div className="flex items-center gap-3">
                <Gem className="h-4 w-4 text-primary" strokeWidth={1.4} />
                <p className="text-[0.625rem] uppercase tracking-[0.28em] text-background/65">
                  Ecossistema Lardan
                </p>
              </div>
              <Button
                ref={fecharRef}
                type="button"
                variant="ghost"
                size="icon"
                onClick={fechar}
                aria-label="Fechar Ecossistema Lardan"
                className="rounded-full border border-background/20 text-background hover:bg-background/10 hover:text-background"
              >
                <X className="h-4 w-4" strokeWidth={1.4} />
              </Button>
            </header>

            <div className="relative px-5 pb-10 pt-10 sm:px-8 md:px-10 md:pb-12 md:pt-12">
              <div className="max-w-3xl">
                <p className="mb-4 text-[0.625rem] uppercase tracking-[0.28em] text-primary">
                  Tecnologia para vender, organizar e crescer
                </p>
                <h2 id={tituloId} className="text-4xl leading-[1.05] text-background sm:text-5xl md:text-6xl">
                  Uma estrutura inteira ao lado da consultora.
                </h2>
                <p className="mt-6 max-w-2xl text-base leading-relaxed text-background/72">
                  Cada frente resolve uma parte da operação: ter vitrine própria, entender o dinheiro
                  do negócio e o da própria casa, receber bem, bater metas e continuar aprendendo a
                  vender.
                </p>
              </div>

              <div className="mt-10 grid gap-px overflow-hidden border border-background/15 bg-background/15 md:grid-cols-2">
                {RECURSOS.map((recurso, index) => {
                  const Icone = ICONES[recurso.chave as keyof typeof ICONES];
                  return (
                    <article
                      key={recurso.chave}
                      className="ecossistema-card group relative bg-foreground/94 p-6 transition-colors duration-500 hover:bg-foreground sm:p-8 md:min-h-[22rem] md:p-10"
                      style={{ animationDelay: `${120 + index * 90}ms` }}
                    >
                      <div className="flex items-start justify-between gap-6">
                        <span className="grid h-11 w-11 place-items-center rounded-full border border-background/20 text-primary transition-colors duration-500 group-hover:border-background/45">
                          <Icone className="h-5 w-5" strokeWidth={1.25} />
                        </span>
                        <span className="font-display text-3xl text-background/20 transition-colors duration-500 group-hover:text-background/35">
                          0{index + 1}
                        </span>
                      </div>
                      <p className="mt-8 text-[0.625rem] uppercase tracking-[0.24em] text-primary">
                        {recurso.eyebrow}
                      </p>
                      <h3 className="mt-3 max-w-xl text-2xl leading-tight text-background sm:text-3xl">
                        {recurso.titulo}
                      </h3>
                      <p className="mt-5 max-w-xl text-sm leading-relaxed text-background/68">
                        {recurso.texto}
                      </p>
                      <ul className="mt-6 flex flex-wrap gap-2">
                        {recurso.itens.map((item) => (
                          <li
                            key={item}
                            className="border border-background/15 px-3 py-2 text-[0.6875rem] leading-snug text-background/78"
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-7 text-[0.5625rem] uppercase tracking-[0.24em] text-background/38">
                        Ecossistema Lardan
                      </p>
                    </article>
                  );
                })}
              </div>

              <div className="mt-10 border border-background/15 bg-background/[0.06] p-6 sm:p-8 md:p-10">
                <div className="flex flex-col gap-7 md:flex-row md:items-end md:justify-between md:gap-12">
                  <div className="max-w-2xl">
                    <p className="text-[0.625rem] uppercase tracking-[0.24em] text-primary">
                      Comece com a estrutura pronta
                    </p>
                    <h3 className="mt-3 text-2xl leading-tight text-background sm:text-3xl">
                      A candidatura é o primeiro passo. Depois vem análise, conversa, onboarding e a
                      primeira maleta.
                    </h3>
                    <p className="mt-4 text-sm leading-relaxed text-background/68">
                      Toda candidatura é analisada pela equipe Lardan. Não há promessa de renda, de
                      aprovação ou de prazo.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={irParaCandidatura}
                    className="h-auto shrink-0 rounded-none bg-background px-7 py-4 text-[0.6875rem] font-normal uppercase tracking-[0.22em] text-foreground shadow-none hover:bg-background hover:text-foreground/90"
                  >
                    Quero me candidatar
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </EcossistemaContext.Provider>
  );
}

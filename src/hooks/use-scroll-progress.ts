import { useEffect, useRef, useState } from "react";

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/* -------------------------------------------------------------------------
 * Um único laço de rolagem para a página inteira.
 * Em vez de cada sessão registrar o próprio listener + requestAnimationFrame,
 * todas assinam o mesmo laço. Isso reduz drasticamente o trabalho por quadro
 * em máquinas fracas e no Safari (iPhone/Mac), onde cada listener extra
 * atrasa a rolagem.
 * ---------------------------------------------------------------------- */
type Measure = () => void;
const subscribers = new Set<Measure>();
let frame = 0;
let bound = false;

function runFrame() {
  frame = 0;
  for (const fn of subscribers) fn();
}

function schedule() {
  if (frame === 0) frame = requestAnimationFrame(runFrame);
}

function bind() {
  if (bound || typeof window === "undefined") return;
  bound = true;
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
}

/**
 * Progresso 0→1 da rolagem de um elemento-trilho (altura maior que a viewport).
 * Só mede enquanto a sessão está próxima da tela e arredonda o valor, para
 * evitar renderizações desnecessárias a cada pixel rolado.
 */
export function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let visivel = true;
    let ultimo = -1;

    const measure: Measure = () => {
      if (!visivel) return;
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      const bruto = total > 0 ? clamp01(-rect.top / total) : 0;
      // Passo imperceptível ao olho e muito mais leve para o navegador.
      // No Safari usamos um passo maior: menos repinturas por rolagem.
      const passos = isAppleWebKit() ? 90 : 150;
      const q = Math.round(bruto * passos) / passos;
      if (q !== ultimo) {
        ultimo = q;
        setProgress(q);
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        visivel = entries[0]?.isIntersecting ?? true;
        if (visivel) measure();
      },
      { rootMargin: "20% 0px 20% 0px" },
    );
    io.observe(el);

    bind();
    subscribers.add(measure);
    measure();

    return () => {
      io.disconnect();
      subscribers.delete(measure);
    };
  }, []);

  return { ref, progress, reduced };
}

/** Respeita a preferência do sistema por menos movimento. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => setReduced(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);
  return reduced;
}

/**
 * "leve" em aparelhos com pouca folga (celulares, notebooks antigos):
 * usamos menos camadas e efeitos mais baratos para manter 60fps.
 */
export function useDeviceTier(): "leve" | "pleno" {
  const [tier, setTier] = useState<"leve" | "pleno">("pleno");
  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const poucaCPU = (nav.hardwareConcurrency ?? 8) <= 4;
    const poucaMemoria = (nav.deviceMemory ?? 8) <= 4;
    const telaPequena = window.matchMedia("(max-width: 900px)").matches;
    setTier(poucaCPU || poucaMemoria || telaPequena ? "leve" : "pleno");
  }, []);
  return tier;
}

export function phase(progress: number, a: number, b: number) {
  return clamp01((progress - a) / (b - a));
}

export function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 4);
}

/* -------------------------------------------------------------------------
 * Aparelhos Apple (Safari no iPhone, iPad e Mac) pintam desfoque de fundo,
 * blur animado e mistura de camadas por CPU. Detectamos o motor WebKit para
 * trocar esses efeitos por versões equivalentes e baratas — o Windows e o
 * Android continuam com a versão completa.
 * ---------------------------------------------------------------------- */
let appleCache: boolean | null = null;

export function isAppleWebKit(): boolean {
  if (appleCache !== null) return appleCache;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iP(hone|ad|od)/.test(ua);
  const macTouch =
    /Macintosh/.test(ua) && typeof document !== "undefined" && navigator.maxTouchPoints > 1;
  const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
  appleCache = iOS || macTouch || safari;
  return appleCache;
}

/** true em Safari/iOS. Também marca <html class="is-apple"> para ajustes de CSS. */
export function useAppleWebKit(): boolean {
  const [apple, setApple] = useState(false);
  useEffect(() => {
    const v = isAppleWebKit();
    setApple(v);
    if (v) document.documentElement.classList.add("is-apple");
  }, []);
  return apple;
}

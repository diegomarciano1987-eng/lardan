/**
 * Garante que números (valores, contagens, porcentagens) nunca vazem do card.
 * Observa a página inteira: qualquer elemento folha cujo texto é um número e que
 * transborda a largura disponível tem a fonte reduzida até caber (mínimo 55%).
 * Recalcula quando o texto muda ou a tela é redimensionada.
 */
const NUMERO = /^[\s(+\-−]*(R\$\s*)?[\d.,\s%x−\-+/:]+[)\s%]*$/;
const MIN = 0.55;

function ajustar(el: HTMLElement) {
  const txt = el.textContent ?? "";
  if (txt.length > 28 || !/\d/.test(txt) || !NUMERO.test(txt)) {
    if (el.dataset["ncBase"]) { el.style.fontSize = ""; el.style.whiteSpace = ""; delete el.dataset["ncBase"]; }
    return;
  }
  if (el.dataset["ncBase"]) el.style.fontSize = "";
  const base = parseFloat(getComputedStyle(el).fontSize);
  if (!base || base < 15) return; // só números de destaque
  const largura = el.clientWidth;
  if (!largura) return;
  el.style.whiteSpace = "nowrap";
  if (el.scrollWidth <= largura + 1) { el.style.whiteSpace = ""; if (el.dataset["ncBase"]) delete el.dataset["ncBase"]; return; }
  const fator = Math.max(MIN, (largura / el.scrollWidth) * 0.97);
  el.dataset["ncBase"] = String(base);
  el.style.fontSize = `${(base * fator).toFixed(2)}px`;
}

function candidatos(raiz: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  raiz.querySelectorAll<HTMLElement>("p,strong,span,div,dd,h2,h3,h4,b").forEach((el) => {
    if (el.childElementCount === 0 && el.textContent && /\d/.test(el.textContent)) out.push(el);
  });
  return out;
}

export function iniciarNumerosCabem(): () => void {
  if (typeof window === "undefined") return () => {};
  let pendente = false;
  const sujos = new Set<HTMLElement>();
  let tudo = true;
  const rodar = () => {
    pendente = false;
    const lista = tudo ? candidatos(document.body) : [...sujos];
    tudo = false; sujos.clear();
    for (const el of lista) if (el.isConnected) ajustar(el);
  };
  const agendar = () => { if (!pendente) { pendente = true; requestAnimationFrame(rodar); } };
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      const alvo = m.target instanceof HTMLElement ? m.target : m.target.parentElement;
      if (!alvo) continue;
      if (m.type === "characterData") sujos.add(alvo);
      else if (alvo.childElementCount === 0) sujos.add(alvo);
      else candidatos(alvo).forEach((e) => sujos.add(e));
    }
    agendar();
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  let t: ReturnType<typeof setTimeout> | undefined;
  const aoRedimensionar = () => { clearTimeout(t); t = setTimeout(() => { tudo = true; agendar(); }, 120); };
  window.addEventListener("resize", aoRedimensionar);
  agendar();
  return () => { mo.disconnect(); window.removeEventListener("resize", aoRedimensionar); clearTimeout(t); };
}

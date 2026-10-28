/** Quadro invisível: sem aba, sem PDF e sem janela intermediária do LARDAN. */
export function imprimirHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) { frame.remove(); throw new Error("Não foi possível preparar a impressão."); }
  doc.open(); doc.write(html); doc.close();
  const limpar = () => window.setTimeout(() => frame.remove(), 1000);
  win.addEventListener("afterprint", limpar, { once: true });
  window.setTimeout(() => { try { win.focus(); win.print(); } finally { window.setTimeout(() => frame.isConnected && frame.remove(), 60_000); } }, 150);
}


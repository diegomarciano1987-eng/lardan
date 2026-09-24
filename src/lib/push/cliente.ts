/**
 * LARDAN — ativação do aviso no navegador (computador e celular).
 *
 * A chave pública abaixo é pública por natureza: ela apenas identifica o
 * remetente dos avisos para o navegador. A chave privada fica só no servidor.
 */
export const VAPID_PUBLIC_KEY =
  "BFku2rgYiShxkWxmRBcQJER9-uVu3B1uO8U25sW4MrF1TYV3H8pEyStcwLsVndlYYB91h53LkKt7LHjdu7EPedw";

export type EstadoAviso =
  | "ativo"
  | "inativo"
  | "negado"
  | "sem_suporte"
  | "abrir_em_nova_aba"
  | "ios_instalar";

export interface InscricaoPush {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
}

function base64UrlParaBytes(valor: string): Uint8Array {
  const preenchido = valor.replace(/-/g, "+").replace(/_/g, "/");
  const completo = preenchido + "=".repeat((4 - (preenchido.length % 4)) % 4);
  const bruto = atob(completo);
  const bytes = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i += 1) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

function bytesParaBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let texto = "";
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** iPhone/iPad (inclui iPad que se apresenta como Mac). */
export function ehIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Aberto pelo ícone da Tela de Início (modo app). */
export function emModoApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function suportaAviso(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** Dentro do quadro de pré-visualização o navegador recusa o pedido em silêncio. */
export function dentroDeIframe(): boolean {
  return typeof window !== "undefined" && window.top !== window.self;
}

export async function estadoAtual(): Promise<EstadoAviso> {
  // No iPhone o aviso só existe no painel aberto pelo ícone da Tela de Início.
  if (ehIOS() && !emModoApp()) return "ios_instalar";
  if (!suportaAviso()) return ehIOS() ? "ios_instalar" : "sem_suporte";
  if (Notification.permission === "denied") return "negado";
  try {
    // Nunca deixa o botão travado esperando o navegador responder.
    const inscricao = await Promise.race([
      navigator.serviceWorker
        .getRegistration("/lardan-push-sw.js")
        .then((r) => r?.pushManager.getSubscription() ?? null),
      new Promise<null>((ok) => setTimeout(() => ok(null), 3000)),
    ]);
    return inscricao ? "ativo" : "inativo";
  } catch {
    return "inativo";
  }
}

/** Pede a permissão e devolve a inscrição para guardar no servidor. */
export async function ativarAviso(): Promise<
  { ok: true; inscricao: InscricaoPush } | { ok: false; estado: EstadoAviso }
> {
  if (ehIOS() && !emModoApp()) return { ok: false, estado: "ios_instalar" };
  if (!suportaAviso()) return { ok: false, estado: "sem_suporte" };
  if (dentroDeIframe()) return { ok: false, estado: "abrir_em_nova_aba" };

  const permissao =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (permissao !== "granted") return { ok: false, estado: "negado" };

  const registro = await navigator.serviceWorker.register("/lardan-push-sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  const existente = await registro.pushManager.getSubscription();
  const inscricao =
    existente ??
    (await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlParaBytes(VAPID_PUBLIC_KEY) as BufferSource,
    }));

  return {
    ok: true,
    inscricao: {
      endpoint: inscricao.endpoint,
      p256dh: bytesParaBase64Url(inscricao.getKey("p256dh")),
      auth: bytesParaBase64Url(inscricao.getKey("auth")),
      user_agent: navigator.userAgent.slice(0, 300),
    },
  };
}

/** Desliga o aviso neste aparelho e devolve o endereço para apagar no servidor. */
export async function desativarAviso(): Promise<string | null> {
  if (!suportaAviso()) return null;
  const registro = await navigator.serviceWorker.getRegistration("/lardan-push-sw.js");
  const inscricao = await registro?.pushManager.getSubscription();
  if (!inscricao) return null;
  const endereco = inscricao.endpoint;
  await inscricao.unsubscribe();
  return endereco;
}

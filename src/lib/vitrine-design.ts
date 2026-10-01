import { supabase } from "@/integrations/supabase/client";
import type { VitrineItem } from "@/lib/maletas";

/** Configuração visual da vitrine. O servidor valida e limpa tudo de novo. */
export interface Foco { x: number; y: number }
export interface DesignVitrine {
  slug: string;
  perfil: { nome: string; frase: string; bio: string; cidade: string; regiao: string; horarios: string; mensagem: string };
  contato: { whatsapp: string; instagram: string; facebook: string; tiktok: string };
  compartilhar: { titulo: string; descricao: string; imagem?: string | null };
  aparencia: { tema: Tema; paleta: Paleta; fonte: Fonte; cartao: Cartao; grade: Grade };
  imagens: {
    avatar?: { path: string; path2x?: string | null; original?: string | null; crop?: Recorte | null };
    capa?: { preset?: CapaOficial; path?: string; path_m?: string | null; original?: string | null; foco_desktop?: Foco; foco_mobile?: Foco };
  };
  organizacao: {
    destaques: string[];
    ordem: string[];
    ocultas: string[];
    selecoes: { titulo: string; itens: string[] }[];
    secoes: Secao[];
    fotos: Record<string, string>;
  };
}
export type Tema = "classica" | "editorial" | "minimalista";
export type Paleta = "perola" | "rose" | "champanhe" | "noite";
export type Fonte = "marca" | "moderna" | "delicada";
export type Cartao = "suave" | "moldura" | "limpo";
export type Grade = "2" | "3" | "lista";
export type Secao = "destaques" | "selecoes" | "catalogo";
export type CapaOficial = "vidro" | "sessao" | "aneis" | "colares" | "pulseiras" | "brincos";
export interface Recorte { x: number; y: number; zoom: number; rot: number }

export const TEMAS: { id: Tema; nome: string; texto: string }[] = [
  { id: "classica", nome: "Clássica", texto: "Retrato sobre a capa, tudo claro e com foco nas peças." },
  { id: "editorial", nome: "Editorial", texto: "Capa grande, perfil ao lado e fotos em destaque." },
  { id: "minimalista", nome: "Minimalista", texto: "Poucos elementos, muito espaço e navegação direta." },
];
export const PALETAS: { id: Paleta; nome: string }[] = [
  { id: "perola", nome: "Pérola" },
  { id: "rose", nome: "Rosé" },
  { id: "champanhe", nome: "Champanhe" },
  { id: "noite", nome: "Noite" },
];
export const FONTES: { id: Fonte; nome: string; amostra: string }[] = [
  { id: "marca", nome: "Assinatura Lardan", amostra: "Serifada da marca" },
  { id: "moderna", nome: "Moderna", amostra: "Traço limpo e atual" },
  { id: "delicada", nome: "Delicada", amostra: "Fina e elegante" },
];
export const CARTOES: { id: Cartao; nome: string }[] = [
  { id: "suave", nome: "Cantos suaves" },
  { id: "moldura", nome: "Com moldura" },
  { id: "limpo", nome: "Sem borda" },
];
export const GRADES: { id: Grade; nome: string }[] = [
  { id: "2", nome: "2 por linha" },
  { id: "3", nome: "3 por linha" },
  { id: "lista", nome: "Lista" },
];
export const CAPAS: { id: CapaOficial; nome: string; desktop: string; mobile: string }[] = [
  { id: "vidro", nome: "Brilho", desktop: "/img/lardan-hero-vidro.webp", mobile: "/img/lardan-mobile-hero.webp" },
  { id: "sessao", nome: "Ensaio", desktop: "/img/lardan-sessao2.webp", mobile: "/img/lardan-mobile-sessao2.webp" },
  { id: "aneis", nome: "Anéis", desktop: "/img/lardan-categoria-aneis.webp", mobile: "/img/lardan-mobile-aneis.webp" },
  { id: "colares", nome: "Colares", desktop: "/img/lardan-categoria-colares.webp", mobile: "/img/sessao_colares_mobile.webp" },
  { id: "pulseiras", nome: "Pulseiras", desktop: "/img/lardan-pulseiras-fundo-novo.webp", mobile: "/img/lardan-mobile-pulseiras.webp" },
  { id: "brincos", nome: "Brincos", desktop: "/img/lardan-brincos-fundo-novo.webp", mobile: "/img/lardan-mobile-brincos.webp" },
];
export const SECOES_NOME: Record<Secao, string> = {
  destaques: "Peças em destaque",
  selecoes: "Minhas seleções",
  catalogo: "Todas as peças",
};
export const LIMITES = { nome: 60, frase: 90, bio: 400, cidade: 60, regiao: 80, horarios: 120, mensagem: 240, titulo: 70, descricao: 160 };

export function designPadrao(base?: Partial<DesignVitrine>): DesignVitrine {
  return {
    slug: base?.slug ?? "",
    perfil: { nome: "", frase: "", bio: "", cidade: "", regiao: "", horarios: "", mensagem: "", ...base?.perfil },
    contato: { whatsapp: "", instagram: "", facebook: "", tiktok: "", ...base?.contato },
    compartilhar: { titulo: "", descricao: "", imagem: null, ...base?.compartilhar },
    aparencia: { tema: "classica", paleta: "perola", fonte: "marca", cartao: "suave", grade: "3", ...base?.aparencia },
    imagens: { ...base?.imagens },
    organizacao: {
      destaques: [], ordem: [], ocultas: [], selecoes: [], secoes: ["destaques", "selecoes", "catalogo"], fotos: {},
      ...base?.organizacao,
    },
  };
}

/** Endereço público de um arquivo publicado da vitrine. */
export const arquivoPublico = (path?: string | null) => (path ? `/api/public/vitrine-img/${path}` : null);

export interface EstudioDados {
  party_id: string;
  nome_cadastro: string;
  slug: string | null;
  no_ar: boolean;
  rascunho: Partial<DesignVitrine>;
  publicado: DesignVitrine | null;
  publicado_em: string | null;
  revisao: number;
  itens: (VitrineItem & { midias: string[] })[];
  versoes: { id: string; numero: number; em: string }[];
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (supabase.rpc as unknown as (f: string, a: unknown) => Promise<{ data: T; error: unknown }>)(fn, args);
  if (error) throw error;
  return data;
}
export const estudioCarregar = () => rpc<EstudioDados>("showcase_design_get");
export const estudioSalvar = (d: DesignVitrine, revisao: number) =>
  rpc<{ revisao: number; rascunho: DesignVitrine }>("showcase_design_save", { _draft: d, _revision: revisao });
export const estudioPublicar = (revisao: number) =>
  rpc<{ versao?: number; slug: string; repetido?: boolean }>("showcase_design_publish", { _revision: revisao });
export const estudioDescartar = () => rpc<{ revisao: number }>("showcase_design_discard");
export const estudioRestaurar = (id: string) => rpc<{ revisao: number }>("showcase_design_restore", { _version: id });
export const estudioNoAr = (v: boolean) => rpc<{ no_ar: boolean }>("showcase_set_online", { _no_ar: v });

/** Envia um arquivo para a pasta privada da consultora e devolve o caminho. */
export async function enviarArquivo(party: string, tipo: "pub" | "orig", blob: Blob, sufixo = "") {
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  const path = `${party}/${tipo}/${crypto.randomUUID()}${sufixo}.${ext}`;
  const { error } = await supabase.storage.from("vitrine-originais").upload(path, blob, {
    contentType: blob.type, upsert: false, cacheControl: "31536000",
  });
  if (error) throw error;
  return path;
}

/** Links temporários para a prévia do rascunho (somente a dona enxerga). */
export async function linksPrevia(paths: string[]) {
  const limpos = Array.from(new Set(paths.filter(Boolean)));
  if (!limpos.length) return {} as Record<string, string>;
  const { data } = await supabase.storage.from("vitrine-originais").createSignedUrls(limpos, 3600);
  const m: Record<string, string> = {};
  (data ?? []).forEach((d) => { if (d.path && d.signedUrl) m[d.path] = d.signedUrl; });
  return m;
}

export function whatsappLink(numero?: string | null) {
  let d = (numero ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length < 10) return null;
  if (!(d.startsWith("55") && d.length >= 12)) d = `55${d}`;
  return `https://wa.me/${d}`;
}

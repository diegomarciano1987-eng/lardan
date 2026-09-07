// Carrinho local (somente no navegador da visitante). Ainda não há checkout:
// serve para a vitrine mostrar a sacola e a página de carrinho.
import { useSyncExternalStore } from "react";

export type ItemCarrinho = {
  slug: string;
  nome: string;
  variante: string | null;
  precoCents: number | null;
  mediaId: string | null;
  quantidade: number;
};

const CHAVE = "lardan:carrinho:v1";
let cache: ItemCarrinho[] = [];
let carregado = false;
const ouvintes = new Set<() => void>();

function ler(): ItemCarrinho[] {
  if (typeof window === "undefined") return [];
  try {
    const cru = window.localStorage.getItem(CHAVE);
    const dados = cru ? (JSON.parse(cru) as ItemCarrinho[]) : [];
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

function gravar(itens: ItemCarrinho[]) {
  cache = itens;
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(itens));
  } catch {
    /* modo privado: mantém só em memória */
  }
  ouvintes.forEach((f) => f());
}

function assinar(f: () => void) {
  if (!carregado) {
    cache = ler();
    carregado = true;
  }
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

function snapshot() {
  if (!carregado) {
    cache = ler();
    carregado = true;
  }
  return cache;
}

const vazio: ItemCarrinho[] = [];

export function useCarrinho() {
  return useSyncExternalStore(assinar, snapshot, () => vazio);
}

function chave(i: { slug: string; variante: string | null }) {
  return `${i.slug}::${i.variante ?? ""}`;
}

export function adicionarAoCarrinho(item: Omit<ItemCarrinho, "quantidade">, quantidade = 1) {
  const atual = snapshot();
  const idx = atual.findIndex((i) => chave(i) === chave(item));
  if (idx >= 0) {
    const copia = atual.slice();
    copia[idx] = { ...copia[idx], quantidade: copia[idx].quantidade + quantidade };
    gravar(copia);
  } else {
    gravar([...atual, { ...item, quantidade }]);
  }
}

export function alterarQuantidade(slug: string, variante: string | null, quantidade: number) {
  const alvo = chave({ slug, variante });
  const proximo = snapshot()
    .map((i) => (chave(i) === alvo ? { ...i, quantidade } : i))
    .filter((i) => i.quantidade > 0);
  gravar(proximo);
}

export function removerDoCarrinho(slug: string, variante: string | null) {
  const alvo = chave({ slug, variante });
  gravar(snapshot().filter((i) => chave(i) !== alvo));
}

export function limparCarrinho() {
  gravar([]);
}

export function totalItens(itens: ItemCarrinho[]) {
  return itens.reduce((s, i) => s + i.quantidade, 0);
}

export function subtotalCents(itens: ItemCarrinho[]) {
  return itens.reduce((s, i) => s + (i.precoCents ?? 0) * i.quantidade, 0);
}

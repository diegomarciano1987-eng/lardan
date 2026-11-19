/**
 * Etiqueta de peça em 1 lado ou 2 lados (0341).
 * 1 lado é SEMPRE o padrão: a escolha "2 lados" vive só na memória da página,
 * vale apenas para a próxima impressão e volta sozinha para 1 lado depois que ela sai.
 * Nunca é guardada no computador, então abrir/recarregar a tela começa em 1 lado.
 */
let duplicar = false;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

export function ladosAtual(): boolean { return duplicar; }
export function escolherLados(v: boolean) { if (duplicar !== v) { duplicar = v; avisar(); } }
/** Depois de uma impressão enviada: volta para 1 lado. */
export function voltarUmLado() { escolherLados(false); }
export function ouvirLados(f: () => void) { ouvintes.add(f); return () => { ouvintes.delete(f); }; }

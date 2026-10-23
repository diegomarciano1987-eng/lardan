/**
 * Módulos que o Master libera para uma colaboradora. Cada módulo é um pacote
 * de permissões do banco: "ver" e, opcionalmente, "alterar". O banco só aceita
 * permissões da lista colab_caps_permitidas (0130).
 */
export type ColabModulo = { id: string; nome: string; texto: string; ver: string[]; alterar: string[] };

export const COLAB_MODULOS: ColabModulo[] = [
  { id: "maletas", nome: "Remessas e maletas", texto: "Montar, conferir, expedir e receber maletas; praças.", ver: ["kit.view", "kit.view.all"], alterar: ["kit.manage", "kit.ship", "kit.receive", "kit.acrescimo", "kit.accept"] },
  { id: "produtos", nome: "Produtos", texto: "Catálogo, variantes e etiquetas.", ver: ["catalog.view"], alterar: ["catalog.manage", "product.manage"] },
  { id: "cadastros", nome: "Cadastros de consultoras e representantes", texto: "Pessoas, empresas, consultoras e representantes.", ver: ["registry.view", "partners.view"], alterar: ["registry.manage", "partners.manage"] },
  { id: "estoque", nome: "Estoque", texto: "Saldos, movimentações e reservas.", ver: ["stock.view", "stock.reservation.view"], alterar: ["stock.operate", "stock.reservation.create", "stock.reservation.confirm", "stock.reservation.cancel"] },
  { id: "custos", nome: "Preço de custo", texto: "Mostra o custo das peças e do estoque.", ver: ["catalog.cost.view", "stock.cost.view"], alterar: [] },
  { id: "importacao", nome: "Importações", texto: "Importar planilhas com simulação.", ver: ["imports.run"], alterar: [] },
  { id: "cobranca", nome: "Cobrança", texto: "Carteira de devedoras, promessas e negociação.", ver: ["collection.view"], alterar: ["collection.operate", "collection.negotiate"] },
  { id: "candidaturas", nome: "Candidaturas do Site", texto: "Funil das candidatas a consultora.", ver: ["candidaturas.view", "leads.view"], alterar: ["candidaturas.edit", "candidaturas.move", "candidaturas.notes", "candidaturas.followups", "candidaturas.tags", "candidaturas.assign"] },
  { id: "site", nome: "Site e vitrine", texto: "Curadoria e publicação do catálogo no site.", ver: ["showcase.view"], alterar: ["site.manage", "showcase.publish", "catalog.publish", "product.publish"] },
  { id: "rede", nome: "Inteligência da Rede", texto: "Mapa da rede (números agregados).", ver: ["network.aggregate.view"], alterar: [] },
  { id: "auditoria", nome: "Auditoria e configurações", texto: "Ver o registro de alterações.", ver: ["audit.view"], alterar: [] },
];

/** Pacote pronto: tudo que é preciso para montar uma maleta, vendo e alterando. */
export const PACOTE_MONTAGEM = ["maletas", "produtos", "cadastros", "estoque"];

export type Escolha = Record<string, "nao" | "ver" | "alterar">;

export function escolhaDeCaps(caps: string[]): Escolha {
  const e: Escolha = {};
  for (const m of COLAB_MODULOS) {
    const temVer = m.ver.every((c) => caps.includes(c));
    const temAlt = m.alterar.length > 0 && m.alterar.every((c) => caps.includes(c));
    e[m.id] = temVer && temAlt ? "alterar" : temVer ? "ver" : "nao";
  }
  return e;
}

export function capsDeEscolha(e: Escolha): string[] {
  const s = new Set<string>();
  for (const m of COLAB_MODULOS) {
    const v = e[m.id] ?? "nao";
    if (v === "nao") continue;
    m.ver.forEach((c) => s.add(c));
    if (v === "alterar") m.alterar.forEach((c) => s.add(c));
  }
  return [...s].sort();
}

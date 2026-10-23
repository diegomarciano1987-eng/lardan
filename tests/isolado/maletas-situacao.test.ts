/**
 * 0127 — situação das maletas do SmallData; "na rua" contado por consultora. Banco ISOLADO, dados sintéticos.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const base = 700000 + Math.floor(Math.random() * 90000);
const REM = 60000 + Math.floor(Math.random() * 9000);
let master: Conta, consultora: Conta;
const imp = (tipo: string, linhas: unknown[]) => rpc(master, "legado_importar", { _tipo: tipo, _lote: `iso-sit-${base}`, _linhas: linhas });
const maleta = (remessa: number, codcli: number, kit: number) => ({
  remessa, codcli, kit, tipo: "remessa", emissao: "2026-09-01", fechamento: "", pecas_enviadas: 50, pecas_devolvidas: 0, pecas_defeito: 0,
  valor_enviado: 5000, valor_devolvido: 0, nf_remessa: "1" });

interface Vis {
  smalldata: { consultoras: number; maletas: number; consultoras_varias_maletas: number; situacao_importada: boolean;
    por_situacao: { codigo: number | null; na_rua: boolean; consultoras: number; maletas: number }[];
    por_remessa: { remessa: number; consultoras: number; maletas: number }[] };
}
const minha = (v: Vis) => v.smalldata.por_remessa.find((r) => r.remessa === REM);

beforeAll(async () => {
  master = await criarConta({ nome: `sit-master-${base}`, papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: `sit-cons-${base}`, papeis: ["consultora"], comParty: true });
  await imp("consultoras", [1, 2, 3].map((i) => ({ codcli: base + i, nome: `Sit ${i}`, cpf: "", cidade: "A", uf: "PR", praca: "", ativo: "1" })));
  await imp("remessas", [{ numero: REM, emissao: "2026-09-01", vencimento: "2026-10-15", status: "aberta", praca: "", representante: "" }]);
  // consultora 1 com 3 maletas na rua; 2 devolveu (aguarda acerto); 3 perdida
  await imp("maletas", [maleta(REM, base + 1, 1), maleta(REM, base + 1, 2), maleta(REM, base + 1, 3), maleta(REM, base + 2, 1), maleta(REM, base + 3, 1)]);
});

afterAll(async () => {
  await adm.unsafe(`delete from public.legado_maleta_status where remessa=$1`, [REM]);
  await adm.unsafe(`delete from public.legado_maletas where remessa=$1`, [REM]);
  await adm.unsafe(`delete from public.legado_remessas where numero=$1`, [REM]);
  await adm.unsafe(`delete from public.legado_consultoras where codcli between $1 and $2`, [base + 1, base + 3]);
});

describe("situação das maletas do SmallData", () => {
  test("com a situação importada, na rua é só a saída conferida, e conta consultora antes de maleta", async () => {
    const r = await imp("maletas_status", [
      { remessa: REM, codcli: base + 1, status: "4", data: "2026-09-02" },
      { remessa: REM, codcli: base + 2, status: "5", data: "2026-10-10" },
      { remessa: REM, codcli: base + 3, status: "11", data: "2026-10-12" },
    ]);
    expect(r.erro).toBeNull();
    const v = await rpc<Vis>(master, "maletas_visibilidade", { _limite: 1000 });
    expect(v.erro).toBeNull();
    expect(v.dados.smalldata.situacao_importada).toBe(true);
    expect(minha(v.dados)).toMatchObject({ consultoras: 1, maletas: 3 });
    const sit = (c: number) => v.dados.smalldata.por_situacao.find((x) => x.codigo === c)!;
    expect(sit(4).na_rua).toBe(true);
    expect(sit(5)).toMatchObject({ na_rua: false });
    expect(sit(11)).toMatchObject({ na_rua: false });
    expect(v.dados.smalldata.consultoras_varias_maletas).toBeGreaterThanOrEqual(1);
  });

  test("reimportar a situação atualiza; o Master corrige nome e regra sem código novo", async () => {
    await imp("maletas_status", [{ remessa: REM, codcli: base + 2, status: "4", data: "2026-10-11" }]);
    let v = await rpc<Vis>(master, "maletas_visibilidade", { _limite: 1000 });
    expect(minha(v.dados)).toMatchObject({ consultoras: 2, maletas: 4 });
    expect((await rpc(master, "legado_maleta_situacao_definir", { _codigo: 5, _nome: "Remessa devolvida", _na_rua: true })).erro).toBeNull();
    await imp("maletas_status", [{ remessa: REM, codcli: base + 2, status: "5", data: "2026-10-12" }]);
    v = await rpc<Vis>(master, "maletas_visibilidade", { _limite: 1000 });
    expect(minha(v.dados)).toMatchObject({ consultoras: 2, maletas: 4 });
    await rpc(master, "legado_maleta_situacao_definir", { _codigo: 5, _nome: "Retorno recebido", _na_rua: false });
  });

  test("só a equipe lê; só o Master define", async () => {
    expect((await rpc(consultora, "legado_maleta_situacoes_lista", {})).ok).toBe(false);
    expect((await rpc(consultora, "legado_maleta_situacao_definir", { _codigo: 4, _nome: "x", _na_rua: false })).ok).toBe(false);
    const l = await rpc<{ codigo: number; nome: string }[]>(master, "legado_maleta_situacoes_lista", {});
    expect(l.dados.find((x) => x.codigo === 1)!.nome).toBe("Remessa aberta cliente");
  });
});

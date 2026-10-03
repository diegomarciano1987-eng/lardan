/** Cenário SINTÉTICO do PDV para captura de tela no isolado. Imprime o token bruto do aparelho. */
import { adm, criarConta, criarVariante, porEstoque, rpc, rpcServico } from "../base";
import { createHash } from "node:crypto";
const master = await criarConta({ nome: "pdvshot-master", papeis: ["master"] });
const vend = await criarConta({ nome: "pdvshot-vend", papeis: [], comParty: true });
await adm.unsafe("update public.profiles set full_name='Vendedora Demonstração' where id=$1", [vend.uid]);
await adm.unsafe("insert into public.party_roles(party_id, role, status) select party_id, 'vendedora_interna', 'ativo' from public.profiles where id=$1", [vend.uid]);
const numero = String(10000 + Math.floor(Math.random() * 89999));
const u = (await rpc<string>(master, "pdv_unidade_criar", { _nome: "Loja Demonstração", _numero: numero, _senha: "segredo123" })).dados;
await adm.unsafe("update public.pdv_unidades set desconto_max_operadora_pct=10 where id=$1", [u]);
const [loc] = (await adm.unsafe("select location_id from public.pdv_unidades where id=$1", [u])) as any[];
const [m] = (await adm.unsafe("insert into public.pdv_membros(unidade_id,user_id,papel) values ($1,$2,'operadora') returning id", [u, vend.uid])) as any[];
const bruto = "shot" + Math.random().toString(36).slice(2) + Date.now();
const th = createHash("sha256").update(bruto).digest("hex");
await adm.unsafe("insert into public.pdv_sessoes(unidade_id,token_hash,membro_id,login_membro_id,expira_em) values ($1,$2,$3,$3,now()+interval '8 hours')", [u, th, m.id]).catch(async (e) => { console.error(String(e)); process.exit(1); });
await rpcServico("pdv_caixa_abrir", { _token_hash: th, _fundo: 10000 });
const v1 = await criarVariante("anel", 18900); await porEstoque(v1, loc.location_id, 5);
const v2 = await criarVariante("colar", 25900); await porEstoque(v2, loc.location_id, 5);
const b=[5,2,9,1,4,7,3,6,8]; const dv=(a:number[])=>{const r=(a.reduce((s,n,i)=>s+n*(a.length+1-i),0)*10)%11;return r===10?0:r;}; b.push(dv(b)); b.push(dv(b));
const c = await rpcServico<any>("pdv_cliente_salvar", { _token_hash: th, _c: { nome: "Cliente Fictícia", doc: b.join(""), telefone: "44999990000", instagram: "cliente.ficticia", email: "ficticia@exemplo.test", cidade: "Maringá", uf: "PR", cep: "87000000" } });
for (const [i, pg] of [[1, { forma: "dinheiro", valor_cents: 18900, recebido_cents: 20000 }], [2, { forma: "dinheiro", valor_cents: 25900 }]] as const) {
  const r = await rpcServico<any>("pdv_venda_concluir", { _token_hash: th, _p: { idem: `shot-${numero}-${i}`, itens: [{ variant_id: i === 1 ? v1 : v2, qtd: 1 }], desconto_cents: 0, cliente: { nome: "Cliente Fictícia", telefone: "44999990000" }, pagamentos: [pg] } });
  await rpcServico("pdv_venda_vincular_cliente", { _token_hash: th, _venda: r.dados.venda, _party: c.dados.party_id });
}
console.log("TOKEN=" + bruto);
process.exit(0);

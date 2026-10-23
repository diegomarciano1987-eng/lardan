# Para o Lovable — 0136: ligações da primeira montagem + login por código endurecido

Aplique exatamente como está. Não renomeie funções e não mude as mensagens. Não publique a interface sem a minha aprovação.

## 1. Migração `0136_primeira_montagem_ligacoes.sql`

Arquivo em drizzle/migrations. Você pode renumerar o arquivo; o conteúdo fica igual. A migração não apaga nada, não remove coluna e pode rodar duas vezes.

### Login por código (corrige a 0130)

- `colab_login_reservar(codigo)` é só do servidor. Cada tentativa conta antes de conferir a senha, numa única atualização com a linha travada.
  - 5 tentativas erradas travam o código por 15 minutos, mesmo quando chegam juntas. Antes, quem mandasse várias ao mesmo tempo passava do limite.
  - Código inexistente, suspenso, travado ou de conta com papel de equipe recebe a mesma resposta. A tela não diz qual é o caso.
- `colab_login_ok(user)` zera o contador e grava a auditoria.
- `colab_acesso_registrar` recusa código para conta com papel de equipe (master, diretoria, financeiro…). Essas pessoas entram com e-mail e MFA.
- `meu_acesso_colab()` diz se quem está logado tem acesso de colaboradora ativo.

### Carteira pelo SmallData

O cadastro do histórico (`legado_consultoras_cadastrar`) preenchia a praça, mas **não preenchia o representante**. Resultado: a consultora antiga não aparecia na carteira nem no portal do representante.

- `consultoras_vinculo_smalldata(aplicar)`:
  - preenche o representante (e a praça, quando está vazia) com o que está no cadastro dela no SmallData;
  - funciona em prévia ou aplicação, e só o Master aplica;
  - **nunca sobrescreve** o que já está preenchido;
  - grava cada mudança em `consultoras_vinculo_log`; dá para desfazer por lote com `consultoras_vinculo_smalldata_desfazer(lote)`.
- `legado_representante_vincular(codigo, party)`: o Master liga um representante do histórico (sem CPF) ao cadastro dele. A pessoa precisa ter o papel Representante.

### Tipo da peça na bipagem

`variantes_tipo_peca(variantes[])` devolve o tipo da peça: brinco, anel, colar, pulseira ou tornozeleira.

- O tipo vem da **categoria do produto**, pelo mesmo de-para das metas do histórico (`legado_categoria_tipo`). Assim bracelete conta como pulseira nos dois lados.
- Antes, a bipagem olhava só o SKU e o nome. Bracelete caía em "outro", enquanto a meta o contava como pulseira.
- Só a equipe de montagem pode ler.

### Situação da consultora

- Quando ela aceita a maleta, a consultora **inativa** volta a ser ativa, no cadastro e no papel. Bloqueada ou desligada não muda, e o caso fica registrado.
- Não se abre maleta nova para consultora **bloqueada ou desligada**.

### Desempenho do cadastro do histórico (corrige a 0131)

O gatilho da maleta perdida reprocessava **todas** as perdidas a cada consultora que ganhava cadastro. Isso dava cerca de 0,4 s por consultora, ou uns 26 minutos para 4 mil cadastros.

Agora o gatilho olha só as consultoras que mudaram. Na bancada, com o histórico real sem dados pessoais, o resultado foi:

| Medição | Resultado |
|---|---|
| Cadastro de 4.017 consultoras | 1 min 48 s, antes passava de 20 min |
| Fiados de maleta perdida | 246, iguais |
| Carteira pela prévia | 4.017 consultoras com representante, aplicadas em 0,5 s |
| Desfazer | voltou tudo |

## 2. Interface

- `src/lib/portas.ts`: `portaLiberada(porta, roles, caps, colab)`. A porta Operação por módulos abre só quando `colab` é verdadeiro. Antes, consultora e representante (que também têm permissões) passavam pela porta Operação e caíam em /admin/maletas.
- `src/lib/capabilities.ts`: nova `fetchSouColab()`. Usada em `src/routes/_authenticated/admin/route.tsx` e `src/routes/equipe.tsx`.
- `src/lib/colab-acesso.functions.ts`:
  - `entrarPorCodigo` usa `colab_login_reservar` e `colab_login_ok`, com mensagem única;
  - `colabAcessoSalvar` não troca a senha de quem já entra com e-mail próprio;
  - `colabAcessoLer` devolve `emailReal`.
- `AcessoColaboradora.tsx`: com e-mail próprio, o campo de senha some e só o código é salvo.
- `src/lib/tipo-peca.ts` é novo. `MontagemLeitor.tsx` e `ConferenciaMaleta.tsx` contam por tipo com `useTiposPeca`. Sem categoria reconhecida, vale a regra antiga.

## 3. Testes

- `tests/isolado/primeira-montagem.test.ts` é novo, com 17 testes. Percorre o caminho completo:
  1. consultora do histórico;
  2. código do SmallData;
  3. carteira;
  4. colaboradora por código montando (remessa, metas, bipagem, conferência, expedição);
  5. aceite;
  6. cockpit;
  7. representante;
  8. login endurecido.
- `tests/isolado/produto-banho.test.ts` foi ajustado para pegar a categoria oficial da chave, porque outra suíte pode criar "Brinco" antes.
- Resultado esperado de `bash tests/isolado/subir.sh && bun test tests/isolado`: **424 pass, 0 fail**.

## 4. Depois de aplicar, me devolva cada resultado nesta ordem

```sql
-- 1) representantes do histórico ainda sem cadastro (o Master liga cada um)
select codigo, nome, ativo, pracas, party_id from public.legado_representantes order by codigo;

-- 2) prévia da carteira (não grava nada)
select jsonb_pretty(public.consultoras_vinculo_smalldata(false));
```

Pare aqui e me mostre os dois resultados. Eu digo quais representantes ligar com `legado_representante_vincular(codigo, party_id)` e aprovo a aplicação. Só depois disso rode:

```sql
select jsonb_pretty(public.consultoras_vinculo_smalldata(true));
```

Acrescente ao AGENTS.md as duas regras novas que estão no AGENTS.md deste pacote: a linha "Operation-door login by collaborator code (0130)" atualizada e a linha "First montagem links (0136)".

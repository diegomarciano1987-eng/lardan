HISTÓRICO DO JFLEX — APLICAR O PACOTE E CONSTRUIR AS TELAS

Anexei "lardan-historico-jflex.patch" (um commit sobre o projeto de hoje) e o projeto completo "lardan-historico-jflex.zip".
O banco e as rotinas já estão prontos e testados: suíte isolada 304 de 304, em bancos recriados do zero, e carga real de 424 mil linhas (sem dados pessoais) conferida contra o JFLEX.
Sua parte é aplicar o banco como está e construir as telas abaixo usando SÓ as funções de src/lib/historico-jflex.ts.

REGRAS
- Aplique as migrações 0112 e 0113 como estão. Não refatore, não renomeie. Se não encaixar, me mostre o conflito antes de decidir.
- Gere o journal e o snapshot da 0112 e da 0113 com a ferramenta oficial. Regenere os tipos do Supabase.
- O histórico é SÓ LEITURA: nenhuma tela grava em maletas, estoque, pedidos, financeiro ou fiscal.
- Nenhuma tela cria pessoa a partir do histórico. Não existe botão "criar cadastro" nessas telas.
- Os CSV têm nome, CPF e endereço: nunca entram no repositório, nunca vão para log, console ou outro serviço.
- Não publique sem minha aprovação. Depois que a tela de importação estiver pronta, EU importo os arquivos pelo preview.

O QUE O PATCH TRAZ
1. drizzle/migrations/0112_historico_jflex.sql
   - tabelas legado_* sem acesso direto (RLS ligado, sem GRANT para o navegador)
   - legado_importar (só Master ou servidor, idempotente, até 2.000 linhas por envio)
   - legado_vincular (liga a cadastros existentes: código antigo "cliente", depois CPF de uma única pessoa)
   - legado_consultora_vincular (vínculo manual, auditado) e legado_pendencias_vinculo
   - leituras: legado_consultora_historico, consultora_meu_historico, legado_remessas_lista, legado_remessa_detalhe,
     legado_rede_ranking, legado_rede_mensal, montagem_sugestao, legado_resumo, fiscal_roteiro_observado
   - remessa_criar: o próximo número continua depois do maior número do Lardan ou do JFLEX, e recusa número já usado no JFLEX
   - fiscal_roteiro_referencia: roteiro fiscal observado nas 73 mil notas do JFLEX (referência, não ativa nada)
2. src/lib/historico-jflex.ts (leituras tipadas e importação em blocos) e src/lib/historico-jflex-csv.ts (leitor de CSV puro)
3. drizzle/migrations/0113_montagem_metas_historico.sql
   - montagem_metas_ciclo(maleta, total): metas por tipo de peça (brinco, anel, colar, pulseira, tornozeleira, outro) pelo histórico de venda DESTA consultora, somando exatamente o total
   - total sugerido = mediana das 5 últimas maletas dela com 10+ peças (sem histórico: pecas_cliente_nova)
   - destaques (onde o mix dela foge da praça), últimas 3 remessas e as variantes dos 10 produtos que ela mais vendeu
   - legado_categoria_tipo: de-para categoria do JFLEX → tipo de peça do leitor; legado_categoria_tipo_definir (só Master, auditado) e legado_categoria_tipo_lista
4. src/components/admin/maletas/MontagemLeitor.tsx JÁ ALTERADO (tela de bipagem): ver tela 6
5. tests/isolado/historico-jflex.test.ts (16), historico-csv.test.ts (5) e montagem-metas.test.ts (6)
6. docs/lardan/HISTORICO-JFLEX.md e 7 regras novas no AGENTS.md

TELAS

1) Configurações > "Histórico JFLEX" (rota /admin/historico-jflex, só Master)
   - Topo: resumoHistorico() em cartões:
     - quantidade de cada arquivo já importado;
     - período;
     - peças enviadas e vendidas, giro e valor vendido;
     - numeração: última remessa do JFLEX, próxima do Lardan e conflitos (em vermelho, se houver);
     - fiscal: última NF por série.
   - Importação:
     - campo para selecionar vários .csv de uma vez;
     - identifique cada arquivo pelo nome (ARQUIVOS_HISTORICO.arquivo) e mostre o nome, a quantidade de linhas e um ✓ ou um "faltando";
     - o botão "Importar" só fica ativo para o Master e com os 10 arquivos presentes;
     - envie na ordem de ARQUIVOS_HISTORICO com importarArquivoHistorico(tipo, texto, lote, aoAvancar), com lote = "jflex-AAAAMMDD-HHmm";
     - mostre uma barra de progresso por arquivo;
     - se um arquivo falhar, pare e mostre a mensagem. Reimportar é seguro: o banco atualiza, não duplica.
   - Ao terminar: chame vincularHistorico(true) e mostre o relatório:
     - consultoras ligadas por código, por CPF e manualmente;
     - sem cadastro;
     - CPF ambíguo;
     - representantes, praças e produtos ligados.
   - "Consultoras sem cadastro":
     - tabela de pendenciasVinculo(busca), com nome, cidade/UF, CPF mascarado, maletas e última maleta;
     - ação "Ligar a uma pessoa" usa a busca de pessoas que já existe e chama vincularConsultoraManual(codcli, party);
     - ação "Desfazer" passa party = null;
     - sem botão de criar pessoa.

2) Ficha da pessoa (/admin/cadastros/pessoas/$id) e ficha de cobrança (/admin/cobranca/$id): aba "Histórico JFLEX"
   - Use historicoConsultora(partyId). Se vinculada = false, mostre "Nenhum histórico do JFLEX ligado a este cadastro".
   - Linha de indicadores:
     - maletas (e quantas fechadas);
     - primeira e última maleta;
     - peças vendidas, giro %, valor vendido e ticket médio por maleta;
     - maletas perdidas e peças com defeito.
   - Categorias: barras horizontais com participação nas vendas e giro dela comparado ao giro da praça (destaque quando ela vende acima da praça).
   - Top 10 produtos vendidos: nome, referência, categoria e quantidade. Se tiver product_id, ligue ao produto.
   - Evolução por ano: maletas, peças vendidas e valor vendido.
   - Tabela de maletas:
     - remessa nº (abre o detalhe da remessa), kit, emissão, acerto, enviadas, devolvidas, vendidas, giro, valor vendido e notas (remessa, devolução, venda);
     - quando pecas_vendidas for null, mostre "sem acerto", nunca zero.

3) Cockpit de remessas (/admin/maletas, aba Remessas): seletor "Lardan | Histórico JFLEX"
   - Histórico:
     - remessasHistorico({busca, praca, representante, de, ate, status, limite, offset}) com paginação;
     - colunas: nº, emissão, vencimento, status, praça, representante, maletas, consultoras, peças enviadas e vendidas, giro, valor vendido e maletas sem acerto.
   - Clique na linha: painel lateral com remessaHistorico(numero), mostrando as categorias e as maletas da remessa (consultora com link para a ficha quando party_id existir).

4) Rede (/admin/rede): seção "Inteligência da rede"
   - Filtros: agrupar por (praça, representante, cidade, UF, consultora, categoria), período, praça e categoria.
   - Tabela rankingRede(agrupar, filtros): nome, maletas, consultoras, peças enviadas e vendidas, giro, valor vendido, ticket médio por maleta e última maleta. Ordene por valor vendido.
   - Gráfico redeMensal(filtros): valor vendido por mês (barras) e giro % (linha).
   - Linhas de consultora com party_id levam à ficha.

5) App da consultora: cartão "O que eu mais vendo" (aba Início)
   - meuHistorico(): peças vendidas, giro, top categorias em barras simples e top 5 produtos.
   - Esconda o cartão quando vinculada = false.
   - Linguagem simples, letra grande, como o resto do app.

6) Montagem por leitor (onde se bipa a maleta) — JÁ ESTÁ PRONTO NO PATCH, NÃO REFAÇA
   - Arquivo: src/components/admin/maletas/MontagemLeitor.tsx. Só confira que compila e me mostre um print.
   - O que mudou:
     - acima dos cartões "Brincos 12/25, Anéis 3/4…" há a faixa "Metas desta maleta" com a escolha "Pelo histórico dela | Padrão Lardan";
     - no modo histórico, as metas de cada cartão vêm de metasMontagem(cycleId, total) e o total tem botões −5/+5;
     - com histórico forte ou médio (10+ peças vendidas) a tela já abre no modo histórico; com pouco histórico ou sem vínculo, abre no padrão;
     - aparece um 6º cartão "Outros" quando a meta de outros (conjunto, piercing, broche…) for maior que zero;
     - selos "▲ vende bem / ▼ vende pouco" por categoria e a tabela "Ver por categoria";
     - no quadro da consultora: últimas 3 remessas (peças enviadas, vendidas e giro);
     - ao bipar uma peça dos 10 produtos que ela mais vendeu: "★ campeã de venda dela".
   - Nada disso reserva, adiciona peça ou muda estoque. Se a rotina falhar (sem permissão ou sem histórico importado), a tela segue no padrão, sem erro.
   - Não coloque campo de digitar na faixa: o leitor devolve o foco ao campo de bipagem a cada 400 ms. Por isso o total é ajustado por botões.
   - Na tela 1 (Histórico JFLEX), acrescente o bloco "Categorias → tipo de peça": tabela de categoriaTipoLista() com um seletor de tipo por linha, que chama categoriaTipoDefinir(categoria, tipo). Só o Master altera; destaque as linhas com mapeada = false.

7) Integrações > cartão "Nota fiscal — prontidão": acrescente o bloco recolhível "Roteiro observado no JFLEX", com roteiroFiscalObservado() em tabela (operação, natureza, CFOP PR/fora, tipo, CSOSN, PIS/COFINS, NCM e texto complementar).

DEPOIS DE APLICAR
1. Rode build e typecheck e me mostre o resultado.
2. Rode bash tests/isolado/subir.sh && bun test tests/isolado. Esperado: 304 aprovados, 0 falhas.
3. Na base real, só leitura: select max(numero) from remessas;
   - Se já existir remessa do Lardan com número entre 875 e 921, me avise ANTES de qualquer importação: esses números também existem no JFLEX.
4. Me mostre prints de cada tela vazia (antes da importação), com sessão de Master, de financeiro e de consultora.
   - A consultora não pode ver as telas 1 a 4 nem a faixa da tela 6.

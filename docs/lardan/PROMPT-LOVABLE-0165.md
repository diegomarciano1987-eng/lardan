# Para o Lovable — 0165: empresa emissora da NF-e (TSM / Lardan)

Aplique **depois da 0164**, exatamente como está. A migração pode rodar duas vezes, não apaga nada e **não liga a emissão real**.

## 1. Migração `0165_emissor_fiscal_tsm.sql`

Os dados foram conferidos no SINTEGRA/PR (consulta de 22/10/2026) e no cadastro da Focus:

| Campo | Valor |
| --- | --- |
| Razão social | TSM COMERCIO DE SEMIJOIAS LTDA |
| Nome fantasia | LARDAN SEMIJOIAS |
| CNPJ | 43.319.208/0001-80 |
| Inscrição estadual | 90908301-01 |
| Regime | Simples Nacional |
| Endereço | Av. dos Estudantes, 1277, Setor 1, Ibiporã/PR |
| CEP | 86200-055 |
| IBGE | 4109807 |

O que a migração faz:

1. **Pessoa da empresa:** usa a que já existe pelo CNPJ e nunca cria outra. Se encontrar mais de uma, para com erro.
   - Completa a razão social.
   - O endereço do SINTEGRA, com IBGE, passa a ser o principal. O endereço antigo fica guardado.
2. **Empresa (`business_entities`):** procura pelo CNPJ. Se não achar, completa a empresa da cobrança Lardan que ainda está sem CNPJ. Se não houver nenhuma, cria.
3. **Configuração fiscal (`fiscal_settings`):** emissor = TSM, provedor Focus, ambiente homologação. **A emissão real continua desligada.**
4. **Auditoria:** grava `fiscal.emissor_cadastrado`.

Em produção eu já gravei, pelo painel do Master:

- **Regra do valor fiscal vigente:** 1/3 do varejo (33,333333%), com o Diego como responsável e com o fundamento.
- **Provedor e ambiente:** Focus em homologação.

A migração não desfaz nada disso.

## 2. Testes

- Três testes antigos davam como certo que o fiscal estava "sem provedor": `fiscal-asaas`, `fiscal-cadeia` e `prontidao-fiscal`. Agora conferem que a **emissão está desligada e fora de produção**.
- O teste do interruptor parte do estado sem provedor e devolve a configuração original no fim.
- Esperado em `bash tests/isolado/subir.sh && bun test tests/isolado`: **498 pass, 0 fail**.

## 3. Depois de aplicar, me devolva

```sql
select public.fiscal_prontidao()->'emissor';     -- deve vir tudo ok (definido, cnpj, ie, endereço, ibge)
select provider, environment, emission_active from public.fiscal_settings;   -- focus, homologacao, false
```

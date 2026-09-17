# Correção completa das consultas brasileiras

## Objetivo

Fazer as consultas e validações já previstas funcionarem nos campos onde o usuário realmente cadastra dados, com retorno claro e provas de funcionamento.

## O que será corrigido

1. **Inventário e contrato único**
   - Mapear todos os campos de CEP, CPF/CNPJ, telefone, WhatsApp, e-mail, PIX, UF/município e localização.
   - Eliminar diferenças entre máscaras e validadores antigos e o contrato canônico já existente.

2. **CEP em todos os cadastros aplicáveis**
   - Conectar o CEP dos novos cadastros, fichas existentes e formulários públicos à consulta no servidor.
   - Preencher logradouro, bairro, cidade, UF, código IBGE e DDD quando disponíveis.
   - Manter preenchimento manual quando o CEP não existir ou os provedores estiverem indisponíveis.
   - Usar ViaCEP com BrasilAPI como fallback e mostrar fonte/estado da consulta.

3. **CPF e CNPJ**
   - Validar CPF localmente pelos dígitos verificadores, com estado visível e mensagem honesta. Não existe consulta pública gratuita e legal de titularidade de CPF.
   - Validar CNPJ e consultar dados públicos da empresa no servidor, preservando a consulta que já funciona.
   - Aplicar o comportamento correto nos cadastros de pessoas, empresas, fornecedores e entidades.

4. **Demais validações e listas públicas**
   - Validar e normalizar telefone, WhatsApp, e-mail, PIX e código de barras nos campos correspondentes.
   - Conectar UF à lista oficial de municípios do IBGE onde houver campo de cidade selecionável.
   - Revisar a localização por CEP usada no mapa da rede, incluindo resposta de erro e retomada.

5. **Confiabilidade e segurança**
   - Corrigir falhas de autenticação, permissões, cache e contratos de resposta sem expor documentos pessoais.
   - Preservar rate limit, auditoria, allowlist de provedores e preenchimento manual como contingência.

6. **Provas**
   - Testar respostas reais de ViaCEP, BrasilAPI e IBGE, além de fallback, timeout, 404 e cache simulados.
   - Testar CPF válido/inválido e as demais validações canônicas.
   - Percorrer no navegador os principais cadastros e comprovar preenchimento automático e mensagens.
   - Registrar uma matriz final: campo, tela, fonte, resultado e evidência.

## Limites honestos

- CPF não terá consulta de nome, situação ou titularidade: apenas validação matemática e duplicidade interna.
- Nenhum dado será inventado quando uma API gratuita não fornecer a informação.
- Uma consulta externa indisponível não impedirá o preenchimento e salvamento manual.
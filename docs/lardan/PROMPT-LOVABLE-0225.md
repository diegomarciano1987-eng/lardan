# Para o Lovable — 0225: botão da nota real não pode ficar escondido pela nota de teste

Só um arquivo, **sem migração**: `src/components/admin/maletas/NotaFiscalMaleta.tsx`. Copie exatamente como está e publique.

**Problema:** com a emissão real ligada, a maleta piloto (MAL-00326, Amanda) já tinha uma nota de **teste** (nº 5005, homologação). O botão mostrava "DANFE teste nº 5005" e não deixava emitir a nota **real**.

**Correção:** com a emissão real ligada, a nota de teste deixa de contar como "a nota da maleta". Aparece o botão **"Nota fiscal"**, com o aviso "Já teve nota de teste nº 5005 (sem valor fiscal)". Nada muda no banco nem nas regras: o servidor continua conferindo o ambiente, a maleta piloto e uma nota real viva por maleta.

Depois de publicar, abra a remessa 924 como Master: na linha da Amanda tem que aparecer **"Nota fiscal"** (sem "(teste)").

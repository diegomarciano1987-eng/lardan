# LARDAN — Testes e Evidências

Distinção obrigatória: EXECUTADO | INSPECIONADO | NÃO TESTADO. Nada aqui é marcado como testado por leitura de código.

## Lote 0/1

| Caso | Método | Resultado |
| --- | --- | --- |
| Build do projeto | EXECUTADO (build automático da plataforma) | ver checkpoint em PROGRESSO.md |
| Assets no CDN (6 ponteiros .asset.json) | EXECUTADO (CLI lovable-assets) | 6 ponteiros criados; 4 imagens editoriais + diamante + logo completa |
| Favicon derivado do diamante original | EXECUTADO | public/favicon.png 64×64 gerado; favicon.ico padrão removido |
| Hero em 360/390/768/1280/1440 px | NÃO TESTADO | pendente Lote 5 |
| Navegação por teclado e foco visível | NÃO TESTADO | pendente Lote 5 |
| prefers-reduced-motion | INSPECIONADO (implementado via media query) | pendente verificação executada |
| 404 real em slug inexistente | NÃO TESTADO | pendente Lote 5 |
| Persistência de formulários | NÃO APLICÁVEL AINDA | backend no Lote 2 |
| Isolamento de dados/RLS | NÃO APLICÁVEL AINDA | backend no Lote 2 |
| Performance (LCP/INP/CLS) | NÃO MEDIDO | sem medição, nenhuma nota declarada |

Nenhuma screenshot, nota de Lighthouse, resultado de query ou teste E2E foi inventado.

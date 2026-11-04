# ♠ TenhaPaciência

O clássico jogo de cartas **Paciência (Klondike)**, com visual caprichado e feito **mobile first**. HTML + CSS + JavaScript puro, sem build e sem dependências. As cartas são desenhadas em SVG/CSS e os sons são sintetizados com WebAudio.

**Jogar:** https://mqzgames.github.io/TenhaPaciencia/

## Como jogar

- Monte as quatro fundações (canto superior direito) do Ás ao Rei, por naipe.
- Nas colunas, empilhe em ordem decrescente alternando cores (vermelho/preto). Só o Rei vai para uma coluna vazia.
- **Toque** numa carta para ela ir sozinha para o melhor lugar, ou **arraste** cartas e pilhas.
- Toque no monte para virar cartas. Quando ele acabar, toque de novo para reciclar.
- Quando todas as cartas estiverem viradas, aparece o botão **Finalizar** para completar automaticamente.

## Todo jogo dá para ganhar

Antes de distribuir, cada jogo é resolvido por um solucionador (`js/solver.js`, roda num Web Worker): só entram jogos com solução comprovada. O próximo jogo já fica pronto em segundo plano.

| Dificuldade | Como é |
|---|---|
| **Fácil** | Jogos que se resolvem quase sem desvios. Monte sem limite. |
| **Normal** (padrão) | Qualquer jogo vencível. Monte sem limite. |
| **Difícil** | Jogos que exigem planejamento e o monte tem só 3 voltas. |

A **Dica** usa o mesmo solucionador: mostra a jogada que leva à vitória (inclusive quantas vezes tocar no monte e qual carta vai sair) e, tocando em Dica de novo, faz a jogada por você. Se você entrar num caminho sem saída, ela avisa para desfazer.

Teste do solucionador (gera jogos e reproduz cada solução com as regras do jogo):

```bash
node test/solver.test.js
```

## Recursos

- Modos **Virar 1** e **Virar 3** e três dificuldades
- Desfazer ilimitado, dicas, pontuação (estilo Windows) com bônus de tempo
- 4 cores de mesa e 4 versos de carta
- Estatísticas: jogos, vitórias, sequência, melhor tempo e recorde
- Jogo salvo automaticamente; instalável como app (PWA) e jogável offline
- Animação clássica de cartas quicando na vitória

Atalhos no teclado: `espaço` vira o monte, `H` dica, `U` ou `Ctrl+Z` desfaz, `N` novo jogo.

## Rodar localmente

Qualquer servidor estático serve, por exemplo:

```bash
npx http-server . -p 8080
```

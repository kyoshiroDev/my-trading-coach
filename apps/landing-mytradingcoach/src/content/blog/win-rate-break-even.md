---
title: "Ton win rate est peut-être faux (à cause des break-even)"
seoTitle: "Calculer son win rate avec les break-even (BE)"
description: "La plupart des traders comptent mal leur win rate à cause des trades break-even. Voici comment le calculer correctement et pourquoi ça change ta lecture."
publishDate: 2026-07-18
updatedDate: 2026-11-16
tags: ["win rate", "break-even", "statistiques", "journal de trading"]
faq:
  - question: "Faut-il compter les break-even dans le win rate ?"
    answer: "Non. Un trade à l'équilibre frais compris (P&L net à zéro) n'est ni gagnant ni perdant : il sort du calcul. Win rate = gagnants ÷ (gagnants + perdants)."
  - question: "Quel écart les break-even créent-ils sur le win rate ?"
    answer: "Exemple : 5 gains, 3 pertes, 2 break-even. Compter les break-even donne 50 %, les exclure donne 62,5 %. L'écart grandit avec le nombre de trades à l'équilibre."
  - question: "Comment MyTradingCoach compte-t-il les break-even ?"
    answer: "Les break-even (P&L net nul, frais déduits) sont comptés à part et exclus du win rate, dans le journal, les statistiques et le calendrier. Un trade sorti au prix d'entrée mais avec des frais compte comme une petite perte."
---

<p>
<strong>Les trades à l'équilibre frais compris (break-even, P&L net à zéro) ne doivent pas compter dans le win rate : win rate = gagnants ÷ (gagnants + perdants). Les compter comme des pertes fait baisser ton win rate à tort.</strong>
</p>
<p>
Petite question qui fâche : quand tu clôtures un trade à l'équilibre, ni gain ni perte, tu le comptes comment dans ton win rate ? La plupart des gens ne se posent même pas la question, et leur outil décide à leur place. Souvent mal. Résultat, ton win rate affiché n'est pas ton vrai win rate.
</p>

<h2>D'où vient l'erreur</h2>
<p>
Le win rate, c'est le pourcentage de trades gagnants. La formule naïve, celle que codent beaucoup d'outils, c'est :
</p>
<p>
<em>trades gagnants ÷ nombre total de trades</em>
</p>
<p>
Le souci saute aux yeux dès que tu as des break-even. Un trade fermé à zéro n'est ni gagnant ni perdant. Mais dans cette formule, il reste au dénominateur. Donc il fait <strong>baisser ton win rate exactement comme s'il était une perte</strong>. Ce qui est faux : tu n'as rien perdu.
</p>

<h2>La bonne formule</h2>
<p>
Un break-even doit sortir du calcul, pas être compté comme une défaite. La formule correcte, c'est :
</p>
<p>
<em>trades gagnants ÷ (gagnants + perdants)</em>
</p>
<p>
Les break-even sont mis de côté. Prends un exemple concret : 5 gains, 3 pertes, 2 break-even. La formule naïve te donne 5 sur 10, soit 50 %. La formule correcte te donne 5 sur 8, soit 62,5 %. 12,5 points d'écart sur dix trades, à cause de deux trades que tu croyais neutres. Plus tu as de break-even dans ton historique, plus l'écart grandit.
</p>

<h2>Pourquoi ça compte plus qu'il n'y paraît</h2>
<p>
Ce n'est pas qu'une histoire de vanité statistique. Ton win rate nourrit d'autres décisions : ton espérance de gain, ta confiance dans un setup, le moment où tu te dis "cette stratégie ne marche plus". Si le chiffre est biaisé vers le bas, tu risques d'abandonner une approche qui marche, ou de te croire moins bon que tu ne l'es. Les break-even sont d'ailleurs souvent le signe d'une bonne discipline (tu as ramené ton stop à l'entrée pour protéger la position), donc les pénaliser dans les stats, c'est l'inverse de ce qu'il faut. Attention aux frais : un stop remonté exactement à l'entrée donne en général une petite perte nette, égale aux commissions. Pour qu'un trade soit un vrai break-even, c'est le P&L net qui doit être nul.
</p>

<h2>Comment vérifier le tien</h2>
<p>
Ouvre ton journal actuel. Prends une période où tu sais que tu as eu des trades à l'équilibre. Recalcule le win rate à la main avec la bonne formule, et compare à ce que l'outil affiche. Si les deux collent, ton journal fait les choses bien. Sinon, tu sais maintenant pourquoi tes chiffres te paraissaient un peu tristes.
</p>
<p>
Dans MyTradingCoach, les break-even sont comptés à part et exclus du win rate, partout : journal, analytics, calendrier. C'est un choix assumé, parce qu'un chiffre faux vaut moins que pas de chiffre du tout. Si tu veux creuser ce que le win rate ne dit pas à lui seul, j'en parle plus en détail dans <a href="/blog/win-rate-trading">cet article sur le win rate</a>. Et tu peux <a href="{APP_URL}/register">tester tes propres stats gratuitement</a>.
</p>

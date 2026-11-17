---
title: "Lucid vs Apex : comprendre les différences de drawdown"
seoTitle: "Lucid vs Apex : les différences de drawdown en 50K"
description: "Lucid Trading et Apex Trader Funding en 50K : type de drawdown, moment où le plancher se fige, perte du jour. Ce qui change vraiment pour ta marge."
publishDate: 2026-11-17
updatedDate: 2026-11-17
tags: ["prop firm", "drawdown", "lucid", "apex"]
draft: true
faq:
  - question: "Quelle est la principale différence de drawdown entre Lucid et Apex en 50K ?"
    answer: "Les deux fixent une règle de 2 000 $ sur la plupart des plans 50K relevés (2 500 $ sur Apex Legacy Full). La différence tient surtout au type de suivi (fin de journée ou temps réel) et au moment où le plancher se fige, qui change selon le plan et, chez Apex, selon la plateforme pendant l'évaluation."
  - question: "Qu'est-ce qu'un drawdown trailing EOD ?"
    answer: "Le plancher suit ton plus haut solde de clôture, une fois par jour. Les mouvements en séance ne le font pas monter tant que la journée n'est pas clôturée."
  - question: "Qu'est-ce qu'un drawdown trailing intraday ?"
    answer: "Le plancher suit ton plus haut solde en temps réel, gains latents compris. Un gain non encaissé peut donc faire monter le plancher, même si le trade revient ensuite."
  - question: "Ces règles sont-elles à jour ?"
    answer: "Elles ont été relevées le 22 octobre 2026 sur les pages officielles des deux firmes. Les firmes changent parfois leurs règles : vérifie toujours auprès d'elles avant de choisir un plan."
sources:
  - title: "Lucid Trading, centre d'aide officiel"
    url: "https://support.lucidtrading.com/en/"
    consulted: 2026-10-22
  - title: "Apex Trader Funding, centre d'aide officiel"
    url: "https://apextraderfunding.com/help-center/"
    consulted: 2026-10-22
---

<!--
BROUILLON (draft: true), à valider par Greg avant toute publication.
Chiffres relevés dans le catalogue des règles (libs/shared/src/prop-firm-rules, verified_at 2026-10-22).
Avant publication : revérifier les chiffres dans le catalogue à date, et préférer des liens vers
/regles-prop-firm/lucid-50k et /regles-prop-firm/apex-50k, qui suivent le catalogue automatiquement.
-->

<p>
<strong>En 50K, Lucid Trading et Apex Trader Funding fixent une règle de drawdown de 2 000 $ sur la plupart des plans relevés (2 500 $ sur Apex Legacy Full). Ce qui les distingue, c'est la façon dont le plancher suit ton solde (fin de journée ou temps réel) et le moment où il se fige.</strong> Ces deux détails changent ta marge pendant la séance.
</p>
<p>
MyTradingCoach n'est affilié à aucune prop firm. Les règles ci-dessous sont données à titre d'information, relevées le 22 octobre 2026 : vérifie-les auprès de la firme.
</p>

<h2>Rappel : comment se lit un drawdown</h2>
<p>
Le plancher est le solde sous lequel la firme considère la règle comme cassée. Au départ, il vaut le solde de départ moins la règle. Ensuite, tout dépend du type :
</p>
<ul>
<li><strong>trailing EOD (fin de journée)</strong> : le plancher monte quand ton solde de clôture fait un nouveau plus haut ;</li>
<li><strong>trailing intraday</strong> : le plancher suit ton plus haut en temps réel, gains latents compris ;</li>
<li><strong>figé</strong> : à partir d'un certain solde, le plancher arrête de monter.</li>
</ul>

<h2>Lucid Trading en 50K</h2>
<p>
Sur les plans 50K publics relevés (LucidFlex, LucidPro, LucidDaily, LucidDirect), la règle de drawdown est de 2 000 $. Le plancher se fige à 50 100 $ une fois que le solde atteint 52 100 $.
</p>
<ul>
<li><strong>LucidFlex et LucidPro</strong> : trailing de fin de journée, en évaluation comme en funded.</li>
<li><strong>LucidDaily</strong> : l'évaluation se choisit en fin de journée ou en intraday ; le compte funded est en intraday.</li>
<li><strong>LucidDirect</strong> : compte direct, trailing de fin de journée.</li>
<li><strong>Perte du jour</strong> : pour LucidFlex, LucidPro et LucidDaily, selon l'option choisie au moment de l'achat, avec ou sans perte du jour maximale (1 200 $ sur les plans qui en ont une) ; LucidDirect en a toujours une, de 1 200 $ au départ. Sur LucidDirect et sur le funded LucidPro avec perte du jour, elle devient variable au-delà d'un solde de 52 100 $ (60 % du plus haut profit de fin de journée).</li>
<li><strong>Consistency</strong> : une règle de régularité s'applique selon le plan (par exemple, aucun jour au-delà de 40 % du profit sur certains plans en évaluation).</li>
</ul>

<h2>Apex Trader Funding en 50K</h2>
<p>
Sur les plans 50K relevés, la règle de drawdown est de 2 000 $ (2 500 $ sur le plan Legacy Full).
</p>
<ul>
<li><strong>Intraday Trail</strong> : trailing en temps réel, sans perte du jour maximale en évaluation.</li>
<li><strong>EOD Trail</strong> : trailing de fin de journée, avec une perte du jour maximale de 1 000 $ en évaluation.</li>
<li><strong>Legacy Full</strong> : trailing en temps réel, règle de 2 500 $, sans perte du jour maximale.</li>
<li><strong>Plancher figé en évaluation</strong> : il dépend de la plateforme. Sur Tradovate, le plancher d'évaluation suit le plus haut sans jamais se figer.</li>
<li><strong>Compte funded</strong> : le plancher se fige à 50 100 $ quand le solde atteint 52 100 $ (52 600 $ sur Legacy Full), avec une règle de régularité pour les retraits. Sur Intraday Trail et EOD Trail, la perte du jour maximale évolue par palier de profit, à partir de 1 000 $.</li>
</ul>

<h2>Ce que ça change pour ta marge</h2>
<p>
Avec un drawdown intraday, un gain latent qui retombe peut te coûter de la marge sans que tu aies rien encaissé. Avec un drawdown de fin de journée, seules les clôtures comptent, mais une mauvaise fin de séance compte entièrement. Et tant que le plancher n'est pas figé, chaque nouveau plus haut réduit l'écart entre ton solde de départ et le plancher.
</p>
<p>
Pour voir l'effet sur tes propres chiffres, essaie le <a href="/outils/marge-prop-firm">calculateur de marge avant la limite</a>, ou consulte le détail plan par plan sur les pages <a href="/regles-prop-firm/lucid-50k">règles Lucid 50K</a> et <a href="/regles-prop-firm/apex-50k">règles Apex 50K</a>.
</p>

<h2>Comment choisir entre les deux</h2>
<p>
Il n'y a pas de bon choix universel. La question utile est : quel type de suivi correspond à ta façon de trader ? Si tu laisses souvent courir des gains en séance avant de les rendre, un drawdown intraday te sera plus difficile à tenir. Si tes pertes arrivent surtout en fin de séance, regarde de près la perte du jour maximale. Ton <a href="/blog/meilleur-journal-trading-prop-firm">journal de trading</a> te dira laquelle de ces situations revient chez toi.
</p>

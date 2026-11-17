---
title: "Win Rate en Trading : Comment le Calculer et l'Améliorer"
seoTitle: "Win rate en trading : comment le calculer et le lire"
description: "Le win rate seul ne suffit pas. Calcule ton taux de réussite et comprends pourquoi le ratio R/R est décisif."
publishDate: 2026-04-15
updatedDate: 2026-11-16
tags: ["win rate", "statistiques", "performance", "risk reward"]
faq:
  - question: "Comment calculer son win rate en trading ?"
    answer: "Win rate = nombre de trades gagnants ÷ (gagnants + perdants). Les trades à l'équilibre (break-even) sont mis de côté : ils ne sont ni des gains ni des pertes."
  - question: "Un win rate de 70 % suffit-il ?"
    answer: "Non, pas seul. Si tes pertes moyennes sont beaucoup plus grosses que tes gains moyens, tu peux perdre de l'argent avec 70 % de trades gagnants. Il faut toujours lire le win rate avec le gain moyen et la perte moyenne."
  - question: "Qu'est-ce que l'espérance d'un trader ?"
    answer: "C'est le résultat moyen attendu par trade sur un grand nombre de trades : win rate × gain moyen − (1 − win rate) × perte moyenne. Elle décrit tes résultats passés, elle ne prédit rien."
  - question: "Combien de trades faut-il pour qu'un win rate veuille dire quelque chose ?"
    answer: "Sur quelques trades, le hasard domine. Il faut plusieurs dizaines de trades comparables (même setup, même marché) avant de tirer une conclusion, et davantage pour comparer des segments entre eux."
---

<p>
<strong>Le win rate se calcule ainsi : trades gagnants ÷ (gagnants + perdants). Mais seul, il ne dit pas si tu gagnes de l'argent : il faut le lire avec ton gain moyen et ta perte moyenne.</strong> Un win rate de 70 % peut cacher un compte qui baisse.
</p>
<p>
Exemple : si tu gagnes en moyenne 50 $ sur tes trades gagnants et perds 200 $ sur tes trades perdants, tu perds de l'argent avec 70 % de trades gagnants. Voici comment lire le chiffre correctement.
</p>

<h2>Le win rate sans le risque/rendement, c'est incomplet</h2>
<p>
La formule de l'espérance d'un trader, c'est-à-dire son résultat moyen par trade :
</p>
<p>
<code>Espérance = (win rate × gain moyen) − ((1 − win rate) × perte moyenne)</code>
</p>
<p>
Exemples chiffrés, en multiples de risque (R) :
</p>
<ul>
<li>Win rate 70 %, gain moyen 0,5R, perte moyenne 1R : 0,7 × 0,5 − 0,3 × 1 = <strong>+0,05R</strong> par trade.</li>
<li>Win rate 40 %, gain moyen 2R, perte moyenne 1R : 0,4 × 2 − 0,6 × 1 = <strong>+0,2R</strong> par trade.</li>
<li>Win rate 60 %, gain moyen 0,3R, perte moyenne 1R : 0,6 × 0,3 − 0,4 × 1 = <strong>−0,22R</strong> par trade.</li>
</ul>
<p>
Ces calculs décrivent un historique. Ils ne garantissent rien pour les trades à venir.
</p>

<h2>Les 5 métriques à lire avec le win rate</h2>

<h3>1. L'espérance</h3>
<p>
C'est la combinaison du win rate et du rapport entre gains et pertes. Une espérance positive sur ton historique veut dire que, sur cette période, tes gains ont dépassé tes pertes. Elle ne dit rien de certain sur la suite.
</p>

<h3>2. Le R/R moyen réalisé</h3>
<p>
L'écart entre le R/R prévu et le R/R réalisé révèle un problème fréquent : couper ses gains trop tôt et laisser courir ses pertes. Si tu prévois du 1:2 mais réalises du 1:0,8 en moyenne, c'est ta gestion de position qu'il faut regarder.
</p>

<h3>3. Le profit factor</h3>
<p>
Total des gains ÷ total des pertes. Sous 1, tes pertes ont dépassé tes gains sur la période. Au-dessus de 1, c'est l'inverse. Plus l'échantillon est petit, moins ce chiffre est fiable.
</p>

<h3>4. Le drawdown maximal</h3>
<p>
La plus forte baisse depuis un sommet. Un trader avec 60 % de win rate peut subir un drawdown profond s'il ne gère pas son risque. En prop firm, c'est souvent lui qui décide de la survie du compte.
</p>

<h3>5. Le win rate par setup</h3>
<p>
Ton win rate global est une moyenne. Il peut cacher un setup qui te réussit et un autre qui te coûte. Tant que tu ne segmentes pas, tu ne sais pas lequel est lequel.
</p>

<h2>Comment analyser tes propres métriques</h2>
<p>
MyTradingCoach calcule ces métriques à partir de tes trades. Le plan gratuit donne ton win rate, ton P&L et la répartition par émotion et par setup ; le détail par setup et la heatmap par heure font partie des analyses avancées du Premium. Tu vois quelles conditions ont donné tes meilleurs et tes pires résultats.
</p>

<h2>Win rate par setup : un exemple</h2>
<p>
Voici un <strong>exemple fictif</strong>, pour montrer ce que peut cacher un win rate global de 52 %. Les chiffres sont inventés pour l'illustration, ce ne sont pas des statistiques d'utilisateurs :
</p>
<ul>
<li><strong>Cassure :</strong> 48 % de trades gagnants, gains moyens deux fois plus gros que les pertes ;</li>
<li><strong>Pullback :</strong> 62 % de trades gagnants, gains et pertes de taille proche ;</li>
<li><strong>Retournement :</strong> 30 % de trades gagnants, gain moyen à peine supérieur à la perte moyenne.</li>
</ul>
<p>
Dans cet exemple, le retournement coûte de l'argent sur la période. La question à te poser n'est pas « comment devenir meilleur en retournement » mais « est-ce que je continue à le trader ».
</p>

<h2>Win rate par émotion : la métrique que personne ne regarde</h2>
<p>
Découper ton win rate par état émotionnel est souvent la lecture la plus parlante. Fais le test sur tes propres trades : compare tes trades pris concentré, stressé ou en revenge. Si les trades « revenge » ont un win rate nettement plus bas et pèsent lourd dans ton volume, tu sais où regarder en premier. L'article sur le <a href="/blog/revenge-trading">revenge trading</a> détaille comment le repérer.
</p>

<h2>Séries gagnantes et perdantes</h2>
<p>
Un win rate de 55 % ne veut pas dire une alternance régulière gain, perte, gain. Les trades se regroupent en séries, et une série de plusieurs pertes d'affilée arrive normalement, même avec un win rate supérieur à 50 %. Le savoir évite de changer de méthode après trois ou quatre pertes de suite.
</p>
<p>
Un repère raisonnable : ne remets ta méthode en cause que si tes statistiques se dégradent sur un échantillon suffisant (plusieurs dizaines de trades), pas sur une série de cinq.
</p>

<h2>Lire son win rate pour progresser</h2>
<p>
La progression ne vient pas de l'expérience accumulée dans le flou. Elle vient d'un processus simple et répété :
</p>
<ol>
<li>Relis tes cinquante derniers trades.</li>
<li>Repère les deux ou trois segments (setup, émotion, session) aux plus mauvais résultats.</li>
<li>Décide quoi faire de ces conditions : les mettre de côté, réduire ta taille, ou les retravailler.</li>
<li>Relis les cinquante suivants et compare.</li>
<li>Recommence chaque trimestre.</li>
</ol>
<p>
C'est un travail par soustraction : tu identifies ce qui te coûte avant de chercher de nouvelles techniques. Et vérifie d'abord que ton win rate est bien calculé : l'article sur <a href="/blog/win-rate-break-even">le win rate et les break-even</a> montre l'erreur la plus courante.
</p>

---
title: "Importer ses trades Tradovate dans un journal (sans se prendre la tête avec les frais)"
seoTitle: "Importer ses trades Tradovate dans un journal de trading"
description: "Comment exporter ses trades depuis Tradovate et les importer proprement dans un journal, avec les frais exacts. La méthode que peu de gens expliquent."
publishDate: 2026-07-14
updatedDate: 2026-11-16
tags: ["tradovate", "import", "prop firm", "futures"]
faq:
  - question: "Comment importer ses trades Tradovate dans un journal ?"
    answer: "Soit en connectant ton compte Tradovate en lecture seule pour que les trades arrivent tout seuls, soit en exportant le fichier Performance depuis Tradovate et en l'important dans ton journal."
  - question: "Pourquoi le P&L de l'export Tradovate ne correspond pas à mon solde ?"
    answer: "Parce que le fichier Performance donne un P&L brut, avant commissions. Les frais sont dans un autre export, le Cash history. Il faut les rapprocher de chaque trade pour obtenir le P&L net. Un petit écart peut aussi venir des frais d'une position encore ouverte ou d'un retrait."
  - question: "Mon export Tradovate est vide, pourquoi ?"
    answer: "Souvent parce que la période choisie n'affichait aucune ligne au moment de l'export. Vérifie que la table montre bien tes trades avant de télécharger le fichier."
  - question: "L'import Tradovate est-il gratuit dans MyTradingCoach ?"
    answer: "Oui. L'import CSV Tradovate et la synchro Tradovate en lecture seule sont inclus dans le plan gratuit, avec trades illimités."
---

<p>
<strong>Pour importer tes trades Tradovate dans un journal, connecte ton compte en lecture seule, ou exporte deux fichiers depuis Tradovate : Performance pour les trades et Cash history pour les frais. Le premier seul donne un P&L brut, avant commissions.</strong>
</p>
<p>
Si tu trades des futures sur Tradovate, tu as sûrement déjà buté sur ce mur : tu veux garder une trace propre de tes trades, mais recopier 30 lignes à la main après chaque séance, c'est mort. Il y a deux voies : connecter ton compte pour que les trades arrivent tout seuls, ou passer par l'export CSV. Dans le second cas, un détail casse tout le monde. Je t'explique lequel, et comment le régler.
</p>

<h2>Le vrai problème : l'export de base n'a pas tes frais</h2>
<p>
Depuis Tradovate tu peux sortir un fichier "Performance". Il contient tes trades : instrument, entrée, sortie, quantité, P&L. Nickel. Sauf que ce fichier ne contient <strong>pas les commissions</strong>. Ton P&L y est en brut, avant frais.
</p>
<p>
Pour un swing trader qui prend trois trades par semaine, ça se voit à peine. Pour un scalpeur qui empile 20 trades par jour sur du MNQ, les commissions grignotent une part énorme du résultat. J'ai vu des journées qui passent de "positive" en brut à "à peine à l'équilibre" une fois les frais déduits. Un journal qui ignore ça te ment sur tes vrais chiffres.
</p>

<h2>La solution : deux fichiers, pas un</h2>
<p>
L'astuce, c'est d'exporter <strong>deux</strong> fichiers depuis Tradovate et de les fusionner :
</p>
<ul>
<li>le fichier <strong>Performance</strong>, pour tes trades ;</li>
<li>le fichier <strong>Cash history</strong>, qui contient chaque ligne de frais (commissions, frais de bourse et de compensation).</li>
</ul>
<p>
Le fichier de trades et le fichier de frais contiennent assez d'informations (horodatage, contrat, identifiants) pour rattacher chaque frais au bon trade. Une fois la jonction faite, ton P&L net devient exact au centime. Pas une estimation, pas un total réparti au pif : la vraie somme que Tradovate t'a prélevée.
</p>
<p>
Un piège à connaître si tu scalpes : certains ordres servent à la fois à clôturer une position et à en ouvrir une autre. Si on additionne bêtement les commissions, on compte deux fois. La bonne logique déduplique. C'est le genre de détail qu'on ne voit que quand on a mis les mains dedans avec de vrais fichiers, et c'est exactement pour ça que beaucoup d'outils te sortent un chiffre approximatif.
</p>

<h2>Étape par étape</h2>
<p>
Concrètement, dans Tradovate :
</p>
<ul>
<li>Va sur ton onglet <strong>Performance</strong>, cale la période sur une journée où tu as tradé, vérifie que des lignes s'affichent, puis exporte le CSV.</li>
<li>Fais pareil depuis l'onglet <strong>Cash history</strong> pour récupérer les commissions.</li>
<li>Importe les deux dans ton journal. Le fichier de trades est obligatoire, celui des frais est optionnel mais fortement recommandé.</li>
</ul>
<p>
Petit avertissement qui m'a fait perdre du temps : si tu exportes sans vérifier que la table affiche bien des lignes, Tradovate te sort parfois un fichier vide. Regarde l'écran avant de cliquer sur "download".
</p>

<h2>Et si tu ne mets pas de stop loss ?</h2>
<p>
Beaucoup de scalpeurs entrent et sortent à la main, sans stop ni take profit posés. Dans ce cas, aucun export ne pourra te donner un ratio risque/rendement, puisqu'il n'y a jamais eu de stop. C'est normal, ce n'est pas un bug de l'import. Un bon journal doit au moins te le dire clairement au lieu d'afficher des cases vides sans explication.
</p>

<h2>Ce que j'en ai fait dans MyTradingCoach</h2>
<p>
J'ai construit l'import Tradovate autour de ce constat : les frais doivent être exacts, pas devinés. Tu déposes ton fichier Performance, tu ajoutes ton Cash history, et le calcul se fait tout seul. Zéro saisie manuelle, même sur des centaines de trades.
</p>
<p>
Encore plus simple : la synchro Tradovate. Tu connectes ton compte en lecture seule (MyTradingCoach ne peut passer aucun ordre), et tes trades arrivent tout seuls avec leurs frais, sans fichier. Le reste de l'app (journal, historique par semaine, note d'exécution, marge avant le plancher de ta prop firm) tourne ensuite sur ces données propres.
</p>
<p>
C'est gratuit, sans limite de trades, et tu peux <a href="{APP_URL}/register">tester avec ton propre export</a> en deux minutes. Si tu veux comprendre pourquoi un journal fiable change ta lecture des chiffres, jette un œil à mon article sur <a href="/blog/win-rate-trading">le win rate et ce qu'il cache</a>.
</p>

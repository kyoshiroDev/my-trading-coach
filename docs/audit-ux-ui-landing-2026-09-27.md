# Audit UX/UI — Landing MyTradingCoach (DEV)

- **Date** : 27/09/2026
- **Cible** : `https://dev.mytradingcoach.app` (build de la branche `dev`), lecture seule, aucune modification du code.
- **Méthode** : Playwright + Chrome, desktop **1440×900** et mobile **375×812** (DPR 2, tactile). Le scroll est simulé à la molette pour déclencher les animations `.reveal` / `.rstag`. Mesures automatiques : débordement horizontal, texte < 12 px, cibles tactiles < 32 px, poids réseau.
- **Captures** : `docs/audit-ux-ui-landing-2026-09-27/`. Le préfixe du fichier indique `desktop-*` ou `mobile-*`.

## ⚠️ Écarts avec le périmètre demandé

1. **`Debrief`, `CoachIA` et `Showcase` ne sont pas rendus** sur la home. Les composants existent dans `src/components/`, mais `pages/index.astro` ne les importe pas. On ne peut donc ni les capturer ni les auditer « en situation ». Conséquence directe : **la home ne montre presque aucune capture du produit** (voir plus bas).
2. **L'ordre réel n'est pas celui de la liste** : Nav → Hero → **Moments → Problem → DayTimeline** → Features → MultiComptes → Compare → Pricing → Referral → Testimonials → FAQ → CtaFinal → **Blog** (section en ligne dans `index.astro`) → Footer. L'audit suit l'ordre réel.
3. **Sur DEV, les CTA d'inscription pointent vers la PROD.** `https://app.mytradingcoach.app/register` est codé en dur dans `Pricing`, `Testimonials`, `CtaFinal`, `Nav` (sticky) et `BlogPost`. Seul `Tester la démo` utilise `APP_URL`, donc `dev.app`. Un test de conversion sur DEV crée des comptes en prod.

## Chiffres globaux

| | Desktop | Mobile |
|---|---|---|
| Hauteur de page | 11 858 px | **17 413 px** (≈ 21 écrans) |
| Poids transféré (home) | 232 Ko | 232 Ko (aucune image > 150 Ko) |
| Débordement horizontal | aucun | aucun visible (`.hero-glow` et `.cta-final-glow` dépassent, mais sont masqués) |
| Éléments de texte < 12 px | 104 | 107 (dont 26 dans DayTimeline, 19 dans Features) |

Le poids est excellent. Le problème ne vient pas du chargement : il vient de la **longueur** et de l'**absence de visuels produit**.

---

## Nav
Captures : `desktop-01-nav-links.png`, `mobile-00-above-the-fold.png`, `mobile-00b-nav-open.png`

1. **Clarté** : les libellés sont standards. Le bandeau « Fait en France · Indépendant · Tes données ne sont jamais vendues » répond à une question que le visiteur ne se pose pas encore : il ne sait même pas ce qu'est le produit.
2. **CTA** : sur desktop, un seul bouton primaire, c'est propre. Sur mobile, la barre sticky « Essayer gratuitement » **reste affichée menu ouvert** : le même CTA apparaît deux fois à l'écran, l'un sous l'autre.
3. **Crédibilité** : correcte, rien à signaler.
4. **Visuel** : la nav est sobre et cohérente. Le bandeau vert en mono ajoute une 3e couleur d'accent dès le premier pixel.
5. **Mobile** : sur 375 px, le bandeau passe sur 2 lignes et pousse le hero d'environ 50 px.

## Hero
Captures : `desktop-00-above-the-fold.png`, `desktop-02-hero.png`, `mobile-00-above-the-fold.png`, `mobile-02-hero.png`

1. **Clarté** : « Tu trades seul. Ton compagnon, lui, ne dort pas. » est une accroche émotionnelle qui **ne dit pas ce que c'est**. Le mot « journal de trading IA » n'apparaît qu'à la 2e ligne du paragraphe. **Aucune capture produit au-dessus de la ligne de flottaison**, alors que Linear et Stripe montrent l'interface dans les 900 premiers pixels.
2. **CTA** : sur desktop, la paire primaire / secondaire est bien hiérarchisée. Sur mobile, **la barre sticky recouvre le bas du hero** : on voit « Commencer gratuitement » **et** « Essayer gratuitement » empilés, deux boutons bleus au libellé différent pour la même action. « Tester la démo » passe sous la ligne de flottaison.
3. **Crédibilité** : **« 4 traders depuis le lancement »** s'affiche en tête, au-dessus du H1. L'API prod renvoie aussi `traders: 4`. C'est une anti-preuve sociale placée à l'endroit le plus vu de la page. « Le premier compagnon de trading IA » est une affirmation invérifiable.
4. **Visuel** : le H1 en 3 couleurs (blanc, italique bleu, cyan) plus les 3 pastilles colorées (vert, bleu, violet) plus le badge cyan donnent déjà 5 accents sur un seul écran.
5. **Mobile** : le H1 tient bien. Le paragraphe en 18-20 px fait 5 lignes. Le badge « multi-marché » se coupe au milieu du mot (« multi- / marché »).

## Moments — « Ton compagnon à chaque moment »
Captures : `desktop-03-moments.png`, `mobile-03-moments.png`

1. **Clarté** : c'est la meilleure section explicative. Avant, pendant, après : c'est concret. On y trouve pourtant du jargon non défini pour un débutant (« WR », « SL/TP », « NFP, PMI »), et le sigle « MTC » est utilisé sans avoir été introduit.
2. **CTA** : aucun CTA, ce qui est acceptable ici.
3. **Crédibilité** : « Alerte comportementale » et « capture tes trades en temps réel » promettent du temps réel. À vérifier avec le produit réel : sans synchro broker, la saisie reste manuelle.
4. **Visuel** : des **emojis servent d'icônes** (☀️ ⚡ 🌙). C'est le principal marqueur « template » face à Linear ou Stripe, et on le retrouve dans toutes les sections suivantes.
5. **Mobile** : les 3 cartes s'empilent sur 1 890 px, soit plus de 2 écrans pleins de listes à puces.

## Problem — « Pourquoi tu répètes les mêmes erreurs »
Captures : `desktop-04-problem.png`, `mobile-04-problem.png`

1. **Clarté** : les douleurs sont bien choisies (revenge trading, news). Mais la section arrive **après** la solution (Moments). Problème → solution serait l'ordre naturel. Elle répète aussi Moments (« 17h30 », « compagnon »).
2. **CTA** : aucun.
3. **Crédibilité** : le ton reste descriptif, sans promesse de gain. Bon point.
4. **Visuel** : une 4e grille de cartes identique aux précédentes, encore avec des emojis (😤 📅 🔁 🌙).
5. **Mobile** : 1 386 px pour 4 cartes, c'est long mais lisible.

## DayTimeline — « De 8h à minuit, il est là »
Captures : `desktop-05-journee.png`, `mobile-05-journee.png`

1. **Clarté** : la narration est bonne, mais c'est la **3e fois** que le trio avant / pendant / après est raconté (Hero, Moments, Timeline). Le récit est dense en jargon (« LONG NQ, breakout », « PMI 52.4 vs 51.5 », « SESSION LONDON »), donc opaque pour un non-futures.
2. **CTA** : aucun, après environ 4 écrans de scroll sur mobile.
3. **Crédibilité** : **« Hier : +$620, 72% WR »** est un exemple de gain chiffré présenté sans mention « illustratif ». **« Demain tu seras meilleur »** est une promesse de résultat. Le recap 17h30 et le Weekly Debrief sont Premium, mais racontés comme s'ils étaient inclus pour tous.
4. **Visuel** : c'est la section la plus « produit » de la page. Les tags mono sont petits (26 éléments < 12 px).
5. **Mobile** : **le libellé « Dimanche » est tronqué à gauche** (« imanche », `mobile-05-journee.png`). Les tags passent en 11 px.

## Features — « Tout ce dont un trader sérieux a besoin »
Captures : `desktop-06-features.png`, `mobile-06-features.png`

1. **Clarté** : 9 cartes, dont 4 **redisent** Moments et Timeline (pré-session, session live, calendrier, recap 17h30). Les vraies différences (synchro Tradovate, P&L en ticks, score /100) sont noyées au milieu.
2. **CTA** : aucun. Les badges « Gratuit / Premium » aident, mais le visiteur doit les recompter lui-même.
3. **Crédibilité** : la carte 07 annonce « Connecte ton compte Tradovate : synchro automatique ». **L'article de blog Tradovate dit l'inverse** : « l'API temps réel est verrouillée… il te reste une seule voie : l'export CSV ». Un lecteur qui lit les deux voit la contradiction. « Tout ce qu'un prop trader professionnel suit » est une affirmation sans preuve.
4. **Visuel** : c'est la grille de cartes emoji la plus générique de la page, sans aucune capture d'écran, alors que la section s'appelle « Fonctionnalités ».
5. **Mobile** : **2 736 px**, soit plus de 3 écrans de cartes. C'est le plus gros bloc de la page.

## MultiComptes — « Un compte, ou tous tes comptes »
Captures : `desktop-07-multi-comptes.png`, `mobile-07-multi-comptes.png`

1. **Clarté** : bonne pour la cible prop firm. En revanche, « Lucide », « Apex », « éval », « funded » sont supposés connus : la section parle aux initiés seulement.
2. **CTA** : le lien secondaire « page dédiée prop firm » est bien placé, mais c'est un lien texte de 17 px de haut.
3. **Crédibilité** : **la meilleure mention de la page** : « Estimation calculée… ce n'est pas le calcul officiel de ta firme ». C'est honnête et à reproduire ailleurs.
4. **Visuel** : c'est **le premier et le seul mockup d'interface de la home**, et il arrive à environ 5 400 px sur desktop et environ 8 700 px sur mobile. La note légale en mono 14 px détonne avec le reste du texte.
5. **Mobile** : le mockup passe **sous** le texte. Les onglets vont à la ligne (« Perso » seul sur une 2e ligne) et « 1 860 $ / 3 000 $ » se coupe.

## Compare — « Pourquoi MyTradingCoach plutôt que les autres ? »
Captures : `desktop-08-compare.png`, `mobile-08-compare.png`

1. **Clarté** : le tableau est lisible. Sur mobile, les concurrents sont **fusionnés en « Les autres »**, ce qui fait disparaître l'intérêt nominatif de la comparaison.
2. **CTA** : aucun, alors que c'est le moment de décision naturel juste avant Pricing.
3. **Crédibilité** : la ligne **« Prix mensuel : dès 49 €/mois »** face à « 10-29 $ » et « ~15 € » fait de MTC **le plus cher du tableau** et masque le plan Gratuit : ce devrait être « dès 0 € ». Des « — » partout chez les concurrents (coach IA, tracking émotionnel) sont vérifiables par n'importe qui, et une seule erreur décrédibilise tout le tableau (source : « mai 2026 », non détaillée). Les badges « NEW » sur une comparaison concurrentielle sont hors sujet.
4. **Visuel** : c'est propre, la section la plus « Stripe-like ».
5. **Mobile** : rien ne déborde. Les lignes passent sur 2 lignes et la section fait 1 105 px.

## Pricing — « Simple. Transparent. »
Captures : `desktop-09-pricing.png`, `mobile-09-pricing.png`

1. **Clarté** : Gratuit / Premium, c'est clair. Côté Gratuit, « 1 compte de trading » est mis en avant **au-dessus** de « Trades illimités », donc on voit d'abord la limite avant l'avantage.
2. **CTA** : la hiérarchie est bonne (ghost / primaire). Le bouton Premium porte 2 lignes, dont « 🔥 Carte requise ». L'emoji 🔥 sur une contrainte est contre-intuitif.
3. **Crédibilité** : « annulable en un clic », « aucun prélèvement avant la fin » : c'est rassurant et bien placé. « Support Discord direct » demande un lien vers un Discord réel.
4. **Visuel** : les emojis dans les listes (🌅 ⚡ 🌙 📅 📰 ✨ 💬 📋 🏆 📄) rendent la lecture moins nette que chez les SaaS de référence.
5. **Mobile** : les cartes s'empilent sur 1 912 px. **Le Premium « Recommandé » arrive 2 écrans après le Gratuit**, donc le visiteur mobile peut s'inscrire en Gratuit sans jamais voir Premium.

## Referral — « Parraine un trader, gagnez tous les deux »
Captures : `desktop-10-parrainage.png`, `mobile-10-parrainage.png`

1. **Clarté** : le mécanisme est clair. Mais **parrainer un produit qu'on n'utilise pas encore** n'a aucun sens pour un visiteur froid, et la section est placée avant les témoignages. Le titre mélange tutoiement et vouvoiement (« Parraine… gagnez »).
2. **CTA** : **aucun bouton**. Seul un lien texte de 17 px (« programme ambassadeur ») mène vers la page dédiée.
3. **Crédibilité** : pas de problème.
4. **Visuel** : 2 cartes chiffrées sobres, cohérentes avec le reste.
5. **Mobile** : le lien ambassadeur fait 163×17 px, en dessous de la cible tactile de 44 px.

## Testimonials — « Les premiers traders construisent MTC avec nous »
Captures : `desktop-11-temoignages.png`, `mobile-11-temoignages.png`

1. **Clarté** : la section s'appelle `#temoignages` mais **ne contient aucun témoignage**.
2. **CTA** : un 3e libellé pour la même action : « Rejoindre gratuitement ».
3. **Crédibilité** : **« MyTradingCoach réunit déjà 4 traders »**. Le compteur live transforme un aveu de lancement en argument. C'est le pire signal de confiance de la page, et il est répété (déjà présent dans le hero).
4. **Visuel** : un grand titre sur 3 lignes pour une seule phrase de contenu, ce qui produit un grand vide.
5. **Mobile** : pas de friction technique.

## FAQ — « Tout ce que tu veux savoir »
Captures : `desktop-12-faq.png`, `mobile-12-faq.png`

1. **Clarté** : les questions sont pertinentes. La 1re réponse redit pour la 4e fois « avant / pendant / après ». **Aucune question sur « est-ce un conseil en investissement ? »** ni sur « l'IA me dit-elle quand trader ? », alors que ce sont les objections clés à désamorcer.
2. **CTA** : aucun, ce qui est acceptable.
3. **Crédibilité** : « C'est le premier outil de trading qui couvre les 3 moments » est une nouvelle affirmation invérifiable.
4. **Visuel** : l'accordéon est sobre et correct.
5. **Mobile** : rien à signaler.

## CtaFinal — « Arrête de trader seul. Essaie gratuitement. »
Captures : `desktop-13-cta-final.png`, `mobile-13-cta-final.png`

1. **Clarté** : message clair.
2. **CTA** : un seul bouton, c'est bien. Mais **la section Blog vient après**, donc le CTA final n'est pas final.
3. **Crédibilité** : « Sans CB pour le plan Gratuit » est bien formulé.
4. **Visuel** : c'est cohérent avec le hero, et c'est normal.
5. **Mobile** : sur mobile, la barre sticky affiche le même bouton juste en dessous.

## Blog (section home) — « Ressources pour mieux trader »
Captures : `desktop-14-SECTION.png`, `mobile-14-SECTION.png`

1. **Clarté** : les 3 articles sont codés en dur (avril 2026), alors que des articles plus récents et plus « produit » existent (Tradovate, prop firm).
2. **CTA** : elle **concurrence le CtaFinal** et fait sortir le visiteur de la page juste après le CTA final.
3. **Crédibilité** : « Ressources pour *mieux trader* » frôle la promesse de performance.
4. **Visuel** : **styles inline** avec `onmouseover`, en rupture avec la convention du projet (CSS dans des fichiers). Le visuel reste cohérent.
5. **Mobile** : 1 017 px, avec le lien « Voir tous les articles » en 13 px.

## Footer
Captures : `desktop-15-FOOTER.png`, `mobile-15-FOOTER.png`

1. **Clarté** : bonne.
2. **CTA** : aucun, ce qui est normal.
3. **Crédibilité** : **très bon niveau** : absence d'agrément AMF, MiFID II, « résultats illustratifs », SIRET, mention d'affiliation NinjaTrader avec « Lien affilié ». Mais tout est **uniquement ici**, en 11 px sur desktop. Le logo NinjaTrader en orange vif est l'élément le plus saturé du footer : il attire plus l'œil que le disclaimer.
4. **Visuel** : correct. Le bloc disclaimer desktop en 11 px est difficile à lire.
5. **Mobile** : le disclaimer passe en 16 px sur environ 12 lignes, ce qui le rend lisible. Les liens légaux font 19 px de haut, donc des cibles tactiles petites.

---

## Pages annexes

### Blog : `/blog/importer-trades-tradovate-journal`
Captures : `desktop-page_blog_importer-trades-tradovate-journal.png`, `mobile-page_blog_importer-trades-tradovate-journal.png`

- **Clarté** : c'est l'article le plus convaincant du site. Il est concret, écrit à la 1re personne et montre une expertise réelle (jointure des frais, déduplication des ordres). C'est le ton qui manque à la home.
- **Crédibilité** : il **contredit la carte Features 07** (API « verrouillée » d'un côté, « synchro automatique » de l'autre). À aligner.
- **CTA** : l'encart final générique (« Rejoins les traders qui utilisent… ») est moins fort que le lien contextuel « tester avec ton propre export » présent dans le texte.
- **Mobile** : pas de débordement. Le texte est lisible.

### `/disclaimer`
Captures : `desktop-page_disclaimer.png`, `mobile-page_disclaimer.png`

- **Crédibilité** : c'est complet (AMF, crypto, NinjaTrader, hypothétiques). Sérieux.
- **CTA** : **la barre sticky « Essayer gratuitement » s'affiche aussi sur la page d'avertissement financier**. Placer un CTA de conversion au milieu d'un texte sur le risque de perte en capital est maladroit.
- **Mobile** : environ 6 400 px de texte sans sommaire ni ancres.

---

## Récapitulatif

### Les 3 problèmes les plus graves

1. **Le compteur « 4 traders » affiché deux fois (Hero et Testimonials), sans vrais témoignages.** C'est la première chose lue au-dessus du H1. Pour un visiteur froid, c'est la preuve que personne n'utilise le produit. Le fait qu'il soit « honnête » ne le transforme pas en argument.
2. **Aucune capture produit avant environ 5 400 px (desktop) et 8 700 px (mobile).** `Showcase`, `CoachIA` et `Debrief` existent mais ne sont pas rendus. Le visiteur lit 4 fois « avant / pendant / après » sans jamais voir l'app. Sur mobile, cela représente environ 10 écrans d'emojis et de cartes avant le premier mockup.
3. **Des éléments qui ressemblent à une promesse de performance ou qui se contredisent** : « +$620, 72% WR » et « Demain tu seras meilleur » (Timeline), « Ressources pour mieux trader », « le premier… », un comparatif avec des « — » invérifiables chez les concurrents, et la synchro Tradovate contredite par votre propre article. Le disclaimer n'existe qu'en footer.

### 3 quick wins à fort impact

1. **Masquer le compteur de traders sous un seuil** (par exemple < 100) dans `Hero.astro` et `Testimonials.astro`. Retitrer Testimonials en « Construit avec les premiers traders » sans chiffre, ou masquer la section. C'est environ 10 lignes de code.
2. **Rendre `<Showcase />` (ou un screenshot de l'app) juste sous le Hero** dans `index.astro`, et supprimer Problem ou Moments, qui disent la même chose. C'est un import, une ligne, et une section en moins.
3. **Mobile** : masquer la barre sticky tant que le CTA du hero est visible, quand le menu est ouvert et sur `/disclaimer`. Corriger au passage la troncature « Dimanche » et passer « Prix mensuel » du Compare à « dès 0 € ». Remplacer aussi le lien d'inscription codé en dur par `APP_URL` (sinon DEV envoie vers la prod).

### Avis : un formateur qui découvre la landing (< 10 secondes)

**Ce qui le ferait fuir :**
- « **4 traders** » en haut de page. Un formateur cherche un outil à recommander à *sa* communauté : son image est en jeu, et 4 utilisateurs, c'est un risque de réputation.
- **Rien ne lui est adressé** au-dessus de la ligne de flottaison. Le seul mot « formateur » de toute la home est un lien texte de 17 px en bas de la section Parrainage, à environ 8 500 px. Or le parrainage « +1 mois / -10 % » s'adresse à un particulier, pas à quelqu'un qui amène 200 élèves.
- « +$620, 72% WR » : un formateur sérieux sait que l'AMF surveille les promesses de gain des influenceurs trading. Il ne veut pas associer son nom à ça.

**Ce qui le convaincrait (déjà présent, mais trop bas ou mal placé) :**
- Le disclaimer AMF / MiFID, la mention affilié NinjaTrader et le SIRET : c'est exactement le niveau de conformité qu'il recherche, mais caché en 11 px dans le footer.
- Le multi-comptes prop firm et le P&L au tick près : c'est la preuve de maîtrise technique qui compte pour son audience futures.
- Le ton de l'article Tradovate (expert, concret, honnête sur les limites) : c'est ce qui crée la confiance d'un pair, et il n'apparaît nulle part sur la home.

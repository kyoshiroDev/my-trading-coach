# PROMPT — Élargir le mandat du relecteur (com, contenu, textes) + fichier de contexte

> **Contexte (08/11).** Le relecteur remonte aujourd'hui à Greg toutes les décisions de contenu (textes, déroulé d'une vidéo, accroche, formulation). Greg veut qu'il les tranche lui-même, comme le fait son assistant claude.ai, à partir du même contexte. On lui donne donc ce contexte dans le dépôt, et on élargit son mandat. Les vraies décisions business et tout ce qui touche à la prod restent à Greg.
>
> À faire sur la branche de la PR #898 (`docs/agent-relecteur`) avant son merge, ou sur une branche `docs/relecteur-mandat-com` depuis `dev` si elle est déjà mergée. Un commit `docs(agents):`. **Aucun push sans mon « OK push ».**

## 1. Créer `.claude/contexte-com.md`

```markdown
# Contexte communication et produit (lu par l'agent relecteur)

## Cible
- Trader futures francophone, souvent en évaluation ou en compte financé chez une prop firm, qui trade lui-même (pas de robot), sur Tradovate / NinjaTrader.
- Sa douleur : il connaît ses règles mais ne les tient pas sous pression (revenge trading, taille qui augmente après des pertes, trade de trop), et il perd son compte d'évaluation à cause de la limite journalière ou du drawdown.
- Message central : « Tiens tes règles quand c'est toi qui trades. » MyTradingCoach ne trade pas à ta place ; il te montre ta marge avant la limite pendant la séance et t'aide à tenir ton plan.

## Ce que dit l'expérience (chiffres réels)
- Pubs Instagram d'octobre : 166 visites, 0 inscription ; les visiteurs partent en moins de 10 s. Pas de pub tant que la page et la vidéo n'accrochent pas.
- Reel « visite complète » (08/11) : la moitié des gens partent en moins d'1 s (ouverture sur le menu de l'app). Ceux qui passent 10 s regardent jusqu'au bout. **Les 2 premières secondes décident de tout** : on ouvre sur une phrase qui touche le trader (une scène vécue), jamais sur l'interface.
- Les visuels qui marchent : la carte de marge avant la limite (« 480 $ »), les scènes concrètes avec heure et chiffres (« 15h52, deux stops, le 3e trade en taille ×3 »).
- La démo attire (109 ouvertures en 30 jours) mais n'a jamais converti : toujours un appel clair vers l'inscription.
- Concurrent direct dans l'écosystème NinjaTrader : TVNI (robot qui trade à ta place). Notre différence : le trader garde la main ; lecture seule, rien à installer, l'IA est incluse.

## Ton
- Tutoiement, phrases courtes, une idée par ligne, registre parlé accepté. Jamais un ton de cours ou de juriste.
- Chiffres concrets présentés comme des exemples ; sur les visuels, mention « Données de démonstration » ou « exemple ».
- Emojis rares (🧵 pour un fil X, 👇 pour inviter à répondre).

## Interdits absolus
- Promesse de gain, gros gain mis en avant, faux témoignage, fausse interface présentée comme réelle.
- Autre courtier ou plateforme que NinjaTrader / Tradovate ; logo Tradovate ; « partenaire officiel » ; « compatible NinjaTrader » avant un test réel sur compte live. Formule autorisée : « Référencé dans l'écosystème NinjaTrader ».
- Noms de prop firms dans les posts (rester général), sauf dans l'app et le catalogue.
- Prix en dur hors `@mtc/shared` ; prix dans les posts et les pubs.
- Le compte Instagram a déjà été sanctionné par Meta : rien qui ressemble à du trading « facile » ou à une promesse.

## Offre actuelle (valeurs exactes dans `@mtc/shared`)
- Gratuit, trades illimités. 14 jours de Premium offerts à l'inscription, sans carte.
- Premium 49 €/mois · 490 €/an. Offre fondateur 29 €/mois ou 290 €/an à vie, 200 places, satisfait ou remboursé 14 jours.
```

## 2. Élargir le mandat dans `.claude/agents/relecteur.md`

- Dans « Ce que tu lis avant de répondre », ajoute `.claude/contexte-com.md` en 4e position.
- Ajoute une section :

```markdown
## Ce que tu tranches toi-même (en plus du technique)
À partir de `contexte-com.md`, `decisions.md` et du prompt, tu décides seul, avec une ligne de raison :
- les textes à l'écran, accroches, formulations, déroulés de vidéos, légendes, textes d'interface et d'e-mails **qui restent dans le cadre** de l'offre et des interdits ;
- le choix entre plusieurs façons honnêtes de montrer une fonctionnalité (ex. utiliser une vue réelle à la place d'une vue absente) ;
- l'alignement d'un texte sur les vraies données ou les vrais libellés de l'app (on ne montre jamais un libellé ou un chiffre qui n'existe pas).
Tu rends une version **complète et prête à l'emploi** (texte final, tableau, déroulé), pas une liste de questions. Greg relit le résultat final (captures, vidéo, PR) : c'est là qu'il valide.
```

- Dans « Ce que tu ne fais JAMAIS », remplace la ligne des décisions produit par :
  « Trancher une décision **business** : prix, offre, durée d'essai, ce qui est gratuit ou Premium, CGU et textes légaux, mention NinjaTrader nouvelle, suppression de données, envoi d'e-mails ou de messages à de vrais utilisateurs, publication sur un réseau social, dépense (pub), changement de périmètre d'une tâche. »
- Dans « Pour Greg » : pour chaque décision qui lui revient, donne ta **recommandation complète et prête à valider**, puis les alternatives en une ligne chacune. Greg répond « OK » ou ajuste.

## 3. Garder le fichier à jour
Dans `CLAUDE.md`, sous la règle du relecteur : « Quand Greg donne une nouvelle règle de com ou un nouveau chiffre qui change la stratégie, ajoute-le à `.claude/contexte-com.md` dans le même commit. »

## Test à blanc
Rejoue le relecteur sur le rapport de repérage de la vidéo pub (`PROMPT-video-pub-courte.md`, étape 0 : marge figée, alerte absente, autopsie disponible, badge INTERNE). Il doit rendre directement un déroulé révisé complet (accroche alignée sur les données de la démo, autopsie au centre, vrais libellés, badge masqué), sans me poser de question. Montre-moi sa réponse. **Stop. Aucun push sans mon « OK push ».**

---

## Complément (08/11, après le test à blanc)

Greg : « Oui, ajoute la ligne puis OK push », pour la ligne proposée dans `contexte-com.md` (section Ton) :
« Libellés de l'app à reprendre tels quels : « Marge avant le plancher », « $… dispo » ; jamais « Il te reste … avant la limite » (le seul « il te reste » de l'app concerne l'objectif de profit). »

# Veille concurrentielle · FocusPips

> Lu le **2026-10-06**, pages publiques uniquement, rendues dans un navigateur (le site est une
> application JavaScript : sans rendu, les pages ne montrent que leur titre). Signalé par Val.
> Objectif : positionner MTC, pas copier. Chaque fait porte sa page source.

Pages lues : [accueil](https://focuspips.com/fr) · [tarifs](https://focuspips.com/pricing) ·
[plateformes](https://focuspips.com/plateformes) · [affiliation](https://focuspips.com/affiliation).
La page [prop firm](https://focuspips.com/propfirm) ne rend aucun texte lisible ; son contenu
public est repris de l'accueil (section « Module prop firm »).

## Ce que FocusPips affiche

| Sujet | Ce que dit le site | Source |
|---|---|---|
| Positionnement | « Journal IA N°1 en France » ; « FocusPips te dit exactement où » tu perds de l'argent : erreur « chiffrée, datée, avec le protocole pour l'arrêter » | accueil |
| Cible | Traders forex / indices, élèves de formateurs SMC/ICT ; candidats aux challenges prop firm (« Arrête de cramer des challenges ») | accueil |
| Plans | **Basic** gratuit, sans carte ; **Premium** 19 €/mois ou 228 €/an (« 4 mois offerts »), essai **7 jours**, retour automatique en Basic à la fin | tarifs |
| Limites Basic | 1 compte, 100 trades conservés, 1 plan de trading, Atlas limité à 5 questions, détail des erreurs masqué | tarifs (« Compare en détail ») |
| ⚠️ Incohérence chez eux | La FAQ de la même page dit « Premium (29€/mois ou 290€/an) », la grille dit 19 € / 228 € | tarifs |
| Synchro | Synchro auto : MT4, MT5, cTrader, TradingView, TradeLocker, **NinjaTrader**, **Tradovate** ; import fichier pour les autres (Topstep, Apex, TopOne, UFunded, Tradezella…). Connexion « en lecture seule » | plateformes, tarifs (FAQ) |
| IA | **Atlas**, coach conversationnel : patterns perdants chiffrés (revenge, actif, créneau horaire), recommandations, création de plan de trading ; rapports IA hebdo et mensuel (Premium) | accueil, tarifs |
| Prop firm (nouveau) | « +70 prop firms suivies », « 21 règles » vérifiées sur chaque trade, simulateur de challenge sur l'historique, suivi coût des challenges (dépensé vs récupéré). « Inclus dans Premium » | accueil |
| Autres outils | Backtest bougie par bougie, Trade Replay, calendrier économique, saisonnalité, sentiment retail / COT, calculatrice de position, score de compte 0 à 10, « 130+ métriques », plans de session avec check-list | accueil, tarifs |
| Langue | Site en français | accueil |
| Preuves sociales | « 3 000+ traders » ; « 4,8/5 sur Trustpilot, basé sur 55 avis vérifiés » (l'accueil affiche aussi « 4.9/5 ») ; formateurs partenaires HugoFX (152k abonnés, « partenaire principal »), ChloéFX (19k), ZeFrenchTrader (7k) | accueil, tarifs |
| Affiliation | « jusqu'à 30% de commission à vie », récurrente, mensuelle | affiliation |

## MTC vs FocusPips (points vérifiés uniquement)

Colonne MTC = ce qui est livré dans le code au 2026-10-06 (vérifié dans le dépôt).

| Point | MTC | FocusPips |
|---|---|---|
| Prix Premium | `PREMIUM_PRICE_EUR` (`libs/shared/src/pricing.ts`), essai 30 j mensuel, carte requise | 19 €/mois · 228 €/an, essai 7 j sans prélèvement |
| Gratuit | Trades et historique illimités, 1 compte (`FREE_ACCOUNT_LIMIT`) | 100 trades conservés, 1 compte |
| Tradovate | Synchro API OAuth en lecture seule, **temps réel** par WebSocket quand l'app est ouverte, historique complet, frais exacts (`integrations/tradovate/`) | « Sync. Auto » + import fichier (mode et fréquence non précisés) |
| NinjaTrader | Via Tradovate (NinjaTrader Web, même synchro) ; référencé dans l'Ecosystem NinjaTrader | « Sync. Auto » + import fichier |
| MT4 / MT5 / cTrader | Import CSV seulement | Synchro auto |
| Règles prop firm | 16 firmes futures (catalogue `libs/shared/src/prop-firm-rules/`), drawdown / perte du jour / consistency / objectif / payout calculés sur le solde broker ; alertes « avant la casse » en direct (Premium) | +70 firmes (forex et futures), 21 règles, simulateur de challenge, coût des challenges |
| Émotions / psychologie | Émotion par trade, humeur de pré-session, anti-tilt en séance (revenge, taille, surtrading, Premium) | Détection de patterns (revenge trading chiffré) par Atlas ; pas de saisie d'émotion mise en avant |
| Rituel de séance | Pré-session (humeur, objectifs, agenda éco IA) → Session live → Débrief de session | Plans de session avec check-list |
| IA | Weekly Debrief automatique, IA Insights, chat coach, récap 17h30 (Premium) ; calendrier éco et contexte marché IA (gratuit) | Atlas illimité (Premium, 5 questions en Basic), rapports hebdo et mensuel |
| Backtest / replay | Non | Oui |
| Hébergement | France (OVH) | Non précisé (« serveurs sécurisés ») |
| Affiliation | Ambassadeurs : commission récurrente de 20 % (page `/ambassadeur`) | Jusqu'à 30 % à vie |

## Constats

1. **⚠️ À corriger sur notre landing** : le tableau « Pourquoi MyTradingCoach plutôt que les
   autres ? » (`apps/landing-mytradingcoach/src/components/Compare.astro`, vérifié le 2026-10-04)
   affiche **« - » pour FocusPips** sur « Synchro Tradovate » et « Import CSV tout broker ». Leur
   page Plateformes annonce désormais les deux (Tradovate et NinjaTrader en synchro auto, import
   fichier). En publicité comparative, une cellule fausse en notre faveur est un risque : à
   mettre à jour (hors périmètre de ce document, qui ne modifie pas la landing).
2. **Ce que MTC fait mieux, et peut mettre en avant** : le **temps réel en séance** sur Tradovate
   (trades synchronisés en direct, alertes prop firm et anti-tilt pendant la session, solde broker
   réel), là où FocusPips analyse après coup ; le **rituel avant / pendant / après** ; un gratuit
   **sans limite de trades** face à 100 trades conservés ; l'hébergement en France.
3. **Ce que MTC n'a pas** : synchro MT4 / MT5 / cTrader (le forex de détail est leur cœur de
   cible), backtest et replay, simulateur de challenge, et une couverture prop firm forex (+70
   firmes contre 16 firmes futures chez nous).
4. **Prix** : Premium FocusPips nettement moins cher en affichage. MTC ne gagnera pas sur le prix
   facial ; l'argument est la valeur du live et du gratuit illimité (constat 2).
5. **Acquisition** : leur levier principal est visible et assumé : formateurs partenaires (HugoFX
   « partenaire principal », 152k abonnés) et affiliation à 30 % à vie. Notre programme
   ambassadeurs (20 % récurrent) joue sur le même terrain, avec une commission plus basse.

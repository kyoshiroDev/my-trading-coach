# Contexte marché et news live

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Contexte marché poussé (SCA-B4-03, 2026-10-01) · 2026-10-01 -->
> **Origine** : `nestjs.md` · « Contexte marché poussé (SCA-B4-03, 2026-10-01) » · 2026-10-01

## Contexte marché poussé (SCA-B4-03, 2026-10-01)

`eco-calendar/market-context.cron.ts` : toutes les 15 s, **sur le worker cron**, diffuse
`market:context` à tous les clients du namespace `/eco` (adaptateur Redis → tous les workers). Rien
si aucun client connecté (`gateway.connectedCount()`), donc pas d'appel Yahoo la nuit. La donnée
vient de `MarketDataService.getMarketContext()` (cache Redis 15 s). La route HTTP
`GET /market/context` reste pour le secours du front (5 min) et le premier affichage.

**`/eco` authentifié (SCA-B6-03, 2026-10-07)** : `EcoCalendarGateway.handleConnection` exige le JWT
de l'app dans `handshake.auth.token` (signature vérifiée par `JwtService`, **sans requête en base**,
démo acceptée) ; absent / invalide / expiré → `disconnect(true)`. `maxHttpBufferSize: 1e5`, logs de
connexion en `debug`. Front : `EcoSocketService` envoie le jeton (relu à chaque reconnexion) et
retente de façon espacée après un refus (`io server disconnect`, 2 s → 60 s). Un onglet resté sur
l'ancien front après le déploiement est refusé jusqu'au rechargement : il garde le secours HTTP
(5 min), rien ne casse.

<!-- Origine : nestjs.md · News live : traduction par lots et bandeau BREAKING (2026-10-06) · 2026-10-06 -->
> **Origine** : `nestjs.md` · « News live : traduction par lots et bandeau BREAKING (2026-10-06) » · 2026-10-06

## News live : traduction par lots et bandeau BREAKING (2026-10-06)
- **Sources** (`market-news.sources.ts`, `NEWS_FEEDS`) : 4 flux FMP, chacun sa limite (aucun n'évince
  les autres) : `general-latest` (macro, rangée sous le symbole `MACRO`), `forex-latest`, ETF indices /
  taux / pétrole + NVDA·AAPL·MSFT, et `BTCUSD,ETHUSD` limité à 5. Avant : un seul flux, 17 news
  Bitcoin sur 30.
- **Dates** : FMP date ses NEWS en heure de **New York** (le calendrier éco, lui, est en UTC) →
  `parseFmpNewsDate`. Lues comme UTC, elles étaient décalées de 4 h (5 h l'hiver).
- **Filtre par actif** (`getNews`) : actifs du journal → symboles FMP (`newsSymbolsFor` : MNQ→QQQ,
  MES→SPY, GC→XAUUSD, 6E→EURUSD, BTC/USDT→BTCUSD…), `MACRO` toujours incluse ; aucun résultat →
  toutes les news. Avant : comparaison exacte, News live vide dès le premier trade du jour.
- **Part de la crypto** (`selectNewsForDisplay`) : `getNews` lit 60 news et en garde 20, dont **4 crypto
  au plus** (`isCryptoNews` : symbole ou titre). Plafond levé si les actifs de l'utilisateur sont
  crypto. Avant : 13 news crypto sur 20 (la crypto publie en continu et prenait le haut du tri par date).

- `refreshNewsBatch` (cron 20 min, 7h-22h) traduit jusqu'à 60 **titres** par passage, par **lots de 10** (`NEWS_TITLE_BATCH`,
  `max_tokens` 1200). Avant : 30 titres en un appel à 800 tokens, JSON tronqué (« Unterminated string »)
  et **aucun** titre traduit pendant 48 h en prod. Un lot illisible, ou dont le nombre de titres ne
  correspond pas, est ignoré et retenté au passage suivant (jamais de traduction décalée).
- `getNews` renvoie `breaking` (`market-news.breaking.ts`, pur) calculé sur le titre **anglais** d'origine
  (`title`, pas `titleFr` : « ECB » devient « BCE ») : thèmes macro en **mots entiers** (Fed, FOMC,
  Powell, BCE, taux, CPI, NFP, PIB, rendements, droits de douane…), **hors crypto** (symbole ou titre),
  publiée depuis **≤ 6 h**. Le front prend la première news `breaking` ; aucune → pas de bandeau.

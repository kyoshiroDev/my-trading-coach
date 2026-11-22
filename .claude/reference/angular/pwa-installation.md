# Installation PWA de l'app

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Installation PWA de l'app (2026-10-25, PR 1 : manifest) · 2026-10-25 -->
> **Origine** : `angular.md` · « Installation PWA de l'app (2026-10-25, PR 1 : manifest) » · 2026-10-25

## Installation PWA de l'app (2026-10-25, PR 1 : manifest)

- **`public/manifest.webmanifest`** : `name` MyTradingCoach, `short_name` MTC (≤ 12 caractères,
  = `apple-mobile-web-app-title`), `display: standalone`, `scope: /`, `id: /`,
  `start_url: /dashboard?source=pwa` (mesure des lancements depuis l'écran d'accueil ; directement
  sur `/dashboard` pour ne pas dépendre de la redirection de `''`). Raccourcis Android : Séance
  (`/session`) et Statistiques (`/analytics`), avec `?source=pwa`. iOS ignore les raccourcis.
- **Couleurs** : `background_color` et `theme_color` = `--bg` de `theme.css` en dur (un manifest et
  une balise ne lisent pas de variable CSS) ; `src/index-pwa.spec.ts` casse si elles divergent.
- **Icônes** dans `public/pwa/` (192, 512 « any », maskable 512, `apple-touch-icon-180`), générées par
  `node tools/scripts/generate-app-icons.mjs` (tracé de `logo.svg`, couleurs `--blue`, `--purple`,
  `--text` lues dans `theme.css`). Maskable et Apple sont des carrés pleins sans transparence (le
  système découpe ; iOS remplit la transparence en noir), courbe réduite dans la zone sûre. Noms
  non hashés et cache d'un an côté nginx : **si le dessin change, changer le nom des fichiers**.
- **Balises iOS** dans `index.html` : `apple-touch-icon` PNG (iOS n'affiche pas de SVG),
  `apple-mobile-web-app-capable`, `mobile-web-app-capable`, barre d'état `black` (opaque) : le
  contenu des pages ne tient pas compte de `safe-area-inset-top` (seuls burger, menu et toasts),
  il passerait sous l'heure en `black-translucent`. Pas d'écran de lancement iOS.
- **Le `<link rel="manifest">` réactive le push sur iPhone** : `PUSH_BROWSER.env().hasManifest` le
  lit dans le document. Sans lui, le profil n'affiche que « Les alertes sur iPhone ne sont pas encore
  disponibles. » Vérifié sur banc (iPhone émulé) : Safari non installé → étapes d'ajout ; ouvert
  depuis l'écran d'accueil → « Activer les notifications ». Ne pas retirer le lien.
- `push-sw.js` reste le seul service worker : ni `@angular/service-worker`, ni `SwUpdate`, ni page
  hors ligne (rien n'est mis en cache, il n'y a rien à mettre à jour).
- Poids : aucun (fichiers statiques). Bundle initial 492,76 ko au 25/10/2026, marge 7,24 ko.

<!-- Origine : angular.md · Installation PWA de l'app (2026-10-25, PR 2 : parcours guidé et mesure) · 2026-10-25 -->
> **Origine** : `angular.md` · « Installation PWA de l'app (2026-10-25, PR 2 : parcours guidé et mesure) » · 2026-10-25

## Installation PWA de l'app (2026-10-25, PR 2 : parcours guidé et mesure)

Maquette qui fait foi : `maquettes/mockup-installation-pwa.html` (v4). Décisions de Greg (étape 0 et suivantes).
- **Budget du bundle** : SEUL `core/install/install-capture.ts` (`InstallCapture`) est dans le bundle
  initial : écouteurs `beforeinstallprompt` (gardé, `preventDefault`) et `appinstalled`, état de la
  feuille (`sheet`), `load()` (import dynamique du parcours). Le reste est paresseux :
  `core/install/install-prompt.service.ts` (`InstallPromptService` : états, règles, stockage,
  événements), la feuille `features/install/install-sheet.component` (`@defer (on immediate)` dans
  `App`, seulement quand `sheet()` s'ouvre), la ligne du Profil. Ne JAMAIS importer
  `InstallPromptService` depuis le bundle initial (`App`, services root chargés au démarrage) : passer
  par `InstallCapture.load()`. Mesure du 25/10/2026 : 495,04 ko (marge 4,96 ko, `dev` à 493,66 ko).
- **Détection** : `core/push/push-device.ts` (`isInAppBrowser`, `isIos`, `isIosOtherBrowser`
  CriOS/FxiOS/EdgiOS/OPiOS, `isAndroid`, `devicePlace`), partagée avec `push.service.ts`. Fichier séparé
  de `push-browser.ts`, qui est dans le bundle initial (déconnexion) : ne pas y remettre ces fonctions.
- **États** (`installState`) : `installed` (standalone ou `appinstalled`), `in-app-browser`,
  `ios-manual` / `ios-other`, `can-prompt` (invite reçue), `android-manual` (menu ⋮), `unsupported`
  (ordinateur sans invite : aucune ligne dans le Profil).
- **Quand** : jamais à l'arrivée. Gratuit : après CHAQUE import réussi (`csv-import`, fichier ou
  synchro Tradovate, `created > 0`). Premium : après la liaison d'un plan prop firm
  (`account-plan-wizard`, `propFirmPlanId` posé). Pendant `/onboarding` : gardé, montré à la première
  page hors onboarding. Ordinateur : jamais de lui-même. Délai de 600 ms (la modale se ferme d'abord).
- **Fréquence** (`frequencyAllows`, stockage `INSTALL_STORAGE`, sur l'appareil, aucune route API) :
  une fois par session (`sessionStorage`), « Plus tard » = 7 jours, « Ne plus me proposer » définitif
  (`localStorage`). Le Profil (`openFromSettings`) passe outre et n'enregistre aucun report ; pas de
  « Ne plus me proposer » dans une feuille ouverte depuis le Profil.
- **Écrans** : Android/ordinateur = écran verrouillé aux 3 vrais textes (`LOCK_SCREEN_EXAMPLES`,
  sans montant), ligne de gating masquée pour un Premium, « Installer » (invite) ou aide du menu ;
  ordinateur = texte sans écran verrouillé. iPhone Safari = 3 étapes + flèche « Ici, en bas de
  Safari » (iPhone seulement), « Je l'ai fait » revérifie le mode app, sinon « Ouvre MTC depuis ton
  écran d'accueil » et report de 7 jours. iPhone autre navigateur = « Ouvre MyTradingCoach dans
  Safari pour l'installer » + Copier le lien. Navigateur intégré = seulement « Ouvre dans ton
  navigateur » (nom de l'appli déduit de l'UA, sinon « cette application »).
- **Après installation** (lancement standalone, connecté) : `App` charge le parcours ; `install_done`
  une fois par appareil, puis invitation aux alertes 3 s plus tard, une fois par session, seulement si
  `PushService.init()` donne `supported` (donc `GET /push/settings` → `enabled: true`). « Activer les
  alertes » mène à `/profil#notifications` (aucune permission demandée par la feuille). Déjà abonné :
  plus jamais vérifié sur cet appareil.
- **Mesure** : événements `install_*`, `inapp_seen`, `push_enabled` / `push_denied` (`PushService.enable`)
  avec `place` = `devicePlace`. RATTACHÉS AU COMPTE (`ProductEventDaily.userId`), pas anonymes. Démo :
  aucun envoi.
- **Profil** : `mtc-install-settings` (onglet Paramètres, avant `mtc-push-settings`) : « Installer
  l'app » ou « App installée · ACTIVE ».
- Paliers : voile 1100, feuille 1101 (au-dessus des modales et du burger, sous les toasts) ;
  `install.styles.spec.ts`. Tests : `install-capture.spec.ts` (événements reçus avant le chargement),
  `install-prompt.service.spec.ts`, `install-sheet.component.spec.ts`, `install-settings.component.spec.ts`.

## Page publique `/installer` et bloc de la landing (#1198, étape 3 de #715)

- **`/installer`** (app, route publique sans connexion, `features/install/installer-page.component`,
  chargée à la demande : aucun poids dans le bundle initial, `noindex`) : lien du QR code de la landing et
  de l'e-mail. Détecte l'appareil par la fonction pure `installState` (`install-prompt.service.ts`) et la
  capture de l'invite (`InstallCapture`), PAS par `InstallPromptService` (qui suppose un compte connecté et
  envoie des événements) : aucune mesure sur cette page. Écrans : iPhone Safari (3 gestes), iPhone autre
  navigateur et navigateur intégré (« Copier le lien »), Android (« Installer » si l'invite existe, sinon
  menu ⋮), déjà installée (« Ouvrir MyTradingCoach »), ordinateur (« Installe MyTradingCoach sur ton
  téléphone », « Copier le lien », et « Installer sur cet ordinateur » si l'invite existe). Pas de QR dans
  la page (un build Angular unique ne connaît pas l'adresse de chaque environnement).
  `inAppName` est passé dans `core/push/push-device.ts` (partagé avec la feuille).
- **Landing** : bloc `PfInstall` sur `/prop-firm`, avant le dernier appel ; QR code en SVG produit au
  build par la dépendance de dev `qrcode` (landing seulement), adresse `${APP_URL}/installer`, affiché
  seulement sur ordinateur (`min-width: 900px` et `hover: hover`), bouton toujours présent. Voir
  `astro/prop-firm.md`.
- **E-mail** : ligne d'installation dans l'e-mail de bienvenue (`welcomeFreeTemplate`, texte validé par Greg le 22/11), en lien texte suivi vers `/installer` (`utm_campaign=welcome`), un seul bouton dans l'e-mail.
- Spec : `installer-page.component.spec.ts` (un écran par appareil, copie du lien).


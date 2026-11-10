Nouvelle feature (branche depuis dev, livrée sur dev, pas de PR : je l'ouvrirai moi-même).
Lis d'abord .claude/agents/astro.md et design.md.

## Contexte
Section « L'app en vrai » de la home : apps/landing-mytradingcoach/src/components/DemoVideo.astro,
branchée après <Compatible /> dans src/pages/index.astro (si elle n'existe pas encore, crée-la à cet
endroit). Aujourd'hui : une seule vidéo mobile dans un cadre de téléphone. Objectif : deux vidéos,
ordinateur et mobile, avec un sélecteur.

## 1. Vidéos (versions SANS titres incrustés)
Utilise les exports « -landing » de la visite (mêmes enregistrements que les fichiers
11-visite-complete-desktop-titre.mp4 / 11-visite-complete-mobile-titre.mp4, sans la pastille de
titre). S'ils n'existent pas, régénère-les avec le script d'enregistrement, sans l'incrustation des
titres. Garde « Données fictives de démonstration » en petit en bas. Vérifie en extrayant une image
toutes les 3 s qu'aucun titre n'apparaît.
Encodage (ffmpeg, H.264 high, yuv420p, +faststart, sans audio, 24 i/s, CRF ~28) :
- public/demo/visite-app-desktop.mp4 : 1920×1080, viser < 4 Mo
- public/demo/visite-app.mp4 : 720×1280, viser < 3 Mo (remplace l'actuelle)
- aperçus WebP qualité ~78, image du tableau de bord : visite-app-desktop-poster.webp (1920×1080)
  et visite-app-poster.webp (720×1280)
Supprime l'ancien visite-app.mp4 s'il est remplacé, pas de fichier orphelin dans public/demo.

## 2. Comportement
- Écran ≥ 980 px : mode ORDINATEUR par défaut + sélecteur « Ordinateur | Mobile ».
- Écran < 980 px : mode MOBILE uniquement, sélecteur masqué.
- Sélecteur : contrôle segmenté sous le texte, deux vrais <button> avec aria-pressed, icônes SVG
  (écran / téléphone), style des puces de PropFirmLive. Clic → data-ga-event="demo_video_toggle"
  data-ga-place="desktop" | "mobile". Le choix n'est pas mémorisé (ordinateur à chaque visite).

## 3. Mise en page
- Mode ordinateur : texte (label, h2, sous-titre, puces, CTA, sélecteur) centré au-dessus ; vidéo en
  dessous dans un cadre de navigateur sobre (barre de 36 px avec 3 points, coins 12 px, bordure
  var(--b2), ombre et halo bleu-violet comme .hero-shot). Largeur max 1280 px : le cadre peut
  dépasser le .wrap de 1100 px (sinon le texte de l'app tombe vers 7 px), centré, jamais plus
  large que l'écran moins 48 px.
- Mode mobile : mise en page actuelle (texte à gauche, téléphone 360 px à droite).
- Hauteur réservée par aspect-ratio (16/9 et 9/16) : aucun décalage de mise en page à la bascule.
- Titre : « Fais le tour de l'app en 50 secondes. » (adapte à la durée réelle des fichiers).
  Mention « Capture réelle · compte de démonstration » sous chaque vidéo.

## 4. Chargement et lecture (le LCP ne doit pas bouger)
- preload="none", sources en data-src, posées par le script SEULEMENT pour la vidéo affichée et
  quand la section approche (IntersectionObserver, rootMargin 200px). L'autre vidéo n'est
  téléchargée que si on bascule dessus.
- ≥ 980 px sans prefers-reduced-motion : lecture auto muette en boucle, pause hors écran ; à la
  bascule, pause de l'ancienne (et retour à 0), lecture de la nouvelle.
- < 980 px ou animations réduites : aperçu + bouton lecture (data-ga-event="demo_video_play"),
  chargement au clic seulement.
- Si play() est refusé, affiche le bouton lecture.

## 5. Règles du projet
Pas d'emoji, icônes SVG, pas de style en ligne, commentaires {/* */}, APP_URL et
PREMIUM_SIGNUP_TRIAL_DAYS importés, espace insécable avant ? ! :, couleurs via les variables de
global.css.

## 6. Vérifier avant de commiter
- pnpm --filter apps-landing-mytradingcoach build (et check si présent) : zéro erreur.
- Playwright sur la preview : captures 1440×900 (mode ordinateur), 1440×900 après bascule mobile,
  1920×1080, et 390×844. Contrôle réseau : aucune vidéo au chargement, une seule après scroll,
  la seconde seulement après bascule.
- Mets à jour l'entrée « L'app en vrai » de .claude/agents/astro.md (deux vidéos, sélecteur,
  réglages d'encodage, procédure pour refaire les captures).
- Montre-moi les captures, puis commit : feat(landing): visite vidéo ordinateur et mobile avec sélecteur

---

## Compléments de Greg (2026-11-09)

> lance la landing en local que je valide visuellement

Réponse au relecteur (section aussi sur /prop-firm ?) : couverte par le prompt suivant.

> La visite vidéo n'est pas présentable : à corriger avant tout commit de la section vidéo.
> (texte complet : .claude/prompts/PROMPT-demo-visite-vivante.md, branche fix/demo-visite-vivante)
>
> ## C. Landing
> - Mets à jour public/demo/ et DemoVideo.astro (dimensions, aspect-ratio 1920/1200).
> - Barre de navigation : le texte de la page se voit derrière les liens quand la section passe
>   dessous → fond plus opaque (même valeur que dans l'app : rgba(8,12,20,.97) + blur).
> - Section aussi sur /prop-firm après « Compatible avec », ancre #visite.

> on vois pas la partie mes comptes, aussi la video a un fonc en plus qui fait pas jolie sur le fond de la landing faudrait le supprimer et enfin on peut pas avancer ou reculer la video

Précision demandée (« fond en plus ») : « Bande de la section » (fond --bg2 + bordures de la section).

> « ça va toujours pas je veux pas du contour de couleur le lecteur doit etre mis sur la landing sans fond supplementaire »

> « ajoute une bordure autour d lecteur »

> « fait 1px de plus en epaisseur »

> « encore 1px de plus et un leger padding dans le lecteur ? »

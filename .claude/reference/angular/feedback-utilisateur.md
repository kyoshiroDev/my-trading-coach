# Feedback utilisateur : toast · inline · bloc persistant

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Feedback utilisateur : toast · inline · bloc persistant (PROMPT-210) · 2026-09-12 -->
> **Origine** : `angular.md` · « Feedback utilisateur : toast · inline · bloc persistant (PROMPT-210) » · 2026-09-12

## Feedback utilisateur : toast · inline · bloc persistant (PROMPT-210)

> Toast qui porte un bouton (`opts.action`) : durée par défaut ≥ `TOAST_ACTION_MIN_DURATION` (10 s),
> le temps de lire puis d'agir ; une `duration` explicite reste respectée (revue #712).


**Un seul système de toasts** : `core/services/toast.service.ts` (`ToastService`, root, signals)
et **un seul conteneur** `mtc-toasts` monté dans `app.ts` (`<router-outlet /><mtc-toasts />`,
hors routeur : il survit aux navigations). Ne JAMAIS recréer un toast local dans un composant
(l'ancien `feedbackToast` de session-live a été retiré).

```typescript
private readonly toast = inject(ToastService);
this.toast.success('Trade supprimé');
this.toast.error(apiErrorMessage(err, "Ce trade n'a pas pu être supprimé."));
this.toast.warning('…', { duration: null }); // null = fermeture manuelle uniquement
```

- Durées : success/info 4 s · warning/error 7 s. Pause au survol ET au focus. Croix sur chaque
  toast. 3 visibles max, les suivants en file (le minuteur ne part qu'à l'affichage). Même
  type + même message déjà affiché → relancé, pas empilé (double-clic).
- A11y : succès/info/warning `role="status"` + `aria-live="polite"` ; erreur `role="alert"` +
  `aria-live="assertive"`. `prefers-reduced-motion` respecté.
- Comportement (usuel, PROMPT-210 bis) : chaque toast vit dans une **case repliable**
  (`.toast-slot`, `grid-template-rows` 0fr ↔ 1fr) : la pile se décale en douceur à l'entrée
  comme à la sortie, sans saut. **Entrée** : glisse depuis le bord droit (0,28 s, léger
  ressort ; depuis le bas en mobile). **Barre de compte à rebours EN HAUT** (`.toast-bar`,
  `scaleX` 1 → 0 sur la durée réelle, figée via `ToastService.isPaused` = même état que le
  minuteur ; recréée quand le même message est relancé grâce à `Toast.version` ; absente si
  `duration: null`). **Sortie** : `[animate.leave]="leaveClass(id)"` (API native Angular
  ≥ 20.2, pas `@angular/animations`) — le toast repart vers le bord puis la case se replie ;
  Angular retire la case à la fin. **Glisser pour fermer** (souris ou doigt,
  `touch-action: pan-y`) : au-delà de max(80 px, 35 % de la largeur) le toast part du côté
  du geste, sinon il revient ; minuteur suspendu pendant le geste. **Mouvement réduit** :
  ni glissement ni repli animé, barre par paliers (`steps`). jsdom ne joue pas les
  animations : `toasts-animation.spec.ts` verrouille les sources (template + CSS lus avec
  `node:fs` en `@vitest-environment node` — un `.css?raw` est VIDE sous vitest).
- Position : bas-droite desktop ; mobile centré en bas **au-dessus du FAB « + »** (92 px) — le
  haut est pris par le burger. z-index 10000 (au-dessus des modales 1000).
- Message d'erreur API : **toujours** `apiErrorMessage(err, repli)` (`core/utils/api-error.ts`) —
  message du back s'il existe (tableaux ValidationPipe joints), sinon repli lisible, jamais
  `undefined`.

**Règle de choix — ne pas tout convertir :**

| Nature | Forme | Exemples |
|---|---|---|
| « Quelque chose vient de se passer, tu peux continuer » | **toast** | Lien copié · Trade enregistré/supprimé/déplacé · échec d'une action ponctuelle · retour OAuth Tradovate · « Import terminé » |
| « Corrige ça ici » | **inline, à côté du champ** | validation de formulaire (trade-form, auth), erreur API rendue dans un formulaire encore ouvert (`[apiError]` de trade-form) |
| « Information à consulter » | **bloc persistant** | récap d'import CSV, frais non rapprochés · P&L brut, position ouverte, avertissements Tradovate de la carte compte |
| État de la page | **pas un toast** | chargement, vide, paywall, « Impossible de charger ton parrainage », carte « Demande envoyée », succès mot de passe oublié / réinitialisé (le bloc REMPLACE le formulaire) |
| Échec partiel actionnable dans une modale ouverte | **inline dans la modale** | suppression d'une journée : trades restants + « Réessayer sur N trades » |

**Plus d'échec muet** : toute mutation déclenchée par l'utilisateur a une branche `error` qui
affiche un toast (ou un message inline si c'est une validation). Les chargements de fond et
rafraîchissements périodiques restent silencieux (état de page). Repérage utilisé en PROMPT-210 :
chercher les `subscribe(` sans `error`, ou dont l'`error` ne fait que relâcher un spinner.

**Tests** : `TestBed.inject(ToastService).visible()` donne `{ type, message }` des toasts
affichés (service réel, pas besoin de le mocker). Pour un composant qui monte `mtc-toasts`
(`app.spec.ts`) : `ɵresolveComponentResources` avec un résolveur vide dans `beforeAll`, puis
`overrideComponent(ToastsComponent, …)` AVANT `compileComponents()`.


**Téléphone (≤ 768 px, 2026-10-18)** : pile **en haut**, sous la barre du burger / du bandeau démo
(`top: safe-area + 60px`), **un seul toast visible** (`ToastService.setMaxVisible(1)` posé par
`mtc-toasts` via `matchMedia`), les autres en file (« +N »). Avant : jusqu'à 3 toasts à 92 px du bas,
en plein contenu. Le refus « mode démo » (403 `DemoReadOnlyGuard`) ne fait **jamais** de toast :
`demoInterceptor` ouvre déjà l'invite « Crée ton compte » (`ToastService.show` l'ignore).
Le 403 `PREMIUM_REQUIRED` (`PremiumGuard`) : `premiumInterceptor` relit le compte (une fois par 10 s)
pour que les écrans gatés repassent au cadenas, et `apiErrorMessage` rend « Cette fonctionnalité est
réservée au Premium. » au lieu du repli de l'écran (B17 #1013).

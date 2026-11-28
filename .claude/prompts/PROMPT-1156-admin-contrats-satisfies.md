# PROMPT-1156 : typage des réponses /admin contre les contrats @mtc/shared

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Ticket #1156 : Typage des réponses /admin contre les contrats @mtc/shared (Date sérialisée + satisfies)

Remonté par les vérificateurs nestjs et tests de #1102 (audit fonctionnel #993), dette hors audit.

Les réponses des routes `/admin` (ex. `UsersService.adminSubscriptions`, `FounderAdminService` pour `/admin/founders`) n'annoncent aucun type de retour : le contrat `@mtc/shared` (`AdminSubscriptionsData`, `AdminFoundersData`…) n'est contrôlé que côté admin. Un champ retiré, renommé ou ajouté côté API passe le typecheck sans rien signaler.

Piste : un type utilitaire « Date sérialisée en string » (Prisma renvoie des `Date`, le contrat des `string` ISO) et `satisfies` sur l'objet renvoyé par chaque route admin non typée. Précédent avec mapping explicite : `user-detail.service.ts` (`Promise<AdminUserDetail>`).

À noter dans le même chantier : typer le helper `render` de `apps/admin-mytradingcoach/src/app/features/subscriptions/subscriptions.render.spec.ts` en `AdminSubscriptionsData` (demande des `as const` sur les helpers de données et des `Partial` sur les listes facultatives).

## Arbitrage du relecteur (2026-11-27)

Le typecheck révèle que `User.stripeInterval` et `FounderSeat.interval` sont des `String` Prisma alors que le contrat dit `'month' | 'year'`. Option (b) retenue : rétrécir côté API à l'exécution (`billingInterval`, valeur inconnue → null ; founders comme `user-detail.service.ts`), contrat inchangé, test unitaire du helper. Routes `stats` et `online` hors périmètre (notées dans la PR).

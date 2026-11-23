# PROMPT-824 — Purge des comptes inactifs

## Texte de Greg (2026-11-23)

> pourquoi #824 bloquée

> la CNIL recommande 2 ans donc si la personne ses pas connecter depuis 2 ans depuis sa derniere connexion on supprime le compte mais on lui envoie un mail automatique toute les semaine du dernier mois pour lui preciser que sont compte vas être supprimer si il se connecte pas

## Tâche : issue #824

Suite de la décision F3 de #745. La politique dit « Compte et trades : jusqu'à la suppression du compte » : un compte abandonné est donc gardé sans limite, ce qui est le point le plus fragile au regard de la minimisation (RGPD, art. 5.1.e).

## À décider avant de coder
- Durée d'inactivité (à fixer avec le juriste) et définition de l'inactivité : `User.lastSeenAt`, avec un repli à définir pour les comptes où il est nul.
- Durée et contenu du préavis.

## À faire
- Cron qui repère les comptes inactifs, sur le worker cron.
- E-mail de service de préavis, envoyé sans condition de consentement marketing, avec une connexion suffisant à annuler la purge.
- Suppression par le même chemin que `archiveAndDelete` (`users.service.ts`), qui résilie les abonnements Stripe et écrit `DeletedAccount`. `deletedBy` doit distinguer ce cas.
- Exclure les comptes démo, admin, et tout compte avec un abonnement en cours.
- Mettre à jour le §3 de la politique et les CGU seulement une fois la purge en place.

## Points d'attention
- Écrire `DeletedAccount` bloque l'essai pendant 90 jours si la personne se réinscrit (#769) : à trancher pour une purge que la personne n'a pas demandée.
- Une donnée purgée reste dans les sauvegardes jusqu'à leur renouvellement (§3).
- Commencer par un mode « journal seul » pour compter les comptes concernés avant d'activer.


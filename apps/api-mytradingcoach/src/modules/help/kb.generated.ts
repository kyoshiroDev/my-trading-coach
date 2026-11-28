// Généré par `pnpm help-kb:generate` depuis kb/*.md (#493). Ne pas modifier à la main.
import type { HelpKbEntry } from './kb-parse';

export const HELP_KB: readonly HelpKbEntry[] = [
  {
    "id": "ajouter-compte",
    "title": "Comment ajouter un compte de trading ?",
    "keywords": [
      "ajouter un compte",
      "nouveau compte",
      "plus compte",
      "creer compte de trading",
      "créer un compte de trading",
      "plusieurs comptes",
      "multi comptes",
      "limite de comptes",
      "comptes illimites",
      "compte en plus"
    ],
    "audience": "app",
    "links": [
      "/accounts"
    ],
    "body": "Clique sur « + Compte » dans le sélecteur de compte, depuis n'importe quelle page : la fenêtre d'ajout de [Mes comptes](/accounts) s'ouvre.\nEn gratuit, tu as {{FREE_ACCOUNT_LIMIT}} compte actif avec les règles de sa prop firm. En Premium, tu as des comptes illimités.\nUn compte validé, échoué ou archivé libère sa place."
  },
  {
    "id": "alertes-anti-tilt",
    "title": "Comment marchent les alertes avant la limite et l'anti-tilt ?",
    "keywords": [
      "alertes",
      "alerte limite",
      "limite de perte",
      "perte du jour",
      "drawdown",
      "anti-tilt",
      "antitilt",
      "tilt",
      "revenge trading",
      "surtrading",
      "taille qui grossit",
      "notification",
      "son"
    ],
    "audience": "all",
    "links": [
      "/profil#notifications"
    ],
    "body": "En Premium, l'app t'alerte avant ta limite de perte : perte du jour, drawdown, consistency, et aussi objectif atteint ou payout possible.\nL'anti-tilt repère trois choses : une reprise de position juste après une perte, une taille qui grossit et le surtrading.\nÇa marche quand l'app est ouverte, ou en notification pendant ta séance, avec un compte Tradovate connecté. Rien sur une saisie manuelle, et pas d'e-mail. Active les notifications dans [Profil > Paramètres](/profil#notifications)."
  },
  {
    "id": "code-partenaire",
    "title": "J'ai un code partenaire, comment ça marche ?",
    "keywords": [
      "code partenaire",
      "code promo",
      "code reduction",
      "code réduction",
      "coupon",
      "formateur",
      "partenaire",
      "remise",
      "promo",
      "code de reduc"
    ],
    "audience": "all",
    "links": [
      "/profil?tab=params"
    ],
    "body": "Un formateur partenaire peut te donner un code, souvent dans son lien. Le code baisse le prix du Premium selon ses conditions, affichées avant le paiement : à vie, ou pendant quelques mois puis prix normal.\nTu le saisis dans le champ « Code partenaire » de la fenêtre des offres.\nRègles :\n- un seul code par personne, réservé à qui n'a jamais été abonné ;\n- pas de cumul avec l'offre fondateur ; face au parrainage, c'est la réduction la plus avantageuse qui s'applique ;\n- les conditions obtenues ne changent plus, et la remise s'arrête si ton abonnement se termine."
  },
  {
    "id": "connecter-tradovate",
    "title": "Comment connecter mon compte Tradovate ?",
    "keywords": [
      "connecter tradovate",
      "connexion tradovate",
      "lier tradovate",
      "relier tradovate",
      "synchro tradovate",
      "synchroniser",
      "tradovat",
      "tradovate connect",
      "brancher mon compte",
      "sync automatique",
      "connecter mon broker"
    ],
    "audience": "app",
    "links": [
      "/accounts"
    ],
    "body": "Va dans [Mes comptes](/accounts) et clique sur « Connecter Tradovate » sur la ligne du compte. Pas encore de compte ? Ajoute-le avec « + Compte » dans le sélecteur de compte.\nTu es redirigé vers la page de connexion officielle Tradovate. Connecte-toi avec les identifiants de ta plateforme (NinjaTrader ou Tradovate) ou avec ceux de ta prop firm, puis autorise MyTradingCoach en lecture seule.\nUne prop firm = une connexion : répète l'opération pour chaque firm. Ensuite, les trades du compte se synchronisent tout seuls."
  },
  {
    "id": "connexion-google",
    "title": "Comment me connecter avec Google ?",
    "keywords": [
      "google",
      "connexion google",
      "continuer avec google",
      "compte google",
      "gmail",
      "delier google",
      "délier google",
      "inscription google",
      "se connecter google"
    ],
    "audience": "all",
    "links": [
      "/login",
      "/register",
      "/profil?tab=params"
    ],
    "body": "Sur la page de connexion ou d'inscription, choisis « Continuer avec Google ». Google nous transmet seulement ton nom, ton e-mail vérifié et un identifiant technique : jamais ton mot de passe ni tes contacts.\nSi un compte existe déjà avec la même adresse, Google y est relié.\nPour délier Google, va dans Profil > Paramètres > Compte > « Connexion Google ». Il faut d'abord avoir défini un mot de passe."
  },
  {
    "id": "contacter-support",
    "title": "Comment contacter le support ?",
    "keywords": [
      "contact",
      "contacter",
      "support",
      "aide",
      "parler a quelqu'un",
      "parler à un humain",
      "email support",
      "adresse mail",
      "probleme",
      "problème",
      "bug",
      "reclamation"
    ],
    "audience": "all",
    "links": [
      "https://discord.gg/TDK2npvkSN"
    ],
    "body": "Écris à support@mytradingcoach.app : c'est l'adresse de contact indiquée dans les CGU et la politique de confidentialité.\nTu peux aussi rejoindre la communauté sur [Discord](https://discord.gg/TDK2npvkSN)."
  },
  {
    "id": "debrief-hebdo",
    "title": "C'est quoi le Débrief hebdo ?",
    "keywords": [
      "debrief hebdo",
      "débrief hebdo",
      "debrief de la semaine",
      "bilan de la semaine",
      "weekly",
      "weekly debrief",
      "resume semaine",
      "dimanche",
      "pdf",
      "debrief automatique"
    ],
    "audience": "all",
    "links": [
      "/debrief",
      "/profil?tab=params"
    ],
    "body": "Le Débrief hebdo, c'est le débrief de ta semaine rédigé par le coach IA. Il fait partie de Premium.\nIl arrive chaque dimanche, avec son PDF, si tu as tradé dans la semaine et que « Débrief hebdo automatique » est activé dans [Profil > Paramètres](/profil?tab=params).\nTu retrouves tous tes débriefs dans [Débrief hebdo](/debrief)."
  },
  {
    "id": "demo",
    "title": "Comment voir la démo ?",
    "keywords": [
      "demo",
      "démo",
      "essayer sans compte",
      "compte demo",
      "voir l'app",
      "tester",
      "donnees d'exemple",
      "données d'exemple",
      "lecture seule demo",
      "mode demo",
      "quitter la demo"
    ],
    "audience": "all",
    "links": [
      "/demo",
      "/register"
    ],
    "body": "La [démo](/demo) te fait explorer MyTradingCoach avec des données d'exemple, sans créer de compte.\nElle est en lecture seule : tu peux tout regarder, mais rien ajouter ni modifier (« Action non disponible en mode démo »).\nPour l'utiliser avec tes propres trades, [crée ton compte](/register) : c'est gratuit."
  },
  {
    "id": "discord",
    "title": "Comment relier mon compte Discord ?",
    "keywords": [
      "discord",
      "serveur discord",
      "verify",
      "code discord",
      "role premium",
      "rôle discord",
      "communaute",
      "communauté",
      "relier discord",
      "delier discord"
    ],
    "audience": "app",
    "links": [
      "/profil?tab=params",
      "https://discord.gg/TDK2npvkSN"
    ],
    "body": "Dans [Profil > Paramètres](/profil?tab=params), bloc « Discord », clique sur « Générer un code ». Tape ensuite /verify dans Discord et colle ce code. Ne le partage pas.\nTon rôle sur le serveur suit ton plan (membre ou Premium). Tu peux délier ton Discord au même endroit."
  },
  {
    "id": "donnees-personnelles",
    "title": "Où sont mes données et que faites-vous avec ?",
    "keywords": [
      "donnees personnelles",
      "données personnelles",
      "rgpd",
      "hebergement",
      "hébergement",
      "ovh",
      "vie privee",
      "confidentialite",
      "ia anthropic",
      "claude",
      "copie de mes donnees",
      "export donnees",
      "revente"
    ],
    "audience": "all",
    "links": [
      "https://www.mytradingcoach.app/politique-confidentialite"
    ],
    "body": "Ta base de données est hébergée en France chez OVH, et tes données ne sont jamais vendues.\nPour l'IA, on utilise l'API de Claude (Anthropic). Selon la fonction, elle reçoit tes trades, tes notes et le nom de tes comptes, mais jamais ton nom ni ton e-mail, et elle n'a pas le droit d'entraîner ses modèles dessus.\nPour une copie de tes données en CSV ou pour exercer tes droits, écris à support@mytradingcoach.app. Tout est détaillé dans la [politique de confidentialité](https://www.mytradingcoach.app/politique-confidentialite)."
  },
  {
    "id": "emails",
    "title": "Comment gérer les e-mails que je reçois ?",
    "keywords": [
      "emails",
      "e-mails",
      "mails",
      "newsletter",
      "desabonner",
      "désabonner",
      "desinscrire",
      "se désinscrire",
      "trop de mails",
      "recap du soir",
      "notifications email",
      "spam",
      "preferences"
    ],
    "audience": "app",
    "links": [
      "/profil?tab=params"
    ],
    "body": "Dans [Profil > Paramètres](/profil?tab=params), bloc « Préférences », tu as trois réglages :\n- « Notifications email » : Débriefs hebdo, récaps du soir et alertes importantes ;\n- « Débrief hebdo automatique » ;\n- « Emails marketing » : conseils, nouveautés et offres.\n\nTu peux aussi te désinscrire avec le lien présent dans chaque e-mail d'aide ou d'offres."
  },
  {
    "id": "essai-premium",
    "title": "Comment marche l'essai Premium ?",
    "keywords": [
      "essai",
      "essai gratuit",
      "periode d'essai",
      "période d'essai",
      "premium offert",
      "jours offerts",
      "sans carte",
      "fin de l'essai",
      "trial",
      "essai premium",
      "essaie"
    ],
    "audience": "all",
    "links": [
      "/register"
    ],
    "body": "À l'inscription, tu as {{TRIAL_DAYS}} jours de Premium offerts, sans carte bancaire.\nÀ la fin, ton compte repasse automatiquement en Gratuit, sans rien perdre et sans prélèvement. Pour rester en Premium, choisis une offre : l'abonnement démarre tout de suite, sans nouvel essai.\nCes jours offerts ne sont accordés qu'une fois par personne. Ton compte date d'avant cette offre et tu n'as jamais eu d'essai ? Un essai de {{STRIPE_TRIAL_DAYS}} jours avec carte reste possible sur le mensuel."
  },
  {
    "id": "fin-essai",
    "title": "Que se passe-t-il à la fin de mon Premium offert ?",
    "keywords": [
      "fin de l'essai",
      "fin essai",
      "premium offert termine",
      "retour gratuit",
      "repasser gratuit",
      "comptes en trop",
      "compte garde",
      "compte gardé",
      "je perds mes donnees",
      "prelevement"
    ],
    "audience": "app",
    "links": [
      "/accounts",
      "/profil?tab=params"
    ],
    "body": "Rien n'est supprimé : tu repasses en Gratuit automatiquement, sans prélèvement. Le bandeau en haut de l'app et ton Profil t'indiquent la date de fin.\nTu as plus de comptes que le Gratuit n'en permet ? Choisis dans [Mes comptes](/accounts) celui que tu gardes ; les autres restent visibles."
  },
  {
    "id": "frequence-synchro",
    "title": "À quelle fréquence mes trades sont-ils synchronisés ?",
    "keywords": [
      "frequence synchro",
      "fréquence synchronisation",
      "synchro",
      "temps reel",
      "temps réel",
      "en direct",
      "trades pas a jour",
      "trades manquants",
      "mise a jour",
      "delai",
      "délai",
      "synchroniser maintenant",
      "rafraichir"
    ],
    "audience": "all",
    "links": [
      "/accounts"
    ],
    "body": "En direct quand MyTradingCoach est ouvert. Application fermée, un relevé automatique passe environ toutes les {{BACKGROUND_SYNC_MINUTES}} minutes.\nTes trades et leurs frais arrivent automatiquement. Pour forcer une mise à jour, clique sur « Synchroniser » sur ton compte dans [Mes comptes](/accounts)."
  },
  {
    "id": "gratuit",
    "title": "C'est vraiment gratuit ?",
    "keywords": [
      "gratuit",
      "free",
      "plan gratuit",
      "sans carte",
      "carte bancaire",
      "combien ca coute",
      "c'est payant",
      "limite gratuit",
      "version gratuite",
      "gratos"
    ],
    "audience": "all",
    "links": [
      "/register"
    ],
    "body": "Oui. Le plan Gratuit n'a pas de limite de durée et ne demande aucune carte bancaire.\nIl couvre le quotidien : synchro Tradovate en lecture seule, {{FREE_ACCOUNT_LIMIT}} compte avec les règles de sa prop firm suivi en direct, journal et trades illimités, préparation et débrief de chaque séance, calendrier éco, news et contexte marché.\nÀ l'inscription, tu as en plus {{TRIAL_DAYS}} jours de Premium offerts."
  },
  {
    "id": "import-csv",
    "title": "Comment importer mes trades en CSV ?",
    "keywords": [
      "import csv",
      "importer csv",
      "fichier csv",
      "export",
      "importer mes trades",
      "historique",
      "performance",
      "cash history",
      "autre broker",
      "import ia",
      "fichier excel",
      "imprt csv"
    ],
    "audience": "all",
    "links": [
      "/journal"
    ],
    "body": "Dans le [Journal](/journal), clique sur « CSV ».\n- Source « Tradovate » : ajoute le fichier des trades (Performance, obligatoire) et, si possible, le Cash history pour avoir les frais exacts. Le plus simple reste quand même de connecter ton compte Tradovate.\n- Source « Autre broker » : plusieurs formats d'export courants sont reconnus d'office, en gratuit. Si le format n'est pas reconnu, l'import IA lit ton fichier, mais il est réservé au Premium."
  },
  {
    "id": "installer-app",
    "title": "Comment installer l'app sur mon téléphone ?",
    "keywords": [
      "installer",
      "installation",
      "application mobile",
      "appli",
      "telephone",
      "téléphone",
      "iphone",
      "android",
      "ecran d'accueil",
      "écran d'accueil",
      "store",
      "app store",
      "pwa"
    ],
    "audience": "all",
    "links": [
      "/installer"
    ],
    "body": "Ouvre [la page d'installation](/installer) sur ton téléphone : elle t'affiche les étapes pour ton appareil.\nPas de store, rien à télécharger : c'est ton navigateur qui ajoute MyTradingCoach à ton écran d'accueil. Sur iPhone, passe par Safari.\nSur ordinateur, la même page te propose « Installer sur cet ordinateur »."
  },
  {
    "id": "journal",
    "title": "Comment utiliser le journal ?",
    "keywords": [
      "journal",
      "journal de trading",
      "nouveau trade",
      "ajouter un trade",
      "saisie manuelle",
      "noter un trade",
      "emotions",
      "émotions",
      "setup",
      "notes",
      "historique",
      "filtrer"
    ],
    "audience": "app",
    "links": [
      "/journal"
    ],
    "body": "Le [Journal](/journal) liste tous tes trades, sans limite et avec tout l'historique.\nClique sur « Nouveau trade » pour une saisie à la main, ou sur « CSV » pour importer un fichier. Les trades d'un compte Tradovate connecté arrivent tout seuls.\nTu peux filtrer par période ou par setup, et noter émotions, setups et notes pour comprendre ce qui marche pour toi."
  },
  {
    "id": "lecture-seule",
    "title": "L'app peut-elle passer des ordres ou toucher à mon argent ?",
    "keywords": [
      "passer des ordres",
      "ordre",
      "lecture seule",
      "toucher mon compte",
      "retrait",
      "mouvement d'argent",
      "securite",
      "sécurité",
      "mot de passe tradovate",
      "trader a ma place",
      "trade à ma place",
      "robot",
      "acces compte"
    ],
    "audience": "all",
    "links": [
      "/accounts"
    ],
    "body": "Non. La connexion Tradovate est en lecture seule : aucun ordre, aucun mouvement d'argent.\nMyTradingCoach ne voit jamais ton mot de passe et ne fait que lire tes trades. Tu peux révoquer l'accès quand tu veux avec « Déconnecter » dans [Mes comptes](/accounts).\nTes décisions de trading restent les tiennes."
  },
  {
    "id": "marches",
    "title": "Quels marchés sont pris en charge ?",
    "keywords": [
      "marches",
      "marchés",
      "futures",
      "cme",
      "crypto",
      "forex",
      "actions",
      "indices",
      "cfd",
      "instruments",
      "multi-marche",
      "ticks"
    ],
    "audience": "all",
    "links": [
      "/journal"
    ],
    "body": "Futures CME (P&L en ticks avec les multiplicateurs officiels), crypto spot et levier, forex, indices CFD et actions : un seul journal pour tout.\nLa synchro automatique passe par Tradovate. Pour le reste, utilise l'import CSV ou la saisie manuelle."
  },
  {
    "id": "mensuel-annuel",
    "title": "Puis-je passer du mensuel à l'annuel (ou l'inverse) ?",
    "keywords": [
      "passer a l'annuel",
      "passer à l'annuel",
      "passer au mensuel",
      "changer d'offre",
      "mensuel annuel",
      "changer de formule",
      "proratise",
      "proratisé",
      "intervalle"
    ],
    "audience": "app",
    "links": [
      "/profil?tab=params"
    ],
    "body": "Oui, si ton abonnement est actif. Dans [Profil > Paramètres](/profil?tab=params), bloc « Abonnement », clique sur « Passer à l'annuel » (ou « Passer au mensuel ») : le nouveau prix s'affiche.\nLe changement est proratisé et facturé tout de suite. Un fondateur garde sa place et son numéro ; un code partenaire garde son tarif."
  },
  {
    "id": "mot-de-passe-oublie",
    "title": "J'ai oublié mon mot de passe, comment le changer ?",
    "keywords": [
      "mot de passe oublie",
      "mot de passe oublié",
      "mdp",
      "reinitialiser",
      "réinitialiser",
      "changer mot de passe",
      "reset password",
      "je n'arrive pas a me connecter",
      "connexion impossible",
      "mot de pass"
    ],
    "audience": "all",
    "links": [
      "/forgot-password",
      "/login"
    ],
    "body": "Sur la page de connexion, clique sur « Mot de passe oublié ? » et saisis ton e-mail. Si un compte existe, tu reçois un lien de réinitialisation.\nCompte créé avec Google ? Pas besoin de mot de passe : connecte-toi avec Google. Le même lien te permet aussi d'en définir un.\nDéjà connecté ? Va dans Profil > Paramètres > Compte > Mot de passe, puis « Modifier »."
  },
  {
    "id": "ninjatrader",
    "title": "J'utilise NinjaTrader, comment ça marche ?",
    "keywords": [
      "ninjatrader",
      "ninja trader",
      "ninja",
      "nt",
      "ninjatrader web",
      "identifiants ninjatrader",
      "ecosysteme ninjatrader",
      "écosystème ninjatrader",
      "compte ninjatrader",
      "ninjatrder"
    ],
    "audience": "all",
    "links": [
      "/accounts"
    ],
    "body": "La connexion passe par la page de connexion officielle Tradovate. Tu y entres les identifiants de ta plateforme NinjaTrader ou Tradovate, ou ceux fournis par ta prop firm, puis tu autorises la lecture seule.\nMyTradingCoach est référencé dans l'écosystème NinjaTrader. Aucun ordre n'est passé, et l'app ne voit jamais ton mot de passe.\nTout se fait depuis [Mes comptes](/accounts) > « Connecter Tradovate »."
  },
  {
    "id": "offre-fondateur-cloturee",
    "title": "L'offre fondateur est-elle encore disponible ?",
    "keywords": [
      "offre fondateur terminee",
      "fondateur cloturee",
      "clôturée",
      "plus de places fondateur",
      "complet",
      "fondateur fini"
    ],
    "audience": "all",
    "links": [
      "/profil?tab=params"
    ],
    "body": "L'offre fondateur est clôturée. Les fondateurs gardent leur tarif de {{FOUNDER_MONTHLY}} € par mois ou {{FOUNDER_YEARLY}} € par an tant que leur abonnement reste actif, nouveautés Premium comprises.\nLe Premium reste disponible au prix normal, et tout nouvel inscrit a {{TRIAL_DAYS}} jours de Premium offerts, sans carte."
  },
  {
    "id": "offre-fondateur",
    "title": "C'est quoi l'offre fondateur ?",
    "keywords": [
      "offre fondateur",
      "fondateur",
      "prix bloque",
      "prix bloqué a vie",
      "places fondateur",
      "combien de places",
      "tarif fondateur",
      "early bird",
      "founder",
      "fondateurs"
    ],
    "audience": "all",
    "links": [
      "/profil?tab=params",
      "https://www.mytradingcoach.app/cgu#offre-fondateur"
    ],
    "body": "Les {{FOUNDER_SEATS}} premiers abonnés ont le Premium à {{FOUNDER_MONTHLY}} € par mois ou {{FOUNDER_YEARLY}} € par an TTC. Le prix est bloqué à vie tant que l'abonnement reste actif, nouveautés comprises. {{FOUNDER_SEATS_LABEL}}.\nIl n'y a pas d'essai : le premier paiement est immédiat. Pendant ton Premium offert, tu peux réserver ta place sous conditions (voir les CGU).\nTu es satisfait ou remboursé pendant {{FOUNDER_REFUND_DAYS}} jours après le premier paiement. Si tu résilies, tu perds le tarif. L'offre ne se cumule ni avec un code partenaire ni avec le parrainage."
  },
  {
    "id": "parrainage",
    "title": "Comment fonctionne le parrainage ?",
    "keywords": [
      "parrainage",
      "parrain",
      "filleul",
      "lien de parrainage",
      "inviter un ami",
      "mois offert",
      "reduction filleul",
      "réduction",
      "referral",
      "parainage"
    ],
    "audience": "app",
    "links": [
      "/parrainage"
    ],
    "body": "Dans [Parrainage](/parrainage), copie ton lien et partage-le.\nTon filleul démarre avec -{{REFERRAL_DISCOUNT_PCT}} % sur sa première année, mensuel ou annuel. Toi, tu gagnes un mois offert dès qu'il devient abonné payant : la simple inscription ne compte pas. Tu peux parrainer autant de traders que tu veux.\nLe parrainage ne se cumule pas avec l'offre fondateur. Face à un code partenaire, c'est la réduction la plus avantageuse qui s'applique."
  },
  {
    "id": "passer-premium",
    "title": "Comment passer Premium ?",
    "keywords": [
      "passer premium",
      "s'abonner",
      "abonnement",
      "payer",
      "paiement",
      "souscrire",
      "upgrade",
      "acheter premium",
      "continuer en premium",
      "debloquer",
      "débloquer",
      "cadenas"
    ],
    "audience": "app",
    "links": [
      "/profil?tab=params"
    ],
    "body": "Va dans [Profil > Paramètres](/profil?tab=params), bloc « Abonnement », et clique sur le bouton pour passer Premium.\nTu choisis ton offre (mensuel, annuel, fondateur s'il reste des places, ou code partenaire), puis tu paies sur la page de paiement sécurisée par Stripe.\nLe cadenas d'une fonction Premium ouvre la même fenêtre."
  },
  {
    "id": "premium",
    "title": "Qu'est-ce qui est inclus dans Premium et combien ça coûte ?",
    "keywords": [
      "premium",
      "prix",
      "tarif",
      "combien",
      "abonnement",
      "mensuel",
      "annuel",
      "qu'est-ce qui est premium",
      "avantages premium",
      "payant",
      "cout",
      "coût",
      "premuim"
    ],
    "audience": "all",
    "links": [
      "/profil?tab=params"
    ],
    "body": "Premium coûte {{PREMIUM_MONTHLY}} € TTC par mois, ou {{PREMIUM_YEARLY}} € TTC par an (tu économises {{PREMIUM_ANNUAL_SAVINGS}} € sur l'année).\nIl ajoute :\n- les alertes avant ta limite de perte et l'anti-tilt en direct (compte Tradovate connecté) ;\n- des comptes illimités, chacun avec les règles de sa prop firm ;\n- le Débrief hebdo rédigé par le coach IA ;\n- les analyses avancées (par setup, par heure, drawdown détaillé) ;\n- le coach IA (insights, chat et récap du jour)."
  },
  {
    "id": "prop-firms-prises-en-charge",
    "title": "Quelles prop firms sont prises en charge ?",
    "keywords": [
      "quelles prop firms",
      "prop firm prise en charge",
      "liste des firms",
      "catalogue",
      "ma firm",
      "propfirm",
      "prop firme",
      "firme compatible",
      "regles des prop firms",
      "règles prop firm",
      "firm supportee"
    ],
    "audience": "all",
    "links": [
      "https://www.mytradingcoach.app/regles-prop-firm",
      "/accounts"
    ],
    "body": "Le catalogue contient aujourd'hui : {{PROP_FIRM_LIST}}.\nLes règles de chaque plan sont relevées sur les pages officielles des firms, puis datées. Demande-moi une firm ou un plan précis : je te donne la valeur du catalogue avec sa source.\nLa synchro fonctionne avec les comptes des prop firms qui tournent sur Tradovate. Ta firm manque ? Signale-la avec « Ma firm n'est pas dans la liste »."
  },
  {
    "id": "regles-officielles",
    "title": "Les règles affichées remplacent-elles celles de ma prop firm ?",
    "keywords": [
      "regles officielles",
      "règles officielles",
      "fait foi",
      "calcul indicatif",
      "ecart avec ma firm",
      "écart",
      "chiffre different",
      "chiffre faux",
      "drawdown faux",
      "source des regles",
      "date de releve"
    ],
    "audience": "all",
    "links": [
      "https://www.mytradingcoach.app/regles-prop-firm"
    ],
    "body": "Non. Les règles du catalogue sont relevées à la source et datées, mais le calcul de l'app reste indicatif.\nSeules les règles officielles de ta firm et sa plateforme font foi. En cas d'écart, fie-toi à ta firm et signale-le à support@mytradingcoach.app."
  },
  {
    "id": "relier-plan-prop-firm",
    "title": "Comment relier mon compte à son plan prop firm ?",
    "keywords": [
      "relier plan",
      "plan prop firm",
      "choisir ma firme",
      "regles prop firm",
      "règles de ma firm",
      "perte max du jour",
      "plancher",
      "drawdown",
      "objectif",
      "evaluation",
      "évaluation",
      "compte finance",
      "compte financé",
      "propfirm"
    ],
    "audience": "app",
    "links": [
      "/accounts"
    ],
    "body": "Dans [Mes comptes](/accounts), un compte sans plan affiche « Relie ce compte à son plan… » avec un bouton « Relier ».\nChoisis ta prop firm, puis le plan que tu as acheté. L'app suit alors ta perte max du jour, ton plancher et ton objectif.\nTa firm n'est pas dans la liste ? Choisis « Ma firm n'est pas dans la liste » et donne son nom : ça nous aide à savoir quelle firm ajouter. Pour un compte perso, choisis « Compte perso (pas une prop firm) »."
  },
  {
    "id": "remboursement",
    "title": "Puis-je être remboursé ?",
    "keywords": [
      "remboursement",
      "rembourser",
      "satisfait ou rembourse",
      "satisfait ou remboursé",
      "retractation",
      "rétractation",
      "refund",
      "argent rendu",
      "annuler paiement",
      "remboursé"
    ],
    "audience": "all",
    "links": [
      "/profil?tab=params",
      "https://www.mytradingcoach.app/cgu"
    ],
    "body": "Avec l'offre fondateur, tu es satisfait ou remboursé pendant {{FOUNDER_REFUND_DAYS}} jours après le premier paiement réellement prélevé. Demande-le avec le lien « Satisfait ou remboursé : demander le remboursement » dans Profil > Paramètres > Abonnement. Tu es remboursé en entier, l'abonnement est annulé et tu perds le tarif fondateur.\nPour les autres abonnements, les [CGU](https://www.mytradingcoach.app/cgu) prévoient le droit de rétractation. Pour toute demande, écris à support@mytradingcoach.app."
  },
  {
    "id": "resilier",
    "title": "Comment résilier mon abonnement ?",
    "keywords": [
      "resilier",
      "résilier",
      "annuler abonnement",
      "arreter premium",
      "arrêter",
      "desabonner",
      "désabonner",
      "stopper abonnement",
      "annuler essai",
      "gerer mon abonnement",
      "résiliation",
      "resiliation"
    ],
    "audience": "all",
    "links": [
      "/profil?tab=params"
    ],
    "body": "Va dans [Profil > Paramètres](/profil?tab=params), bloc « Abonnement », puis « Gérer mon abonnement » (ou « Gérer / annuler mon essai ») : la résiliation se fait dans l'espace de facturation.\nTu gardes Premium jusqu'à la fin de la période déjà payée, puis tu repasses en gratuit, sans nouveau prélèvement. Fondateur ou code partenaire : résilier met fin à ton tarif, et tu ne pourras pas le récupérer.\nPendant ton Premium offert à l'inscription, il n'y a rien à résilier."
  },
  {
    "id": "seance-du-jour",
    "title": "Comment fonctionne la séance (pré-session, live, débrief) ?",
    "keywords": [
      "seance",
      "séance",
      "session du jour",
      "pre-session",
      "pré-session",
      "preparation",
      "session live",
      "en direct",
      "debrief",
      "débrief",
      "trade rapide",
      "marge avant le plancher",
      "compagnon"
    ],
    "audience": "app",
    "links": [
      "/session",
      "/sessions"
    ],
    "body": "Tout se passe dans [Session du jour](/session), en trois onglets :\n- « Pré-session » : tu prépares ta séance et tu choisis ton compte.\n- « Session live » : tu suis ta séance en direct (marge avant le plancher, objectif) et tu peux noter un trade avec « Trade rapide ».\n- « Débrief » : tu fais le point juste après.\n\nLes trois sont inclus en gratuit. Tes séances passées sont dans [Historique des sessions](/sessions)."
  },
  {
    "id": "statistiques",
    "title": "Qu'est-ce que je vois dans les statistiques en gratuit ?",
    "keywords": [
      "statistiques",
      "stats",
      "analytics",
      "win rate",
      "winrate",
      "p&l",
      "courbe d'equite",
      "équité",
      "drawdown",
      "par setup",
      "par heure",
      "analyses avancees",
      "avancées"
    ],
    "audience": "app",
    "links": [
      "/analytics",
      "/dashboard"
    ],
    "body": "En gratuit, [Statistiques](/analytics) et le tableau de bord te montrent tes chiffres : win rate, P&L, courbe d'équité simple, P&L par jour, répartition de tes setups et de tes émotions.\nPremium ajoute la profondeur d'analyse : résultats par setup et par heure, drawdown détaillé, filtres croisés.\nLa vue de tes propres données n'est jamais verrouillée."
  },
  {
    "id": "supprimer-compte",
    "title": "Comment supprimer mon compte ?",
    "keywords": [
      "supprimer compte",
      "supprimer mon compte",
      "effacer compte",
      "fermer compte",
      "desinscription",
      "désinscription",
      "suppression",
      "effacer mes donnees",
      "quitter",
      "delete account"
    ],
    "audience": "all",
    "links": [
      "/profil?tab=params",
      "https://www.mytradingcoach.app/politique-confidentialite"
    ],
    "body": "Va dans [Profil > Paramètres](/profil?tab=params), « Zone de danger » > « Supprimer mon compte », puis tape SUPPRIMER pour confirmer.\nC'est définitif : ton compte, tes trades et tes débriefs sont supprimés, et un abonnement en cours est résilié immédiatement.\nCe qui reste ensuite (trace anonymisée, facturation, sauvegardes) est détaillé dans la [politique de confidentialité](https://www.mytradingcoach.app/politique-confidentialite). Tu veux seulement arrêter ton abonnement ? Passe plutôt par « Gérer mon abonnement »."
  },
  {
    "id": "tradovate-a-reconnecter",
    "title": "Ma connexion Tradovate affiche « À reconnecter » ou une erreur, que faire ?",
    "keywords": [
      "a reconnecter",
      "à reconnecter",
      "reconnecter",
      "synchro en erreur",
      "erreur synchro",
      "connexion expiree",
      "connexion expirée",
      "revoquee",
      "tradovate ne marche plus",
      "plus de trades",
      "bug synchro",
      "tradovate deconnecte"
    ],
    "audience": "app",
    "links": [
      "/accounts"
    ],
    "body": "« À reconnecter » veut dire que la connexion a expiré ou a été révoquée. Clique sur « Reconnecter » dans [Mes comptes](/accounts) et autorise à nouveau MyTradingCoach chez Tradovate.\nSi le compte a disparu chez Tradovate, la connexion reste active : il te suffit de rechoisir le compte à synchroniser au même endroit.\nSi l'erreur reste affichée, écris à support@mytradingcoach.app."
  },
  {
    "id": "tradovate-deconnecter",
    "title": "Comment déconnecter Tradovate, et est-ce que je perds mes trades ?",
    "keywords": [
      "deconnecter tradovate",
      "déconnecter tradovate",
      "revoquer acces",
      "révoquer",
      "couper la synchro",
      "arreter synchro",
      "supprimer connexion",
      "garder mes trades",
      "perdre mes trades",
      "delier tradovate"
    ],
    "audience": "app",
    "links": [
      "/accounts"
    ],
    "body": "Dans [Mes comptes](/accounts), clique sur « Déconnecter » sur la ligne du compte. La synchro s'arrête.\nTes trades déjà importés restent, sauf si tu choisis de les supprimer. L'app t'affiche d'abord combien de trades viennent de ce compte Tradovate.\nLes jetons de connexion sont effacés quand tu déconnectes."
  }
];

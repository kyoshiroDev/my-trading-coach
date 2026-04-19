# CONFORMITÉ JURIDIQUE — MyTradingCoach
# Audit + Documents légaux — Avril 2026
# ⚠️ BASE À VALIDER PAR UN JURISTE AVANT MISE EN PRODUCTION

---

## PARTIE 1 — AUDIT : PHRASES À RISQUE IDENTIFIÉES

### 🔴 Phrases à supprimer ou réécrire immédiatement

| Phrase actuelle | Risque | Remplacement |
|---|---|---|
| "résumé de tes performances" | Lié à la performance financière | "résumé de ton activité de trading" |
| "P&L Total +$8,420 ▲ +12.3% ce mois" | Affiche des gains → conseil implicite | Garder les chiffres mais ajouter "à titre illustratif uniquement" |
| "Win Rate 67.4%" | Suggère un succès reproductible | "Taux de trades enregistrés gagnants" |
| "série gagnante" | Notion de gain | "série positive" |
| "performances dégradées" | Corrélation comportement → résultat financier | "activité enregistrée moins favorable" |
| "Prévenir l'overtrading post-gain" | Conseil implicite | "Observer les patterns post-trade positif" |
| "résultats" (émotions corrélées) | Corrélation directe | "données enregistrées" |
| "Pas des conseils génériques de YouTube" | Utilise le mot "conseils" → confusion | "Pas des analyses génériques" |
| "Heatmap de performance horaire" | Performance = financière | "Heatmap d'activité horaire" |
| "Streak +7 série gagnante" | Notion de gain | "Streak +7 trades positifs enregistrés" |

### 🟡 Phrases à surveiller (contexte à clarifier)

```
"améliorer trading"         → OK si lié à la discipline, pas aux gains
"coach trading IA"          → OK si clairement "comportemental"
"prop trader professionnel" → OK si usage illustratif
"Win rate trop faible"      → Ajouter "selon tes propres données enregistrées"
```

---

## PARTIE 2 — DISCLAIMER (À INTÉGRER EN PRODUCTION)

### Bandeau sticky (haut de page)

```html
<div style="background:#1a1a2e;border-bottom:1px solid #f59e0b;padding:8px 20px;text-align:center;font-size:12px;color:#f59e0b;position:sticky;top:0;z-index:9999;">
  ⚠️ MyTradingCoach est un outil de journal et d'analyse comportementale. 
  Il ne fournit aucun conseil en investissement. 
  Le trading comporte un risque élevé de perte en capital.
  <a href="/disclaimer" style="color:#f59e0b;text-decoration:underline;margin-left:8px">En savoir plus →</a>
</div>
```

### Disclaimer complet (page /disclaimer ou section dédiée)

```
AVERTISSEMENT IMPORTANT — À LIRE AVANT TOUTE UTILISATION

MyTradingCoach est une application de journal de trading et d'analyse 
comportementale destinée exclusivement à des fins d'auto-documentation 
et d'amélioration de la discipline personnelle.

1. ABSENCE DE CONSEIL EN INVESTISSEMENT
MyTradingCoach n'est pas un conseiller en investissement financier (CIF), 
ne dispose d'aucun agrément AMF, et n'est soumis à aucune réglementation 
financière au titre de la directive MiFID II ou de toute autre 
réglementation équivalente.

Les analyses, insights et rapports générés par l'intelligence artificielle 
de MyTradingCoach sont basés exclusivement sur les données que vous avez 
vous-même enregistrées. Ils ne constituent en aucun cas :
- Des conseils en investissement
- Des recommandations d'achat ou de vente de valeurs mobilières
- Des analyses financières au sens réglementaire
- Des prévisions de performance future

2. RISQUE DE PERTE EN CAPITAL
Le trading sur les marchés financiers (actions, forex, crypto-actifs, 
matières premières, CFD, etc.) comporte un risque élevé de perte totale 
du capital investi. Les performances passées ne préjugent pas des 
performances futures. Vous pouvez perdre tout ou partie du capital investi.

3. USAGE ÉDUCATIF ET COMPORTEMENTAL UNIQUEMENT
MyTradingCoach est un outil de productivité personnelle permettant de :
- Journaliser vos propres activités de trading
- Analyser vos comportements et patterns personnels
- Améliorer votre discipline et votre gestion émotionnelle
- Visualiser vos propres données historiques

Il ne remplace en aucun cas l'avis d'un professionnel agréé.

4. RESPONSABILITÉ UTILISATEUR
L'utilisateur est seul responsable de ses décisions de trading et 
d'investissement. MyTradingCoach SAS ne saurait être tenue responsable 
des pertes financières résultant d'une utilisation de l'application, 
directement ou indirectement.

5. CRYPTO-ACTIFS
Les crypto-actifs ne sont pas des instruments financiers au sens de la 
directive MiFID II. Leur acquisition et leur détention comportent des 
risques spécifiques non couverts par les mécanismes de protection des 
investisseurs.

Dernière mise à jour : Avril 2026
```

---

## PARTIE 3 — MENTIONS LÉGALES

```
MENTIONS LÉGALES

Conformément aux dispositions de la loi n°2004-575 du 21 juin 2004 
pour la Confiance en l'Économie Numérique, il est porté à la connaissance 
des utilisateurs du site mytradingcoach.app les présentes mentions légales.

1. ÉDITEUR DU SITE
Grégory Tahir
Entrepreneur individuel
Exerçant sous le nom commercial : My Trading Coach
SIRET : 512 926 460 00027
Code NAF : 6201Z — Programmation informatique
Siège social : 26 rue des Tiphoines, 91240 Saint-Michel-sur-Orge
Email : hello@mytradingcoach.app
Non assujetti à la TVA — Art. 293B du CGI
Directeur de la publication : Grégory Tahir

2. HÉBERGEUR
Nom : OVH SAS
Adresse : 2 rue Kellermann, 59100 Roubaix, France
Téléphone : +33 9 72 10 10 07
Site : www.ovhcloud.com

Frontend / Landing :
Nom : Vercel Inc.
Adresse : 340 Pine Street, Suite 701, San Francisco, CA 94104, USA
Site : www.vercel.com

3. PROPRIÉTÉ INTELLECTUELLE
L'ensemble du contenu du site mytradingcoach.app (textes, images, 
graphiques, logo, icônes, sons, logiciels) est la propriété exclusive 
de Grégory Tahir (My Trading Coach) ou de ses partenaires. Toute reproduction, distribution, 
modification, adaptation, retransmission ou publication de ces éléments 
est strictement interdite sans l'accord exprès de Grégory Tahir (My Trading Coach).

4. LIMITATION DE RESPONSABILITÉ
Grégory Tahir (My Trading Coach) ne saurait être tenu responsable des dommages directs ou 
indirects causés au matériel de l'utilisateur lors de l'accès au site 
mytradingcoach.app, résultant notamment de l'utilisation d'un matériel 
non adapté, de bugs ou d'incompatibilités.

5. AVERTISSEMENT FINANCIER
MyTradingCoach n'est pas un prestataire de services d'investissement 
(PSI) au sens de la directive MiFID II. L'application ne fournit pas 
de conseil en investissement, d'analyse financière, ni de gestion de 
portefeuille. Voir notre Disclaimer complet sur /disclaimer.

6. DROIT APPLICABLE ET JURIDICTION
Les présentes mentions légales sont soumises au droit français. 
En cas de litige, les tribunaux français seront seuls compétents.

Dernière mise à jour : Avril 2026
```

---

## PARTIE 4 — POLITIQUE DE CONFIDENTIALITÉ (RGPD)

```
POLITIQUE DE CONFIDENTIALITÉ

Dernière mise à jour : Avril 2026
Responsable du traitement : Grégory Tahir (My Trading Coach) — hello@mytradingcoach.app

1. DONNÉES COLLECTÉES

a) Données de compte
- Prénom, nom
- Adresse email
- Mot de passe (hashé bcrypt, jamais stocké en clair)
- Date d'inscription

b) Données de trading (saisies par l'utilisateur)
- Actifs tradés (BTC/USDT, EUR/USD, etc.)
- Prix d'entrée et de sortie
- Stop loss, take profit
- P&L (résultat déclaré par l'utilisateur)
- État émotionnel au moment du trade
- Notes et observations personnelles
- Session de trading, setup utilisé

c) Données comportementales (générées par l'application)
- Patterns identifiés dans vos propres données
- Scores et métriques calculés à partir de vos saisies
- Rapports hebdomadaires générés par l'IA

d) Données techniques
- Adresse IP (anonymisée après 30 jours)
- Type de navigateur et système d'exploitation
- Pages visitées et durée de visite
- Cookies de session et d'authentification

e) Données de facturation
- Historique des abonnements via Stripe
- Statut d'abonnement
- Aucune donnée de carte bancaire (gérée exclusivement par Stripe PCI-DSS)

2. FINALITÉS ET BASES LÉGALES

| Finalité | Base légale |
|---|---|
| Fourniture du service | Exécution du contrat (Art. 6.1.b RGPD) |
| Génération des analyses IA | Exécution du contrat (Art. 6.1.b RGPD) |
| Facturation et abonnement | Obligation légale (Art. 6.1.c RGPD) |
| Amélioration du service | Intérêt légitime (Art. 6.1.f RGPD) |
| Communications marketing | Consentement (Art. 6.1.a RGPD) |
| Sécurité et prévention fraude | Intérêt légitime (Art. 6.1.f RGPD) |

3. DURÉE DE CONSERVATION

| Données | Durée |
|---|---|
| Compte et trades | Durée de l'abonnement + 3 ans |
| Données de facturation | 10 ans (obligation comptable) |
| Logs techniques | 12 mois |
| IP anonymisées | 30 jours |
| Données marketing | Jusqu'au retrait du consentement |

4. DESTINATAIRES DES DONNÉES

Vos données sont partagées avec :

- Anthropic (USA) : traitement IA des insights
  Base : clauses contractuelles types (CCT)
  Données transmises : trades anonymisés pour analyse

- Stripe (USA) : gestion des paiements
  Base : clauses contractuelles types (CCT)
  Données transmises : email, statut abonnement

- OVH (France) : hébergement API et base de données
  Base : sous-traitant EU — RGPD compliant

- Vercel (USA) : hébergement frontend
  Base : clauses contractuelles types (CCT)

- Resend (USA) : envoi d'emails transactionnels
  Base : clauses contractuelles types (CCT)

Aucune vente de données à des tiers.

5. VOS DROITS (Art. 15 à 22 RGPD)

Vous disposez des droits suivants :
- Droit d'accès : obtenir une copie de vos données
- Droit de rectification : corriger des données inexactes
- Droit à l'effacement : supprimer votre compte et vos données
- Droit à la portabilité : recevoir vos données en format CSV
- Droit d'opposition : vous opposer au traitement marketing
- Droit à la limitation : restreindre certains traitements

Pour exercer ces droits : hello@mytradingcoach.app
Délai de réponse : 30 jours maximum.

Vous pouvez également introduire une réclamation auprès de la CNIL :
www.cnil.fr — 3 Place de Fontenoy, 75007 Paris.

6. COOKIES

| Cookie | Type | Durée | Finalité |
|---|---|---|---|
| mtc_session | Nécessaire | Session | Authentification JWT |
| mtc_refresh | Nécessaire | 7 jours | Renouvellement token |
| _ga | Analytics | 2 ans | Google Analytics (si activé) |

Cookies nécessaires : pas de consentement requis.
Cookies analytics : consentement requis via bandeau.

7. SÉCURITÉ
- Chiffrement TLS 1.3 sur toutes les communications
- Mots de passe hashés avec bcrypt
- Tokens JWT avec expiration courte (15 minutes)
- Base de données non exposée publiquement
- Sauvegardes chiffrées quotidiennes

Dernière mise à jour : Avril 2026
```

---

## PARTIE 5 — CONDITIONS GÉNÉRALES D'UTILISATION (CGU)

```
CONDITIONS GÉNÉRALES D'UTILISATION

Dernière mise à jour : Avril 2026
Éditeur : Grégory Tahir (My Trading Coach) — hello@mytradingcoach.app

1. OBJET ET ACCEPTATION

Les présentes CGU définissent les conditions d'accès et d'utilisation 
de l'application MyTradingCoach accessible à l'adresse 
app.mytradingcoach.app.

En créant un compte, l'utilisateur accepte sans réserve les présentes CGU.

2. DESCRIPTION DU SERVICE

MyTradingCoach est une application SaaS de journal de trading et 
d'analyse comportementale. Elle permet à l'utilisateur de :
- Enregistrer manuellement ses propres trades
- Visualiser des statistiques calculées à partir de ses propres données
- Recevoir des analyses comportementales générées par intelligence artificielle
- Améliorer sa discipline et sa gestion émotionnelle

MyTradingCoach n'est PAS :
- Un conseiller en investissement financier
- Un service de gestion de portefeuille
- Un prestataire de services d'investissement (PSI)
- Un fournisseur de signaux de trading
- Un service de copy trading

3. ABSENCE DE CONSEIL FINANCIER (CLAUSE ESSENTIELLE)

L'utilisateur reconnaît expressément et irrévocablement que :

a) MyTradingCoach ne fournit aucun conseil en investissement au sens 
de la directive MiFID II (2014/65/UE) et de l'ordonnance n°2007-544 
du 12 avril 2007.

b) Les analyses générées par l'intelligence artificielle sont 
exclusivement basées sur les données saisies par l'utilisateur lui-même 
et ne constituent pas des recommandations d'investissement.

c) L'utilisateur est seul responsable de ses décisions de trading. 
Grégory Tahir (My Trading Coach) ne pourra en aucun cas être tenu responsable des pertes 
financières subies par l'utilisateur.

d) L'utilisation de MyTradingCoach comme base de décision d'investissement 
est expressément interdite et contraire à l'objet du service.

4. CRÉATION DE COMPTE ET ACCÈS

- L'utilisateur doit être majeur (18 ans minimum)
- Un compte par personne physique
- L'utilisateur est responsable de la confidentialité de ses identifiants
- Grégory Tahir (My Trading Coach) se réserve le droit de suspendre tout compte en cas 
  de violation des présentes CGU

5. PLANS ET FACTURATION

Plan Gratuit (FREE)
- Accès limité à 50 trades par mois
- Fonctionnalités de base
- Sans engagement, sans carte bancaire

Plan Premium
- 39€/mois ou 349€/an (TTC)
- Essai gratuit de 7 jours sans carte bancaire
- Facturation via Stripe — conforme PCI-DSS
- Résiliation possible à tout moment depuis les paramètres du compte

Droit de rétractation (Art. L221-18 Code de la consommation) :
L'utilisateur dispose d'un délai de 14 jours à compter de la souscription 
pour exercer son droit de rétractation, sauf si le service a été 
pleinement exécuté avant la fin du délai avec accord préalable.

6. DONNÉES UTILISATEUR

L'utilisateur conserve la propriété de toutes les données qu'il saisit 
dans MyTradingCoach. Il peut à tout moment :
- Exporter ses données au format CSV
- Supprimer son compte et toutes ses données

Grégory Tahir (My Trading Coach) ne vend pas les données utilisateur à des tiers.
Voir la Politique de Confidentialité pour le détail des traitements.

7. PROPRIÉTÉ INTELLECTUELLE

Le code source, le design, les algorithmes d'analyse comportementale 
et tous les éléments constitutifs de MyTradingCoach sont la propriété 
exclusive de Grégory Tahir (My Trading Coach) et sont protégés par le droit d'auteur.

L'utilisateur dispose d'un droit d'usage personnel, non exclusif et 
non transférable de l'application.

8. LIMITATIONS DE RESPONSABILITÉ

Grégory Tahir (My Trading Coach) ne saurait être tenu responsable :
- Des pertes financières liées à l'utilisation du service
- Des interruptions temporaires du service pour maintenance
- Des pertes de données dues à des cas de force majeure
- D'une utilisation du service contraire aux présentes CGU

La responsabilité de Grégory Tahir (My Trading Coach) est limitée au montant des sommes 
effectivement versées par l'utilisateur au cours des 12 derniers mois.

9. MODIFICATION DES CGU

Grégory Tahir (My Trading Coach) se réserve le droit de modifier les présentes CGU. 
L'utilisateur sera informé par email 30 jours avant toute modification 
substantielle. La poursuite de l'utilisation du service vaut acceptation 
des nouvelles CGU.

10. RÉSILIATION

L'utilisateur peut résilier son compte à tout moment depuis 
Paramètres → Gérer mon abonnement.

Grégory Tahir (My Trading Coach) peut suspendre ou résilier un compte en cas de :
- Violation des présentes CGU
- Non-paiement
- Usage frauduleux ou abusif du service

11. DROIT APPLICABLE ET LITIGES

Les présentes CGU sont soumises au droit français.

En cas de litige, l'utilisateur peut recourir gratuitement à un 
médiateur de la consommation (Art. L612-1 Code de la consommation) :
La Médiation du Numérique
www.mediateur-du-numerique.fr
Formulaire en ligne : https://www.mediateur-du-numerique.fr/saisir-le-mediateur

À défaut de résolution amiable, les tribunaux de Saint-Michel-sur-Orge seront 
seuls compétents.

Dernière mise à jour : Avril 2026
```

---

## PARTIE 6 — RÉÉCRITURE COPYWRITING SAFE

### Phrases à remplacer sur la landing

```
AVANT → APRÈS

"résumé de tes performances"
→ "résumé de ton activité de trading"

"Heatmap de performance horaire"
→ "Heatmap d'activité par heure"

"série gagnante"
→ "série de trades positifs enregistrés"

"performances dégradées"  
→ "activité enregistrée différente selon les créneaux"

"tes résultats"
→ "tes données enregistrées"

"Pas des conseils génériques de YouTube"
→ "Pas des analyses génériques — basé sur tes propres données"

"améliorer ton trading"
→ "mieux comprendre tes comportements de trading"

"coach trading IA"
→ "assistant comportemental IA pour traders"

"Win Rate 67.4%"
→ "67.4% de trades enregistrés comme positifs"

"P&L Total +$8,420"
→ Garder avec mention "données illustratives — résultats non garantis"
```

### Hero section réécrite (safe)

```
AVANT :
"Journal de Trading IA & Coach"
"Identifiez vos patterns émotionnels, recevez un debrief hebdomadaire"

APRÈS :
"Le journal de trading qui analyse votre comportement, pas vos marchés"
"Enregistrez vos trades. Comprenez vos patterns émotionnels. 
Améliorez votre discipline — semaine après semaine."

Sous-titre safe :
"MyTradingCoach est un outil d'analyse comportementale pour traders. 
Il ne fournit aucun conseil financier."
```

### Footer obligatoire

```html
<footer>
  <!-- ... contenu footer ... -->
  
  <div class="disclaimer-footer">
    <p>
      ⚠️ <strong>Avertissement</strong> : MyTradingCoach est un outil 
      de journal et d'analyse comportementale pour traders. 
      Il ne constitue pas un conseil en investissement et ne remplace 
      pas l'avis d'un professionnel agréé. 
      Le trading comporte un risque élevé de perte en capital. 
      Les performances passées ne préjugent pas des performances futures.
    </p>
    <nav>
      <a href="/mentions-legales">Mentions légales</a>
      <a href="/politique-confidentialite">Politique de confidentialité</a>
      <a href="/cgu">CGU</a>
      <a href="/disclaimer">Avertissement financier</a>
      <a href="/cookies">Cookies</a>
    </nav>
  </div>
</footer>
```

---

## PARTIE 7 — CHECKLIST CONFORMITÉ

```
OBLIGATOIRE AVANT LANCEMENT

Juridique
[ ] Créer entité légale (SAS ou auto-entrepreneur) avec SIRET
[ ] Remplir tous les [CHAMPS] dans les documents ci-dessus
[ ] Faire valider par un avocat spécialisé fintech/RGPD
[ ] Nommer un DPO (ou contact RGPD) si > 250 salariés (non obligatoire ici)

Pages à créer sur la landing (Astro)
[ ] /mentions-legales
[ ] /politique-confidentialite  
[ ] /cgu
[ ] /disclaimer
[ ] /cookies

Éléments visuels
[ ] Bandeau disclaimer sticky en haut de page
[ ] Footer avec liens légaux
[ ] Bandeau cookies (si Google Analytics actif)
[ ] Mention "à titre illustratif" sous les captures d'écran

Wording
[ ] Remplacer toutes les phrases à risque (tableau PARTIE 1)
[ ] Vérifier les meta descriptions (pas de promesse de gain)
[ ] Vérifier le schema.org JSON-LD
```

---

## NOTE IMPORTANTE

Ce document est une base de travail rédigée par une IA.
Il ne constitue pas un avis juridique professionnel.

Avant mise en production, faire valider par :
- Un avocat spécialisé en droit du numérique / fintech
- Contacter la CNIL pour validation RGPD si nécessaire
- Vérifier la conformité AMF si le service évolue

Contact AMF pour information : amf-france.org
Contact CNIL : cnil.fr

---

*Audit réalisé — Avril 2026*
*MyTradingCoach — Conformité RGPD / AMF / MiFID II*

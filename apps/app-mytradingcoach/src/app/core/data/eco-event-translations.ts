// Traductions FR — noms exacts issus de l'API FMP
// Format FMP : "CPI MoM", "GDP Growth Rate QoQ", "Unemployment Rate" (sans suffixe de période)
// Le suffixe "(Apr)", "(May/23)", "(Q1)"... est retiré avant la recherche
export const ECO_EVENT_TRANSLATIONS: Record<string, string> = {

  // ── Inflation / Prix ─────────────────────────────────────────────────────
  'CPI MoM': 'IPC mensuel (inflation)',
  'CPI YoY': 'IPC annuel (inflation)',
  'Core CPI MoM': 'IPC core mensuel',
  'Core CPI YoY': 'IPC core annuel',
  'HICP MoM': 'IPCH mensuel',
  'HICP YoY': 'IPCH annuel',
  'Inflation Rate MoM': "Taux d'inflation mensuel",
  'Inflation Rate YoY': "Taux d'inflation annuel",
  'PPI MoM': 'IPP mensuel',
  'PPI YoY': 'IPP annuel',
  'Core PPI MoM': 'IPP core mensuel',
  'PCE Price Index MoM': 'PCE mensuel',
  'PCE Price Index YoY': 'PCE annuel',
  'Core PCE Price Index MoM': 'PCE core mensuel',
  'Core PCE Price Index YoY': 'PCE core annuel',

  // ── PIB / Croissance ──────────────────────────────────────────────────────
  'GDP Growth Rate QoQ': 'PIB trimestriel',
  'GDP Growth Rate YoY': 'PIB annuel',
  'GDP Growth Annualized': 'PIB annualisé',
  'Gross Domestic Product QoQ': 'PIB trimestriel',
  'Gross Domestic Product MoM': 'PIB mensuel',
  'Gross Domestic Product YoY': 'PIB annuel',
  'GDP Price Index QoQ': 'Déflateur PIB',
  'Corporate Profits QoQ': 'Profits entreprises trimestriel',
  'Atlanta Fed GDPNow': 'Atlanta Fed GDPNow',

  // ── Emploi ────────────────────────────────────────────────────────────────
  'Unemployment Rate': 'Taux de chômage',
  'Unemployed Persons': "Demandeurs d'emploi",
  'Unemployment Benefit Claims': 'Allocations chômage',
  'Initial Jobless Claims': 'Inscriptions chômage (initial)',
  'Continuing Jobless Claims': 'Inscriptions chômage (récurrent)',
  'Employment Change': 'Variation emploi',
  'Employment Level': 'Niveau emploi',
  'Claimant Count Change': 'Demandeurs emploi (RU)',
  'Non-Farm Payrolls': 'NFP — Emplois non-agricoles',
  'Nonfarm Payrolls': 'NFP — Emplois non-agricoles',
  'ADP Non-Farm Employment Change': 'ADP emplois privés',
  'ADP Employment Change': 'ADP emplois privés',

  // ── Banques centrales ─────────────────────────────────────────────────────
  'Interest Rate Decision': 'Décision taux directeur',
  'Federal Funds Rate': 'Taux Fed',
  'FOMC Statement': 'Communiqué FOMC',
  'FOMC Meeting Minutes': 'Minutes FOMC',
  'Fed Chair Powell Speech': 'Discours Powell (Fed)',
  'Fed Chair Speech': 'Discours Président Fed',
  'Fed Bowman Speech': 'Discours Bowman (Fed)',
  'Fed Jefferson Speech': 'Discours Jefferson (Fed)',
  'Fed Kashkari Speech': 'Discours Kashkari (Fed)',
  'Fed Williams Speech': 'Discours Williams (Fed)',
  'Fed Waller Speech': 'Discours Waller (Fed)',
  'Fed Daly Speech': 'Discours Daly (Fed)',
  'Fed Kugler Speech': 'Discours Kugler (Fed)',
  'ECB Main Refinancing Rate': 'Taux BCE',
  'ECB Interest Rate Decision': 'Décision taux BCE',
  'ECB Monetary Policy Statement': 'Décision BCE',
  'ECB Press Conference': 'Conférence BCE',
  'ECB President Lagarde Speech': 'Discours Lagarde (BCE)',
  'ECB Lagarde Speech': 'Discours Lagarde (BCE)',
  'ECB Monetary Policy Meeting Accounts': 'Compte-rendu réunion BCE',
  'BOE Official Bank Rate': 'Taux BoE',
  'BoE Gov Bailey Speech': 'Discours Bailey (BoE)',
  'BOE Monetary Policy Summary': 'Décision BoE',
  'MPC Official Bank Rate Votes': 'Vote taux BoE',
  'BoC Press Conference': 'Conférence presse BoC',
  'BOC Rate Statement': 'Taux BoC (Canada)',
  'Overnight Rate': 'Taux directeur Canada',
  'BOJ Policy Rate': 'Taux BoJ',
  'BOJ Monetary Policy Statement': 'Décision BoJ',
  'BOJ Press Conference': 'Conférence BoJ',
  'RBA Cash Rate Target': 'Taux RBA (Australie)',
  'RBA Rate Statement': 'Décision RBA',
  'RBA Bulletin': 'Bulletin RBA',
  'SNB Policy Rate': 'Taux BNS (Suisse)',
  'Financial Stability Report': 'Rapport stabilité financière',

  // ── Commerce / Balance ────────────────────────────────────────────────────
  'Balance of Trade': 'Balance commerciale',
  'Current Account': 'Balance courante',
  'Goods Trade Balance': 'Balance commerciale biens',
  'Goods Trade Balance Adv': 'Balance commerciale biens (estimé)',
  'Trade Balance': 'Balance commerciale',

  // ── Confiance / Sentiment ─────────────────────────────────────────────────
  'Consumer Confidence': 'Confiance consommateurs',
  'CB Consumer Confidence': 'Confiance consommateurs (CB)',
  'Michigan Consumer Sentiment': 'Sentiment Michigan',
  'Business Confidence': 'Confiance des entreprises',
  'ANZ Business Confidence': 'Confiance entreprises ANZ',
  'Economic Sentiment': 'Sentiment économique',
  'KOF Leading Indicators': 'Indicateurs avancés KOF',
  'ZEW Economic Sentiment': 'ZEW sentiment économique',

  // ── PMI / Industrie ───────────────────────────────────────────────────────
  'ISM Manufacturing PMI': 'PMI manufacturier ISM',
  'ISM Services PMI': 'PMI services ISM',
  'Chicago PMI': 'PMI Chicago',
  'Flash Manufacturing PMI': 'PMI manufacturier flash',
  'Flash Services PMI': 'PMI services flash',
  'Caixin Manufacturing PMI': 'PMI manufacturier Caixin',
  'NBS Manufacturing PMI': 'PMI manufacturier NBS',
  'Industrial Production MoM': 'Production industrielle mensuelle',
  'Industrial Production YoY': 'Production industrielle annuelle',
  'Capacity Utilization Rate': 'Utilisation des capacités',

  // ── Immobilier ────────────────────────────────────────────────────────────
  'Housing Starts MoM': 'Mises en chantier mensuel',
  'Housing Starts YoY': 'Mises en chantier annuel',
  'Building Permits MoM': 'Permis de construire mensuel',
  'New Home Sales': 'Ventes logements neufs',
  'Existing Home Sales': 'Ventes immobilier existant',
  'Nationwide Housing Prices MoM': 'Prix immobilier Nationwide mensuel',
  'Nationwide Housing Prices YoY': 'Prix immobilier Nationwide annuel',

  // ── Consommation / Revenus ────────────────────────────────────────────────
  'Retail Sales MoM': 'Ventes au détail mensuel',
  'Retail Sales YoY': 'Ventes au détail annuel',
  'Retail Sales Ex Autos MoM': 'Ventes au détail hors autos',
  'Retail Inventories Ex Autos MoM': 'Stocks détail hors autos',
  'Wholesale Inventories MoM': 'Stocks grossistes mensuel',
  'Personal Income MoM': 'Revenus personnels mensuel',
  'Personal Spending MoM': 'Dépenses personnelles mensuel',
  'Consumer Spending MoM': 'Consommation mensuelle',
  'Durable Goods Orders MoM': 'Commandes biens durables mensuel',
  'Durable Goods Orders Ex Transp MoM': 'Commandes biens durables hors transport',

  // ── Énergie (EIA) ─────────────────────────────────────────────────────────
  'EIA Crude Oil Stocks Change': 'Stocks pétrole brut (EIA)',
  'EIA Gasoline Stocks Change': "Stocks essence (EIA)",
  'EIA Natural Gas Stocks Change': 'Stocks gaz naturel (EIA)',

  // ── Divers ────────────────────────────────────────────────────────────────
  'Annual Budget Release': 'Budget annuel',
  'Empire State Manufacturing Index': 'Indice Empire State',
  'Philly Fed Manufacturing Index': 'Indice Fed Philadelphie',
};

export function translateEcoEvent(name: string): string {
  // 1. Correspondance exacte
  if (ECO_EVENT_TRANSLATIONS[name]) return ECO_EVENT_TRANSLATIONS[name];

  // 2. Retirer le suffixe de période : "(Apr)", "(May/23)", "(Q1 2026)"...
  const withoutPeriod = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (withoutPeriod !== name && ECO_EVENT_TRANSLATIONS[withoutPeriod]) {
    return ECO_EVENT_TRANSLATIONS[withoutPeriod];
  }

  // 3. Correspondance partielle (startsWith) — couvre les variantes mineures
  const lower = withoutPeriod.toLowerCase();
  for (const [en, fr] of Object.entries(ECO_EVENT_TRANSLATIONS)) {
    if (lower.startsWith(en.toLowerCase())) return fr;
  }
  // Fallback sur le nom original
  const lowerFull = name.toLowerCase();
  for (const [en, fr] of Object.entries(ECO_EVENT_TRANSLATIONS)) {
    if (lowerFull.startsWith(en.toLowerCase())) return fr;
  }

  return name;
}

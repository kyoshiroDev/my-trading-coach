export const ECO_EVENT_TRANSLATIONS: Record<string, string> = {
  // ── États-Unis ──────────────────────────────────────────────────────────
  'Non-Farm Payrolls': 'NFP — Emplois non-agricoles',
  'Unemployment Rate': 'Taux de chômage',
  'CPI m/m': 'IPC mensuel (inflation)',
  'CPI y/y': 'IPC annuel (inflation)',
  'Core CPI m/m': 'IPC core mensuel',
  'Core CPI y/y': 'IPC core annuel',
  'PPI m/m': 'IPP mensuel',
  'PPI y/y': 'IPP annuel',
  'Core PPI m/m': 'IPP core mensuel',
  'GDP q/q': 'PIB trimestriel',
  'Prelim GDP q/q': 'PIB préliminaire',
  'Final GDP q/q': 'PIB final',
  'Retail Sales m/m': 'Ventes au détail',
  'Core Retail Sales m/m': 'Ventes au détail core',
  'ISM Manufacturing PMI': 'PMI manufacturier ISM',
  'ISM Services PMI': 'PMI services ISM',
  'FOMC Meeting Minutes': 'Minutes FOMC',
  'FOMC Statement': 'Communiqué FOMC',
  'Federal Funds Rate': 'Taux Fed',
  'Fed Chair Powell Speech': 'Discours Powell (Fed)',
  'Fed Chair Speech': 'Discours Président Fed',
  'ADP Non-Farm Employment Change': 'ADP emplois privés',
  'Jobless Claims': 'Inscriptions chômage',
  'Initial Jobless Claims': 'Inscriptions chômage (initial)',
  'Continuing Jobless Claims': 'Inscriptions chômage (récurrent)',
  'Consumer Confidence': 'Confiance consommateurs',
  'CB Consumer Confidence': 'Confiance consommateurs (CB)',
  'Michigan Consumer Sentiment': 'Sentiment Michigan',
  'Housing Starts': 'Mises en chantier',
  'Housing Starts m/m': 'Mises en chantier',
  'Building Permits': 'Permis de construire',
  'Existing Home Sales': 'Ventes immobilier existant',
  'New Home Sales': 'Ventes logements neufs',
  'Durable Goods Orders m/m': 'Commandes biens durables',
  'Core Durable Goods Orders m/m': 'Commandes biens durables core',
  'Trade Balance': 'Balance commerciale',
  'Current Account': 'Balance courante',
  'Industrial Production m/m': 'Production industrielle',
  'Capacity Utilization Rate': 'Utilisation des capacités',
  'Empire State Manufacturing Index': 'Indice Empire State',
  'Philly Fed Manufacturing Index': 'Indice Fed Philadelphie',
  'Chicago PMI': 'PMI Chicago',
  'Flash Manufacturing PMI': 'PMI manufacturier flash',
  'Flash Services PMI': 'PMI services flash',

  // ── Zone Euro / BCE ─────────────────────────────────────────────────────
  'ECB Main Refinancing Rate': 'Taux BCE',
  'ECB Monetary Policy Statement': 'Décision BCE',
  'ECB Press Conference': 'Conférence BCE',
  'ECB President Lagarde Speech': 'Discours Lagarde (BCE)',
  'ECB Lagarde Speech': 'Discours Lagarde (BCE)',
  'German CPI m/m': 'IPC Allemagne',
  'German CPI y/y': 'IPC Allemagne annuel',
  'German GDP q/q': 'PIB Allemagne',
  'German Ifo Business Climate': 'IFO climat des affaires',
  'German ZEW Economic Sentiment': 'ZEW sentiment économique',
  'French CPI m/m': 'IPC France',
  'Flash CPI y/y': 'IPC flash annuel',
  'Core Flash CPI y/y': 'IPC core flash',
  'Eurozone GDP q/q': 'PIB Zone Euro',

  // ── Royaume-Uni ─────────────────────────────────────────────────────────
  'BOE Official Bank Rate': 'Taux BoE',
  'MPC Official Bank Rate Votes': 'Vote taux BoE',
  'BOE Monetary Policy Summary': 'Décision BoE',
  'UK CPI y/y': 'IPC Royaume-Uni',
  'UK GDP m/m': 'PIB Royaume-Uni',
  'Claimant Count Change': 'Demandeurs emploi (RU)',

  // ── Japon ───────────────────────────────────────────────────────────────
  'BOJ Policy Rate': 'Taux BoJ',
  'BOJ Monetary Policy Statement': 'Décision BoJ',
  'BOJ Press Conference': 'Conférence BoJ',
  'Japanese CPI y/y': 'IPC Japon',
  'Retail Sales y/y': 'Ventes au détail Japon',

  // ── Canada ──────────────────────────────────────────────────────────────
  'BOC Rate Statement': 'Taux BoC (Canada)',
  'Overnight Rate': 'Taux directeur Canada',
  'Canadian CPI m/m': 'IPC Canada',
  'Employment Change': 'Variation emploi',

  // ── Australie ───────────────────────────────────────────────────────────
  'RBA Cash Rate Target': 'Taux RBA (Australie)',
  'RBA Rate Statement': 'Décision RBA',
  'RBA Bulletin': 'Bulletin RBA',
  'Australian CPI q/q': 'IPC Australie',

  // ── Suisse ──────────────────────────────────────────────────────────────
  'SNB Policy Rate': 'Taux BNS (Suisse)',
  'SNB Quarterly Bulletin': 'Bulletin BNS',
  'Employment Level': 'Niveau emploi Suisse',

  // ── Chine ───────────────────────────────────────────────────────────────
  'Chinese CPI y/y': 'IPC Chine',
  'Chinese GDP y/y': 'PIB Chine',
  'Chinese Industrial Production y/y': 'Production industrielle Chine',
  'Caixin Manufacturing PMI': 'PMI manufacturier Caixin',
  'NBS Manufacturing PMI': 'PMI manufacturier NBS',

  // ── Global ──────────────────────────────────────────────────────────────
  'Annual Budget Release': 'Publication budget annuel',
  'Economic Sentiment': 'Sentiment économique',
};

export function translateEcoEvent(name: string): string {
  if (ECO_EVENT_TRANSLATIONS[name]) return ECO_EVENT_TRANSLATIONS[name];
  for (const [en, fr] of Object.entries(ECO_EVENT_TRANSLATIONS)) {
    if (name.toLowerCase().startsWith(en.toLowerCase())) return fr;
  }
  return name;
}

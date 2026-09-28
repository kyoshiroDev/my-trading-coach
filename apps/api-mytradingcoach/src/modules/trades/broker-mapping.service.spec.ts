/**
 * Registre des brokers : une fiche validee une fois sert ensuite TOUS les utilisateurs,
 * gratuits compris, sans appel IA ni deploiement. Ce qui doit rester verrouille, c'est que
 * jamais une fiche douteuse ne soit appliquee : elle porterait les trades de tous les
 * utilisateurs de ce broker.
 */
import { describe, it, expect, vi } from 'vitest';
import { BrokerMappingService } from './broker-mapping.service';
import { headerSignature, type CsvMapping } from './csv-mapping';

const MAPPING: CsvMapping = {
  delimiter: ',',
  decimalSeparator: '.',
  columns: { symbol: 1, entry: 3, exit: 4, quantity: 5, pnl: 6, tradedAt: 0 },
  side: {
    mode: 'column', index: 2,
    longValues: ['Buy'], shortValues: ['Sell'],
    buyTimeIndex: null, sellTimeIndex: null,
  },
  pnlExtraColumns: [],
};

const HEADER = 'Close Time,Contracts,Direction,Avg Entry Price,Avg Exit Price,Closed Size,Closed P&L';

function setup(fiche: Record<string, unknown> | null) {
  const prisma = {
    brokerCsvMapping: {
      findUnique: vi.fn(async () => fiche),
      update: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({ id: 'fiche-1' })),
      findMany: vi.fn(async () => []),
    },
  };
  return { svc: new BrokerMappingService(prisma as never), prisma };
}

const FICHE = {
  id: 'fiche-1', brokerName: 'Bybit', enabled: true,
  mappingJson: JSON.stringify(MAPPING),
};

describe('headerSignature', () => {
  it('absorbe la casse, les espaces, le BOM et les guillemets', () => {
    const a = headerSignature(HEADER);
    expect(headerSignature(`\uFEFF${HEADER.toUpperCase()}\r`)).toBe(a);
    expect(headerSignature(`  ${HEADER}  `)).toBe(a);
    // Les guillemets sont du bruit d'export, pas une difference de structure : « "a","b" »
    // et « a,b » designent le meme fichier.
    expect(headerSignature(HEADER.replace(/,/g, '","').replace(/^/, '"') + '"')).toBe(a);
  });

  it('ne confond PAS deux structures differentes', () => {
    // Une colonne ajoutee change la signature : la fiche ne matche plus et l'import
    // redevient « inconnu ». Mieux vaut ne pas reconnaitre que lire chaque colonne a cote.
    expect(headerSignature(`${HEADER},Fees`)).not.toBe(headerSignature(HEADER));
    // Meme colonnes, ordre different = fichier different.
    expect(headerSignature('b,a')).not.toBe(headerSignature('a,b'));
  });
});

describe('BrokerMappingService — lecture d une fiche', () => {
  it('rend la fiche quand l en-tete correspond', async () => {
    const { svc, prisma } = setup(FICHE);
    const res = await svc.findByHeader(HEADER);
    expect(res?.id).toBe('fiche-1');
    expect(res?.mapping.columns.pnl).toBe(6);
    expect(prisma.brokerCsvMapping.findUnique).toHaveBeenCalledWith({
      where: { headerHash: headerSignature(HEADER) },
    });
  });

  it('ignore une fiche desactivee', async () => {
    // Desactiver, et non supprimer : on garde la trace d une fiche qui s est averee mauvaise.
    const { svc } = setup({ ...FICHE, enabled: false });
    expect(await svc.findByHeader(HEADER)).toBeNull();
  });

  it('ignore une fiche au JSON illisible plutot que de l appliquer a moitie', async () => {
    const { svc } = setup({ ...FICHE, mappingJson: '{ ceci n est pas du json' });
    expect(await svc.findByHeader(HEADER)).toBeNull();
  });

  it('ignore une fiche qui designe une colonne absente de CET en-tete', async () => {
    // Le broker a supprime des colonnes : la fiche reste syntaxiquement valide mais devient
    // fausse pour ce fichier. Sans ce controle, chaque ligne serait lue a cote en silence.
    const { svc } = setup(FICHE);
    expect(await svc.findByHeader('Close Time,Contracts')).toBeNull();
  });

  it('aucune fiche pour cet en-tete', async () => {
    const { svc } = setup(null);
    expect(await svc.findByHeader(HEADER)).toBeNull();
  });

  it('une base indisponible ne casse pas l import : on retombe sur « inconnu »', async () => {
    const { svc, prisma } = setup(null);
    prisma.brokerCsvMapping.findUnique.mockRejectedValueOnce(new Error('base injoignable'));
    await expect(svc.findByHeader(HEADER)).resolves.toBeNull();
  });
});

describe('BrokerMappingService — enregistrement', () => {
  it('derive le headerHash de l en-tete, sans le recevoir de l appelant', async () => {
    // Deux fiches ne doivent pas pouvoir revendiquer le meme en-tete, et un appelant ne doit
    // pas pouvoir enregistrer une fiche sous la signature d un autre broker.
    const { svc, prisma } = setup(null);
    await svc.save({
      header: HEADER, brokerName: 'Bybit', mapping: MAPPING,
      pnlConfidence: 1, validatedById: 'admin-1',
    });
    const appel = prisma.brokerCsvMapping.upsert.mock.calls[0][0] as {
      where: { headerHash: string }; create: Record<string, unknown>;
    };
    expect(appel.where.headerHash).toBe(headerSignature(HEADER));
    expect(appel.create['validatedById']).toBe('admin-1');
    expect(appel.create['headerSample']).toBe(HEADER);
  });

  it('le compteur d usage n interrompt jamais un import', async () => {
    const { svc, prisma } = setup(FICHE);
    prisma.brokerCsvMapping.update.mockRejectedValueOnce(new Error('ecriture refusee'));
    await expect(svc.noteUsage('fiche-1')).resolves.toBeUndefined();
  });
});

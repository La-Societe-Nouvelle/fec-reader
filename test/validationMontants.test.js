import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { FECReader, readFECLignes } from '../src/index.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// ── Helpers : contenu FEC tabulé minimal ─────────────────────────────────────

const T = '\t';

const HEADER = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate',
  'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib',
  'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
].join(T);

const HEADER_AVEC_SENS = HEADER.replace('Debit\t', 'Montant\t').replace('Credit', 'Sens');

const row = (...fields) => {
  const r = [...fields];
  while (r.length < 18) r.push('');
  return r.join(T);
};

// Ligne dont seuls les deux champs montant (Debit/Credit ou Montant/Sens) varient.
const ligneMontants = (a, b) =>
  row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', a, b);

const makeFEC = (...rows) => [HEADER, ...rows].join('\n');
const makeFECAvecSens = (...rows) => [HEADER_AVEC_SENS, ...rows].join('\n');

const premiereLigne = (result) => result.Journaux['ACH'].Ecritures['AC0001'].Lignes[0];

async function collect(iterable) {
  const items = [];
  for await (const lot of iterable) items.push(...lot);
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('validation des montants', () => {
  describe('valeurs refusées : anomalie montant-invalide, montant à 0', () => {
    const refusees = ['9'.repeat(400), '12a4,50', '1 234,56', '1 234,56', '1.234,56', '12,5,0', '.5', ',5', '5,', '5.'];

    for (const valeur of refusees) {
      it(`refuse "${valeur}"`, () => {
        const result = FECReader(makeFEC(ligneMontants(valeur, '0,00')));
        expect(result.Anomalies).toEqual([
          expect.objectContaining({
            Ligne: 2,
            Type: 'montant-invalide',
            Champs: ['Debit'],
            Valeurs: { Debit: valeur },
          }),
        ]);
        expect(premiereLigne(result).Debit).toBe(0);
      });
    }
  });

  describe('valeurs acceptées : lues sans anomalie', () => {
    const acceptees = [
      ['1234,56', 1234.56], ['1234.56', 1234.56], ['1234', 1234], ['0,00', 0],
      ['1234,5', 1234.5], ['-12,00', -12], ['+12,00', 12], ['-0,00', 0], ['0012,50', 12.5],
    ];

    for (const [valeur, attendu] of acceptees) {
      it(`accepte "${valeur}" → ${attendu}`, () => {
        const result = FECReader(makeFEC(ligneMontants(valeur, '0,00')));
        expect(result.Anomalies).toEqual([]);
        expect(premiereLigne(result).Debit).toBe(attendu);
      });
    }
  });

  describe('nettoyage des bords avant validation', () => {
    for (const valeur of ['"100,00"', ' 100,00 ', ' 100,00 ', ' "100,00" ']) {
      it(`lit ${JSON.stringify(valeur)} comme 100`, () => {
        const result = FECReader(makeFEC(ligneMontants(valeur, '0,00')));
        expect(result.Anomalies).toEqual([]);
        expect(premiereLigne(result).Debit).toBe(100);
      });
    }
  });

  describe('une anomalie par ligne et par type', () => {
    it('Debit et Credit vides : une seule anomalie montant-vide, message inchangé', () => {
      const result = FECReader(makeFEC(ligneMontants('', '')));
      expect(result.Anomalies).toHaveLength(1);
      expect(result.Anomalies[0]).toMatchObject({ Ligne: 2, Type: 'montant-vide', Champs: ['Debit', 'Credit'] });
      expect(result.Anomalies[0].Message).toBe('Montant vide (Debit, Credit) à la ligne 2 : traité comme 0.');
    });

    it('Debit et Credit invalides : une seule anomalie montant-invalide', () => {
      const result = FECReader(makeFEC(ligneMontants('12a', '1 000')));
      expect(result.Anomalies).toHaveLength(1);
      expect(result.Anomalies[0]).toMatchObject({
        Type: 'montant-invalide',
        Champs: ['Debit', 'Credit'],
        Valeurs: { Debit: '12a', Credit: '1 000' },
      });
    });

    it('Debit vide et Credit invalide : deux anomalies de types différents', () => {
      const result = FECReader(makeFEC(ligneMontants('', '12a')));
      expect(result.Anomalies.map((a) => a.Type)).toEqual(['montant-vide', 'montant-invalide']);
    });
  });

  describe('format avecSens', () => {
    for (const sens of ['', 'X']) {
      it(`Sens "${sens}" : sens-invalide seul, montants à 0`, () => {
        const result = FECReader(makeFECAvecSens(ligneMontants('12a', sens)));
        expect(result.Anomalies).toEqual([
          expect.objectContaining({
            Ligne: 2,
            Type: 'sens-invalide',
            Champs: ['Sens'],
            Valeurs: { Sens: sens, Montant: '12a' },
          }),
        ]);
        expect(premiereLigne(result)).toMatchObject({ Debit: 0, Credit: 0 });
      });
    }

    it('montant vide avec Sens D : montant-vide sur Debit', () => {
      const result = FECReader(makeFECAvecSens(ligneMontants('', 'D')));
      expect(result.Anomalies).toEqual([
        expect.objectContaining({ Type: 'montant-vide', Champs: ['Debit'] }),
      ]);
    });

    it('montant invalide avec Sens C : montant-invalide sur Credit', () => {
      const result = FECReader(makeFECAvecSens(ligneMontants('1.234,56', 'C')));
      expect(result.Anomalies).toEqual([
        expect.objectContaining({ Type: 'montant-invalide', Champs: ['Credit'], Valeurs: { Credit: '1.234,56' } }),
      ]);
      expect(premiereLigne(result)).toMatchObject({ Debit: 0, Credit: 0 });
    });
  });

  describe('contrôle actif quelles que soient les options', () => {
    const contenu = makeFEC(ligneMontants('12a', '0,00'));

    it('avec lignes: false', () => {
      const result = FECReader(contenu, { lignes: false });
      expect(result.Anomalies.map((a) => a.Type)).toEqual(['montant-invalide']);
    });

    it('avec onLigne', () => {
      const result = FECReader(contenu, { onLigne: () => {} });
      expect(result.Anomalies.map((a) => a.Type)).toEqual(['montant-invalide']);
    });

    it('avec champs sans Debit ni Credit', () => {
      const result = FECReader(contenu, { champs: ['CompAuxLib'] });
      expect(result.Anomalies.map((a) => a.Type)).toEqual(['montant-invalide']);
    });

    it('montant-vide signalé aussi avec lignes: false', () => {
      const result = FECReader(makeFEC(ligneMontants('', '0,00')), { lignes: false });
      expect(result.Anomalies.map((a) => a.Type)).toEqual(['montant-vide']);
    });

    it('readFECLignes, y compris avec champs sans Debit ni Credit', async () => {
      const items = await collect(readFECLignes(contenu, { champs: ['CompteNum'] }));
      expect(items[0].anomalie).toMatchObject({ Ligne: 2, Type: 'montant-invalide', Champs: ['Debit'] });
      expect(items[1].ligne).toEqual({ CompteNum: '60600' });
    });

    it('readFECLignes, format avecSens', async () => {
      const items = await collect(readFECLignes(makeFECAvecSens(ligneMontants('100,00', 'X'))));
      expect(items[0].anomalie).toMatchObject({ Type: 'sens-invalide' });
      expect(items[1].ligne).toMatchObject({ Debit: 0, Credit: 0 });
    });
  });

  describe('typage des anomalies existantes', () => {
    it('colonnes : Type ajouté, message inchangé', () => {
      const result = FECReader(makeFEC('ACH\tAchats\tAC0001'));
      expect(result.Anomalies[0]).toMatchObject({ Ligne: 2, Type: 'colonnes' });
      expect(result.Anomalies[0].Message).toMatch(/corrompu/);
    });

    it('colonnes via readFECLignes', async () => {
      const items = await collect(readFECLignes(makeFEC('ACH\tAchats\tAC0001')));
      expect(items[0].anomalie.Type).toBe('colonnes');
    });
  });

  describe('plafond maxAnomalies', () => {
    const contenu = makeFEC(
      ...Array.from({ length: 5 }, () => ligneMontants('', '0,00')),
      ligneMontants('12a', '0,00'),
    );

    it('plafonne le détail par type, compte tout dans AnomaliesParType', () => {
      const result = FECReader(contenu, { maxAnomalies: 2 });
      expect(result.Anomalies.map((a) => a.Type)).toEqual(['montant-vide', 'montant-vide', 'montant-invalide']);
      expect(result.AnomaliesParType).toEqual({ 'montant-vide': 5, 'montant-invalide': 1 });
    });

    it('défaut à 1000 par type', () => {
      const result = FECReader(contenu);
      expect(result.Anomalies).toHaveLength(6);
    });

    it('maxAnomalies: 0 ne garde que les compteurs', () => {
      const result = FECReader(contenu, { maxAnomalies: 0 });
      expect(result.Anomalies).toEqual([]);
      expect(result.AnomaliesParType).toEqual({ 'montant-vide': 5, 'montant-invalide': 1 });
    });

    for (const valeur of [null, NaN, -1, '10']) {
      it(`maxAnomalies ${String(valeur)} lève une erreur`, () => {
        expect(() => FECReader(contenu, { maxAnomalies: valeur })).toThrow(/maxAnomalies/);
      });
    }

    it('AnomaliesParType vide pour un fichier valide', () => {
      expect(FECReader(fixture('sample_tab.txt')).AnomaliesParType).toEqual({});
    });
  });

  describe('non-régression', () => {
    for (const nom of ['sample_tab.txt', 'sample_pipe.txt']) {
      it(`${nom} : aucune anomalie, quelles que soient les options`, async () => {
        expect(FECReader(fixture(nom)).Anomalies).toEqual([]);
        expect(FECReader(fixture(nom), { lignes: false }).Anomalies).toEqual([]);
        const items = await collect(readFECLignes(fixture(nom)));
        expect(items.some((i) => i.anomalie)).toBe(false);
      });
    }
  });
});

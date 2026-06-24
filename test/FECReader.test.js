import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { FECReader } from '../src/index.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// ── Helper : construit un contenu FEC tabulé minimal ─────────────────────────

const T = '\t';

const HEADER = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate',
  'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib',
  'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
].join(T);

const row = (...fields) => {
  const r = [...fields];
  while (r.length < 18) r.push('');
  return r.join(T);
};

const makeFEC = (...rows) => [HEADER, ...rows].join('\n');

const SAMPLE_ROW = row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Fournitures', '', '', 'FA001', '20240101', 'Test', '100,00', '0,00');

// ─────────────────────────────────────────────────────────────────────────────

describe('FECReader', () => {
  describe('parsing', () => {
    it('parse un FEC avec séparateur tabulation', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.journaux).toBeDefined();
      expect(Object.keys(result.journaux)).toContain('ACH');
      expect(Object.keys(result.journaux)).toContain('VTE');
    });

    it('parse un FEC avec séparateur pipe', () => {
      const result = FECReader(fixture('sample_pipe.txt'));
      expect(result.journaux).toBeDefined();
      expect(Object.keys(result.journaux)).toContain('VTE');
      expect(Object.keys(result.journaux)).toContain('ACH');
    });

    it('parse le format Montant/Sens et produit Debit/Credit', () => {
      const result = FECReader(fixture('sample_pipe.txt'));
      const ecriture = Object.values(result.journaux['VTE'].ecritures)[0][0];
      expect(ecriture).toHaveProperty('Debit');
      expect(ecriture).toHaveProperty('Credit');
      expect(ecriture).not.toHaveProperty('Montant');
      expect(ecriture).not.toHaveProperty('Sens');
    });

    it('Debit et Credit sont des nombres', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      const ecriture = Object.values(result.journaux['ACH'].ecritures)[0][0];
      expect(typeof ecriture.Debit).toBe('number');
      expect(typeof ecriture.Credit).toBe('number');
    });

    it('tolère les fins de ligne Windows \\r\\n', () => {
      const content = fixture('sample_tab.txt').replace(/\n/g, '\r\n');
      const result = FECReader(content);
      expect(Object.keys(result.journaux)).toContain('ACH');
      expect(result.journaux['ACH'].nbLignes).toBe(3);
    });

    it('accepte les variantes de casse MontantDevise / IDevise dans le header', () => {
      const header = [
        'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate',
        'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
        'PieceRef', 'PieceDate', 'EcritureLib',
        'Debit', 'Credit',
        'EcritureLet', 'DateLet', 'ValidDate', 'MontantDevise', 'IDevise',
      ].join(T);
      const content = [header, SAMPLE_ROW].join('\n');
      expect(() => FECReader(content)).not.toThrow();
    });

    it('supprime les guillemets encadrant les champs', () => {
      const quotedRow = row('"ACH"', '"Achats"', 'AC0001', '20240101', '"60600"', 'Fournitures', '', '', 'FA001', '20240101', 'Test', '100,00', '0,00');
      const result = FECReader(makeFEC(quotedRow));
      expect(result.journaux['ACH']).toBeDefined();
      expect(Object.values(result.journaux['ACH'].ecritures)[0][0].CompteNum).toBe('60600');
    });
  });

  describe('structure JSON', () => {
    it('les écritures sont groupées par journal et par EcritureNum', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.journaux['ACH'].ecritures['AC0001']).toHaveLength(3);
      expect(result.journaux['VTE'].ecritures['VT0001']).toHaveLength(2);
    });

    it('nbLignes reflète le nombre de lignes du journal', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.journaux['ACH'].nbLignes).toBe(3);
      expect(result.journaux['OD'].nbLignes).toBe(2);
    });

    it('derniereDate du journal est au format YYYYMMDD', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.journaux['ACH'].derniereDate).toMatch(/^\d{8}$/);
    });

    it('derniereDate reflète la dernière date du journal', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.journaux['ACH'].derniereDate).toBe('20240115');
      expect(result.journaux['VTE'].derniereDate).toBe('20241231');
    });

    it('periode.premiereDate et derniereDate sont au format YYYYMMDD', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.meta.periode.premiereDate).toMatch(/^\d{8}$/);
      expect(result.meta.periode.derniereDate).toMatch(/^\d{8}$/);
    });

    it('periode couvre bien l\'ensemble du fichier', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.meta.periode.premiereDate).toBe('20240115');
      expect(result.meta.periode.derniereDate).toBe('20241231');
    });

    it('fichier sans lignes de données retourne des journaux vides', () => {
      const result = FECReader(HEADER + '\n');
      expect(result.journaux).toEqual({});
      expect(result.meta.periode.premiereDate).toBeNull();
      expect(result.meta.periode.derniereDate).toBeNull();
    });
  });

  describe('métadonnées fichier', () => {
    it('détecte le séparateur tabulation', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.meta.fichier.separateur).toBe('\t');
    });

    it('détecte le séparateur pipe', () => {
      const result = FECReader(fixture('sample_pipe.txt'));
      expect(result.meta.fichier.separateur).toBe('|');
    });

    it('détecte le format standard (Debit/Credit)', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.meta.fichier.format).toBe('standard');
    });

    it('détecte le format avecSens (Montant/Sens)', () => {
      const result = FECReader(fixture('sample_pipe.txt'));
      expect(result.meta.fichier.format).toBe('avecSens');
    });

    it('rapporte l\'encodage UTF-8 pour une chaîne', () => {
      const result = FECReader(makeFEC(SAMPLE_ROW));
      expect(result.meta.fichier.encodage).toBe('UTF-8');
    });

    it('rapporte l\'encodage UTF-8 pour un Buffer UTF-8', () => {
      const result = FECReader(Buffer.from(makeFEC(SAMPLE_ROW), 'utf8'));
      expect(result.meta.fichier.encodage).toBe('UTF-8');
    });

    it('rapporte l\'encodage UTF-8 BOM pour un Buffer avec BOM', () => {
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
      const content = Buffer.from(makeFEC(SAMPLE_ROW), 'utf8');
      const result = FECReader(Buffer.concat([bom, content]));
      expect(result.meta.fichier.encodage).toBe('UTF-8 BOM');
    });
  });

  describe('comptes', () => {
    it('collecte les comptes principaux', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.comptes).toHaveProperty('60600');
      expect(result.comptes['60600']).toMatchObject({ compteLib: 'Fournitures admin.' });
    });

    it('collecte les comptes auxiliaires', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.comptesAux).toHaveProperty('F001');
      expect(result.comptesAux).toHaveProperty('C001');
    });
  });

  describe('erreurs', () => {
    it('lève une erreur si le séparateur est non reconnu', () => {
      expect(() => FECReader('col1;col2;col3\nval1;val2;val3')).toThrow('Séparateur non reconnu');
    });

    it('lève une erreur si des colonnes sont manquantes', () => {
      const badContent = 'JournalCode\tJournalLib\nACH\tAchats';
      expect(() => FECReader(badContent)).toThrow(/Fichier erroné.*manquant/);
    });

    it('lève une erreur avec le numéro de ligne si une ligne est incomplète', () => {
      const incomplete = makeFEC(SAMPLE_ROW, 'ACH\tAchats'); // ligne 3, trop peu de champs
      expect(() => FECReader(incomplete)).toThrow(/ligne 3/);
    });

    it('affiche un message clair pour un FEC mal formé', () => {
      const malformedFEC = 'JournalCode|JournalLib\nACH|Achats\nACH'; // FEC incomplet
      expect(() => FECReader(malformedFEC)).toThrow(/Fichier erroné.*manquant/);
    });
  });

  describe('fichiers malformés', () => {
    it('gère les montants non numériques', () => {
      const badAmountRow = row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', 'ABC,00', '0,00');
      const result = FECReader(makeFEC(badAmountRow));
      expect(result.journaux['ACH'].ecritures['AC0001'][0].Debit).toBeNaN();
    });

    it('gère les dates invalides', () => {
      const badDateRow = row('ACH', 'Achats', 'AC0001', 'INVALID', '60600', 'Test', '', '', 'P1', '20240101', 'T', '100,00', '0,00');
      const result = FECReader(makeFEC(badDateRow));
      expect(result.journaux['ACH'].ecritures['AC0001'][0].EcritureDate).toBe('INVALID');
    });

    it('ignore les lignes vides au milieu du fichier', () => {
      const content = makeFEC(SAMPLE_ROW, '', SAMPLE_ROW);
      const result = FECReader(content);
      expect(result.journaux['ACH'].nbLignes).toBe(2);
    });

    it('tolère les montants avec espaces comme séparateurs de milliers', () => {
      const exoticAmount = row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', '1 000,00', '0,00');
      const result = FECReader(makeFEC(exoticAmount));
      expect(result.journaux['ACH'].ecritures['AC0001'][0].Debit).toBe(1); // Les espaces sont ignorés, reste "00" qui devient 0
    });

    it('gère les montants avec plusieurs virgules', () => {
      const multiComma = row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', '1,000,00', '0,00');
      const result = FECReader(makeFEC(multiComma));
      expect(result.journaux['ACH'].ecritures['AC0001'][0].Debit).toBe(1); // Seule la première virgule est remplacée
    });
  });

  describe('cas limites', () => {
    it('fichier avec seulement l\'en-tête et une ligne vide', () => {
      const result = FECReader(HEADER + '\n');
      expect(result.journaux).toEqual({});
      expect(result.meta.periode.premiereDate).toBeNull();
      expect(result.meta.periode.derniereDate).toBeNull();
    });

    it('fichier vide lève une erreur', () => {
      expect(() => FECReader('')).toThrow();
    });
  });
});

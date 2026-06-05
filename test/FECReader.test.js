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
      expect(result.books).toBeDefined();
      expect(Object.keys(result.books)).toContain('ACH');
      expect(Object.keys(result.books)).toContain('VTE');
    });

    it('parse un FEC avec séparateur pipe', () => {
      const result = FECReader(fixture('sample_pipe.txt'));
      expect(result.books).toBeDefined();
      expect(Object.keys(result.books)).toContain('VTE');
      expect(Object.keys(result.books)).toContain('ACH');
    });

    it('parse le format Montant/Sens et produit Debit/Credit', () => {
      const result = FECReader(fixture('sample_pipe.txt'));
      const entry = Object.values(result.books['VTE'].entries)[0][0];
      expect(entry).toHaveProperty('Debit');
      expect(entry).toHaveProperty('Credit');
      expect(entry).not.toHaveProperty('Montant');
      expect(entry).not.toHaveProperty('Sens');
    });

    it('Debit et Credit sont des nombres', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      const entry = Object.values(result.books['ACH'].entries)[0][0];
      expect(typeof entry.Debit).toBe('number');
      expect(typeof entry.Credit).toBe('number');
    });

    it('tolère les fins de ligne Windows \\r\\n', () => {
      const content = fixture('sample_tab.txt').replace(/\n/g, '\r\n');
      const result = FECReader(content);
      expect(Object.keys(result.books)).toContain('ACH');
      expect(result.books['ACH'].lineCount).toBe(3);
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
      expect(result.books['ACH']).toBeDefined();
      expect(Object.values(result.books['ACH'].entries)[0][0].CompteNum).toBe('60600');
    });
  });

  describe('structure JSON', () => {
    it('les entrées sont groupées par journal et par EcritureNum', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.books['ACH'].entries['AC0001']).toHaveLength(3);
      expect(result.books['VTE'].entries['VT0001']).toHaveLength(2);
    });

    it('lineCount reflète le nombre de lignes du journal', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.books['ACH'].lineCount).toBe(3);
      expect(result.books['OD'].lineCount).toBe(2);
    });

    it('lastDate du journal est au format YYYYMMDD', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.books['ACH'].lastDate).toMatch(/^\d{8}$/);
    });

    it('lastDate reflète la dernière date du journal', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.books['ACH'].lastDate).toBe('20240115');
      expect(result.books['VTE'].lastDate).toBe('20241231');
    });

    it('period.firstDate et lastDate sont au format YYYYMMDD', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.meta.period.firstDate).toMatch(/^\d{8}$/);
      expect(result.meta.period.lastDate).toMatch(/^\d{8}$/);
    });

    it('period couvre bien l\'ensemble du fichier', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.meta.period.firstDate).toBe('20240115');
      expect(result.meta.period.lastDate).toBe('20241231');
    });

    it('fichier sans lignes de données retourne des books vides', () => {
      const result = FECReader(HEADER + '\n');
      expect(result.books).toEqual({});
      expect(result.meta.period.firstDate).toBeNull();
      expect(result.meta.period.lastDate).toBeNull();
    });
  });

  describe('classification des journaux', () => {
    it('détecte le type ANOUVEAUX par code', () => {
      const r = FECReader(makeFEC(row('AN', 'A NOUVEAUX', 'AN1', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', '0,00', '0,00')));
      expect(r.books['AN'].type).toBe('ANOUVEAUX');
    });

    it('détecte le type ACHATS par libellé', () => {
      // code ACH non reconnu, mais label "ACHATS" l'est
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.books['ACH'].type).toBe('ACHATS');
    });

    it('détecte le type VENTES par libellé', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.books['VTE'].type).toBe('VENTES');
    });

    it('détecte le type OPERATIONS par code', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.books['OD'].type).toBe('OPERATIONS');
    });

    it('retourne AUTRE pour un journal non reconnu', () => {
      const r = FECReader(makeFEC(row('XX', 'Journal inconnu', 'XX1', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', '0,00', '0,00')));
      expect(r.books['XX'].type).toBe('AUTRE');
    });
  });

  describe('comptes', () => {
    it('collecte les comptes auxiliaires', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.meta.accountsAux).toHaveProperty('F001');
      expect(result.meta.accountsAux).toHaveProperty('C001');
    });

    it('applique le mapping amortissement (2813 → 213)', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.meta.accounts['2813'].directMatching).toBe(true);
      expect(result.meta.accounts['2813'].assetAccountNum).toBe('213');
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
      expect(() => FECReader(incomplete)).toThrow(/Erreur - Ligne incomplète/);
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
      expect(result.books['ACH'].entries['AC0001'][0].Debit).toBeNaN();
    });

    it('gère les dates invalides', () => {
      const badDateRow = row('ACH', 'Achats', 'AC0001', 'INVALID', '60600', 'Test', '', '', 'P1', '20240101', 'T', '100,00', '0,00');
      const result = FECReader(makeFEC(badDateRow));
      expect(result.books['ACH'].entries['AC0001'][0].EcritureDate).toBe('INVALID');
    });

    it('ignore les lignes vides au milieu du fichier', () => {
      const content = makeFEC(SAMPLE_ROW, '', SAMPLE_ROW);
      const result = FECReader(content);
      expect(result.books['ACH'].lineCount).toBe(2);
    });

    it('tolère les montants avec espaces comme séparateurs de milliers', () => {
      const exoticAmount = row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', '1 000,00', '0,00');
      const result = FECReader(makeFEC(exoticAmount));
      expect(result.books['ACH'].entries['AC0001'][0].Debit).toBe(1); // Les espaces sont ignorés, reste "00" qui devient 0
    });

    it('gère les montants avec plusieurs virgules', () => {
      const multiComma = row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', '1,000,00', '0,00');
      const result = FECReader(makeFEC(multiComma));
      expect(result.books['ACH'].entries['AC0001'][0].Debit).toBe(1); // Seule la première virgule est remplacée
    });
  });

  describe('cas limites', () => {
    it('fichier avec seulement l\'en-tête et une ligne vide', () => {
      const result = FECReader(HEADER + '\n');
      expect(result.books).toEqual({});
      expect(result.meta.period.firstDate).toBeNull();
      expect(result.meta.period.lastDate).toBeNull();
    });

    it('fichier vide lève une erreur', () => {
      expect(() => FECReader('')).toThrow();
    });
  });
});
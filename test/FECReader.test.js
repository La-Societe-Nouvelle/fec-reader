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
      expect(result.Journaux).toBeDefined();
      expect(Object.keys(result.Journaux)).toContain('ACH');
      expect(Object.keys(result.Journaux)).toContain('VTE');
    });

    it('parse un FEC avec séparateur pipe', () => {
      const result = FECReader(fixture('sample_pipe.txt'));
      expect(result.Journaux).toBeDefined();
      expect(Object.keys(result.Journaux)).toContain('VTE');
      expect(Object.keys(result.Journaux)).toContain('ACH');
    });

    it('parse le format Montant/Sens et produit Debit/Credit', () => {
      const result = FECReader(fixture('sample_pipe.txt'));
      const ecriture = Object.values(result.Journaux['VTE'].Ecritures)[0].Lignes[0];
      expect(ecriture).toHaveProperty('Debit');
      expect(ecriture).toHaveProperty('Credit');
      expect(ecriture).not.toHaveProperty('Montant');
      expect(ecriture).not.toHaveProperty('Sens');
    });

    it('Debit et Credit sont des nombres', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      const ecriture = Object.values(result.Journaux['ACH'].Ecritures)[0].Lignes[0];
      expect(typeof ecriture.Debit).toBe('number');
      expect(typeof ecriture.Credit).toBe('number');
    });

    it('tolère les fins de ligne Windows \\r\\n', () => {
      const content = fixture('sample_tab.txt').replace(/\n/g, '\r\n');
      const result = FECReader(content);
      expect(Object.keys(result.Journaux)).toContain('ACH');
      expect(result.Journaux['ACH'].NombreLignes).toBe(3);
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
      expect(result.Journaux['ACH']).toBeDefined();
      expect(Object.values(result.Journaux['ACH'].Ecritures)[0].Lignes[0].CompteNum).toBe('60600');
    });
  });

  describe('structure JSON', () => {
    it('les écritures sont groupées par journal et par EcritureNum', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Journaux['ACH'].Ecritures['AC0001'].Lignes).toHaveLength(3);
      expect(result.Journaux['VTE'].Ecritures['VT0001'].Lignes).toHaveLength(2);
    });

    it('nbLignes reflète le nombre de lignes du journal', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Journaux['ACH'].NombreLignes).toBe(3);
      expect(result.Journaux['OD'].NombreLignes).toBe(2);
    });

    it('derniereDate du journal est au format YYYYMMDD', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Journaux['ACH'].DerniereDate).toMatch(/^\d{8}$/);
    });

    it('derniereDate reflète la dernière date du journal', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Journaux['ACH'].DerniereDate).toBe('20240115');
      expect(result.Journaux['VTE'].DerniereDate).toBe('20241231');
    });

    it('periode.premiereDate et derniereDate sont au format YYYYMMDD', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Metadonnees.Periode.DateDebut).toMatch(/^\d{8}$/);
      expect(result.Metadonnees.Periode.DateFin).toMatch(/^\d{8}$/);
    });

    it('periode couvre bien l\'ensemble du fichier', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Metadonnees.Periode.DateDebut).toBe('20240115');
      expect(result.Metadonnees.Periode.DateFin).toBe('20241231');
    });

    it('fichier sans lignes de données retourne des journaux vides', () => {
      const result = FECReader(HEADER + '\n');
      expect(result.Journaux).toEqual({});
      expect(result.Metadonnees.Periode.DateDebut).toBeNull();
      expect(result.Metadonnees.Periode.DateFin).toBeNull();
    });
  });

  describe('métadonnées fichier', () => {
    it('détecte le séparateur tabulation', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Metadonnees.Fichier.Separateur).toBe('\t');
    });

    it('détecte le séparateur pipe', () => {
      const result = FECReader(fixture('sample_pipe.txt'));
      expect(result.Metadonnees.Fichier.Separateur).toBe('|');
    });

    it('détecte le format standard (Debit/Credit)', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Metadonnees.Fichier.Format).toBe('standard');
    });

    it('détecte le format avecSens (Montant/Sens)', () => {
      const result = FECReader(fixture('sample_pipe.txt'));
      expect(result.Metadonnees.Fichier.Format).toBe('avecSens');
    });

    it('rapporte l\'encodage UTF-8 pour une chaîne', () => {
      const result = FECReader(makeFEC(SAMPLE_ROW));
      expect(result.Metadonnees.Fichier.Encodage).toBe('UTF-8');
    });

    it('rapporte l\'encodage UTF-8 pour un Buffer UTF-8', () => {
      const result = FECReader(Buffer.from(makeFEC(SAMPLE_ROW), 'utf8'));
      expect(result.Metadonnees.Fichier.Encodage).toBe('UTF-8');
    });

    it('rapporte l\'encodage UTF-8 BOM pour un Buffer avec BOM', () => {
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
      const content = Buffer.from(makeFEC(SAMPLE_ROW), 'utf8');
      const result = FECReader(Buffer.concat([bom, content]));
      expect(result.Metadonnees.Fichier.Encodage).toBe('UTF-8 BOM');
    });
  });

  describe('comptes', () => {
    it('collecte les comptes principaux', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Comptes).toHaveProperty('60600');
      expect(result.Comptes['60600']).toEqual({ Libelle: 'Fournitures admin.' });
    });

    it('collecte les comptes auxiliaires', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.ComptesAux).toHaveProperty('F001');
      expect(result.ComptesAux).toHaveProperty('C001');
    });

    it("n'expose ni Debit, ni Credit, ni Solde, même pour un compte touché par plusieurs journaux", () => {
      const content = makeFEC(
        row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Fournitures', '', '', 'FA001', '20240101', 'Achat', '100,00', '0,00'),
        row('OD', 'Opérations diverses', 'OD0001', '20240115', '60600', 'Fournitures', '', '', '', '20240115', 'Avoir', '0,00', '30,00'),
      );
      const result = FECReader(content);
      expect(result.Comptes['60600']).toEqual({ Libelle: 'Fournitures' });
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

    it("signale une ligne incomplète dans Anomalies sans lever d'erreur", () => {
      const incomplete = makeFEC(SAMPLE_ROW, 'ACH\tAchats'); // ligne 3, trop peu de champs
      const result = FECReader(incomplete);
      expect(result.Anomalies).toHaveLength(1);
      expect(result.Anomalies[0]).toMatchObject({ Ligne: 3 });
      expect(result.Anomalies[0].Message).toMatch(/ligne 3/);
    });

    it('ignore la ligne malformée mais parse les lignes valides restantes', () => {
      const content = makeFEC('ACH\tAchats', SAMPLE_ROW); // ligne 2 incomplète, ligne 3 valide
      const result = FECReader(content);
      expect(result.Anomalies).toHaveLength(1);
      expect(result.Journaux['ACH'].NombreLignes).toBe(1);
    });

    it('Anomalies est un tableau vide pour un fichier valide', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Anomalies).toEqual([]);
    });
  });

  describe('fichiers malformés', () => {
    it('gère les montants non numériques', () => {
      const badAmountRow = row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', 'ABC,00', '0,00');
      const result = FECReader(makeFEC(badAmountRow));
      expect(result.Journaux['ACH'].Ecritures['AC0001'].Lignes[0].Debit).toBeNaN();
    });

    it('gère les dates invalides', () => {
      const badDateRow = row('ACH', 'Achats', 'AC0001', 'INVALID', '60600', 'Test', '', '', 'P1', '20240101', 'T', '100,00', '0,00');
      const result = FECReader(makeFEC(badDateRow));
      expect(result.Journaux['ACH'].Ecritures['AC0001'].EcritureDate).toBe('INVALID');
    });

    it('ignore les lignes vides au milieu du fichier', () => {
      const content = makeFEC(SAMPLE_ROW, '', SAMPLE_ROW);
      const result = FECReader(content);
      expect(result.Journaux['ACH'].NombreLignes).toBe(2);
    });

    it('tolère les montants avec espaces comme séparateurs de milliers', () => {
      const exoticAmount = row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', '1 000,00', '0,00');
      const result = FECReader(makeFEC(exoticAmount));
      expect(result.Journaux['ACH'].Ecritures['AC0001'].Lignes[0].Debit).toBe(1); // Les espaces sont ignorés, reste "00" qui devient 0
    });

    it('gère les montants avec plusieurs virgules', () => {
      const multiComma = row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', '1,000,00', '0,00');
      const result = FECReader(makeFEC(multiComma));
      expect(result.Journaux['ACH'].Ecritures['AC0001'].Lignes[0].Debit).toBe(1); // Seule la première virgule est remplacée
    });

    it('gère les montants vides (chaîne vide) comme 0', () => {
      const emptyAmountRow = row('ACH', 'Achats', 'AC0001', '20240101', '60600', 'Test', '', '', 'P1', '20240101', 'T', '', '0,00');
      const result = FECReader(makeFEC(emptyAmountRow));
      expect(result.Journaux['ACH'].Ecritures['AC0001'].Lignes[0].Debit).toBe(0);
    });
  });

  describe('cas limites', () => {
    it('fichier avec seulement l\'en-tête et une ligne vide', () => {
      const result = FECReader(HEADER + '\n');
      expect(result.Journaux).toEqual({});
      expect(result.Metadonnees.Periode.DateDebut).toBeNull();
      expect(result.Metadonnees.Periode.DateFin).toBeNull();
    });

    it('fichier vide lève une erreur', () => {
      expect(() => FECReader('')).toThrow();
    });
  });
});

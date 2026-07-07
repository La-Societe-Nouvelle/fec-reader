import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { FECReader } from '../src/index.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// Deep-clone Journaux while stripping Lignes from every Ecriture, so we can
// compare full mode vs meta-only mode on everything except line detail.
const sansLignes = (journaux) => {
  const copie = structuredClone(journaux);
  for (const journal of Object.values(copie)) {
    for (const ecriture of Object.values(journal.Ecritures)) {
      delete ecriture.Lignes;
    }
  }
  return copie;
};

describe('FECReader — options', () => {
  describe('{ lignes: false }', () => {
    it("n'attache pas de tableau Lignes aux écritures", () => {
      const result = FECReader(fixture('sample_tab.txt'), { lignes: false });
      const ecriture = result.Journaux['ACH'].Ecritures['AC0001'];
      expect(ecriture).not.toHaveProperty('Lignes');
    });

    it('conserve EcritureDate par écriture', () => {
      const result = FECReader(fixture('sample_tab.txt'), { lignes: false });
      expect(result.Journaux['ACH'].Ecritures['AC0001'].EcritureDate).toBe('20240115');
    });

    it('produit les mêmes Journaux (hors Lignes), Comptes, ComptesAux et Metadonnees que le mode complet', () => {
      const complet = FECReader(fixture('sample_tab.txt'));
      const allege  = FECReader(fixture('sample_tab.txt'), { lignes: false });

      expect(sansLignes(allege.Journaux)).toEqual(sansLignes(complet.Journaux));
      expect(allege.Comptes).toEqual(complet.Comptes);
      expect(allege.ComptesAux).toEqual(complet.ComptesAux);
      expect(allege.Metadonnees).toEqual(complet.Metadonnees);
    });

    it('fonctionne aussi avec le format avecSens (pipe)', () => {
      const complet = FECReader(fixture('sample_pipe.txt'));
      const allege  = FECReader(fixture('sample_pipe.txt'), { lignes: false });

      expect(sansLignes(allege.Journaux)).toEqual(sansLignes(complet.Journaux));
      expect(allege.Metadonnees).toEqual(complet.Metadonnees);
    });

    it('fichier sans lignes de données retourne des journaux vides', () => {
      const HEADER = readFileSync(new URL('./fixtures/sample_tab.txt', import.meta.url), 'utf8').split('\n')[0];
      const result = FECReader(HEADER + '\n', { lignes: false });
      expect(result.Journaux).toEqual({});
    });
  });

  describe('{ onLigne }', () => {
    it('invoque onLigne pour chaque ligne de données avec un contexte nettoyé', () => {
      const appels = [];
      FECReader(fixture('sample_tab.txt'), {
        onLigne: (ligne, contexte) => appels.push({ ligne, contexte }),
      });

      expect(appels).toHaveLength(7); // 3 ACH + 2 VTE + 2 OD

      const premier = appels[0];
      expect(premier.contexte).toEqual({
        journalCode: 'ACH',
        journalLib: 'Achats',
        ecritureNum: 'AC0001',
        ecritureDate: '20240115',
        compteNum: '60600',
        compAuxNum: '',
      });
      expect(premier.ligne).toMatchObject({ CompteNum: '60600', Debit: 1200 });
    });

    it('transmet les libellés CompteLib et CompAuxLib à la ligne', () => {
      const appels = [];
      FECReader(fixture('sample_tab.txt'), {
        onLigne: (ligne) => appels.push(ligne),
      });

      const ligneFournisseur = appels.find((l) => l.CompteNum === '401000');
      expect(ligneFournisseur.CompteLib).toBe('Fournisseur Dupont');
      expect(ligneFournisseur.CompAuxLib).toBe('Dupont SARL');
    });

    it('transmet journalLib dans le contexte pour chaque journal', () => {
      const contextes = [];
      FECReader(fixture('sample_tab.txt'), {
        onLigne: (_ligne, contexte) => contextes.push(contexte),
      });

      expect(contextes.find((c) => c.journalCode === 'ACH').journalLib).toBe('Achats');
      expect(contextes.find((c) => c.journalCode === 'VTE').journalLib).toBe('Ventes');
      expect(contextes.find((c) => c.journalCode === 'OD').journalLib).toBe('Opérations Diverses');
    });

    it("ne construit pas de tableau Lignes lorsque onLigne est fourni", () => {
      const result = FECReader(fixture('sample_tab.txt'), { onLigne: () => {} });
      expect(result.Journaux['ACH'].Ecritures['AC0001']).not.toHaveProperty('Lignes');
      expect(result.Journaux['ACH'].NombreLignes).toBe(3);
      expect(result.Journaux['ACH'].NombreEcritures).toBe(1);
    });
  });

  describe('{ nomFichier }', () => {
    it('extrait le SIREN et la date de clôture du nom de fichier', () => {
      const result = FECReader(fixture('sample_tab.txt'), { nomFichier: '552100554FEC20231231.txt' });
      expect(result.Metadonnees.Fichier.Siren).toBe('552100554');
      expect(result.Metadonnees.Fichier.ClotureExercice).toBe('20231231');
    });

    it("renvoie null si nomFichier n'est pas fourni", () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Metadonnees.Fichier.Siren).toBeNull();
      expect(result.Metadonnees.Fichier.ClotureExercice).toBeNull();
    });

    it('renvoie null si le nom de fichier ne suit pas la convention DGFiP', () => {
      const result = FECReader(fixture('sample_tab.txt'), { nomFichier: 'export-comptable.txt' });
      expect(result.Metadonnees.Fichier.Siren).toBeNull();
      expect(result.Metadonnees.Fichier.ClotureExercice).toBeNull();
    });

    it('extrait le SIREN avec 10 à 14 chiffres', () => {
      const result10 = FECReader(fixture('sample_tab.txt'), { nomFichier: '1234567890FEC20231231.txt' });
      expect(result10.Metadonnees.Fichier.Siren).toBe('1234567890');
      expect(result10.Metadonnees.Fichier.ClotureExercice).toBe('20231231');

      const result14 = FECReader(fixture('sample_tab.txt'), { nomFichier: '12345678901234FEC20231231.txt' });
      expect(result14.Metadonnees.Fichier.Siren).toBe('12345678901234');
      expect(result14.Metadonnees.Fichier.ClotureExercice).toBe('20231231');
    });
  });

  describe('{ champs }', () => {
    it('ne construit que les clés demandées dans Lignes[]', () => {
      const result = FECReader(fixture('sample_tab.txt'), { champs: ['CompteNum', 'EcritureLib'] });
      const ligne = result.Journaux['ACH'].Ecritures['AC0001'].Lignes[0];
      expect(Object.keys(ligne).sort()).toEqual(['CompteNum', 'EcritureLib']);
    });

    it('lève une erreur si champs contient un nom invalide', () => {
      expect(() => FECReader(fixture('sample_tab.txt'), { champs: ['CompteNumero'] }))
        .toThrow(/CompteNumero/);
    });

    it('sans champs, la sortie de Lignes[] est identique à la version historique', () => {
      const complet = FECReader(fixture('sample_tab.txt'));
      const sansChamps = FECReader(fixture('sample_tab.txt'), {});
      expect(sansChamps.Journaux).toEqual(complet.Journaux);
    });

    it('Comptes reste { Libelle } quel que soit champs (indépendant de la ligne construite)', () => {
      const complet = FECReader(fixture('sample_tab.txt'));
      const restreint = FECReader(fixture('sample_tab.txt'), { champs: ['EcritureLib'] });
      expect(restreint.Comptes).toEqual(complet.Comptes);
      expect(Object.values(restreint.Comptes)[0]).toEqual({ Libelle: expect.any(String) });
    });

    it('inclut CompteLib même en mode lignes complet si demandé explicitement dans champs', () => {
      const result = FECReader(fixture('sample_tab.txt'), { champs: ['CompteNum', 'CompteLib', 'CompAuxLib'] });
      const ligneFournisseur = result.Journaux['ACH'].Ecritures['AC0001'].Lignes.find((l) => l.CompteNum === '401000');
      expect(ligneFournisseur.CompteLib).toBe('Fournisseur Dupont');
      expect(ligneFournisseur.CompAuxLib).toBe('Dupont SARL');
    });

    it('restreint aussi la ligne transmise à onLigne', () => {
      const appels = [];
      FECReader(fixture('sample_tab.txt'), {
        champs: ['CompteNum'],
        onLigne: (ligne) => appels.push(ligne),
      });
      expect(Object.keys(appels[0])).toEqual(['CompteNum']);
    });

    it('fonctionne avec le format avecSens (pipe)', () => {
      const complet = FECReader(fixture('sample_pipe.txt'));
      const restreint = FECReader(fixture('sample_pipe.txt'), { champs: ['Debit', 'Credit'] });
      expect(restreint.Comptes).toEqual(complet.Comptes);
      const ligne = restreint.Journaux[Object.keys(restreint.Journaux)[0]];
      const premiereEcriture = Object.values(ligne.Ecritures)[0];
      expect(Object.keys(premiereEcriture.Lignes[0]).sort()).toEqual(['Credit', 'Debit']);
    });

    it('lève une erreur si champs est un tableau vide', () => {
      expect(() => FECReader(fixture('sample_tab.txt'), { champs: [] }))
        .toThrow(/l'option champs ne peut pas être un tableau vide/);
    });
  });

  describe('rétrocompatibilité', () => {
    it('sans options, le comportement est identique au mode complet historique', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      expect(result.Journaux['ACH'].Ecritures['AC0001'].Lignes).toHaveLength(3);
    });

    it('sans onLigne, CompteLib et CompAuxLib restent absents de Lignes[] (comportement historique)', () => {
      const result = FECReader(fixture('sample_tab.txt'));
      const ligne = result.Journaux['ACH'].Ecritures['AC0001'].Lignes[0];
      expect(ligne).not.toHaveProperty('CompteLib');
      expect(ligne).not.toHaveProperty('CompAuxLib');
    });
  });
});

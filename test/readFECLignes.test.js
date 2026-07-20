import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { readFECLignes } from '../src/index.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

async function collectLots(iterable) {
  const lots = [];
  for await (const lot of iterable) lots.push(lot);
  return lots;
}

// La plupart des tests ne s'intéressent qu'aux items eux-mêmes, pas au
// découpage en lots : `collect` aplatit donc les lots en une liste d'items,
// dans l'ordre du fichier.
async function collect(iterable) {
  return (await collectLots(iterable)).flat();
}

describe('readFECLignes', () => {
  it('yield des lots d\'items, à plat dans l\'ordre du fichier', async () => {
    const items = await collect(readFECLignes(fixture('sample_tab.txt')));
    expect(items).toHaveLength(7); // 3 ACH + 2 VTE + 2 OD

    const premier = items[0];
    expect(premier).not.toHaveProperty('anomalie');
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

  it('inclut CompteLib/CompAuxLib par défaut (comme onLigne)', async () => {
    const items = await collect(readFECLignes(fixture('sample_tab.txt')));
    const ligneFournisseur = items.find((i) => i.ligne?.CompteNum === '401000').ligne;
    expect(ligneFournisseur.CompteLib).toBe('Fournisseur Dupont');
    expect(ligneFournisseur.CompAuxLib).toBe('Dupont SARL');
  });

  it('résultat identique à FECReader({ onLigne }) sur le même fichier, même ordre', async () => {
    const { FECReader } = await import('../src/index.js');
    const viaOnLigne = [];
    FECReader(fixture('sample_tab.txt'), {
      onLigne: (ligne, contexte) => viaOnLigne.push({ ligne, contexte }),
    });

    const viaAsync = await collect(readFECLignes(fixture('sample_tab.txt')));

    expect(viaAsync).toEqual(viaOnLigne);
  });

  describe('{ champs }', () => {
    it('ne construit que les clés demandées dans ligne', async () => {
      const items = await collect(
        readFECLignes(fixture('sample_tab.txt'), { champs: ['CompteNum', 'EcritureLib'] })
      );
      expect(Object.keys(items[0].ligne).sort()).toEqual(['CompteNum', 'EcritureLib']);
    });

    it('lève une erreur si champs contient un nom invalide', async () => {
      await expect(async () => {
        await collect(readFECLignes(fixture('sample_tab.txt'), { champs: ['CompteNumero'] }));
      }).rejects.toThrow(/CompteNumero/);
    });
  });

  it('fonctionne avec le format avecSens (pipe)', async () => {
    const items = await collect(readFECLignes(fixture('sample_pipe.txt')));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].ligne).toHaveProperty('Debit');
    expect(items[0].ligne).toHaveProperty('Credit');
  });

  it('fonctionne avec champs + intervalleCedeMain combinés', async () => {
    const lots = await collectLots(
      readFECLignes(fixture('sample_tab.txt'), {
        champs: ['CompteNum', 'Debit'],
        intervalleCedeMain: 3
      })
    );
    expect(lots).toHaveLength(3); // 7 lignes / 3 = 2 lots de 3 + 1 lot de 1
    expect(lots[0]).toHaveLength(3);
    expect(lots[1]).toHaveLength(3);
    expect(lots[2]).toHaveLength(1);
    // Vérifier que seuls les champs demandés sont présents
    expect(Object.keys(lots[0][0].ligne).sort()).toEqual(['CompteNum', 'Debit']);
  });
});

describe('intervalleCedeMain (taille de lot)', () => {
  it('regroupe les items par lot de intervalleCedeMain, le dernier lot pouvant être plus petit', async () => {
    const lots = await collectLots(readFECLignes(fixture('sample_tab.txt'), { intervalleCedeMain: 2 }));
    expect(lots.map((l) => l.length)).toEqual([2, 2, 2, 1]); // 7 lignes
  });

  it('un seul lot si intervalleCedeMain dépasse le nombre de lignes', async () => {
    const lots = await collectLots(readFECLignes(fixture('sample_tab.txt'), { intervalleCedeMain: 1000 }));
    expect(lots).toHaveLength(1);
    expect(lots[0]).toHaveLength(7);
  });

  it('cède la main à l\'event loop après chaque lot complet (setImmediate observable)', async () => {
    const evenements = [];
    const iterateur = readFECLignes(fixture('sample_tab.txt'), { intervalleCedeMain: 2 });

    // Un setImmediate concurrent : s'il s'intercale AVANT la fin de la consommation,
    // c'est la preuve que le générateur a rendu la main au moins une fois via son
    // propre `await new Promise(setImmediate)` (sinon tout le for-await se déroulerait
    // en un seul tick sans jamais laisser ce setImmediate concurrent s'exécuter).
    setImmediate(() => evenements.push('concurrent'));

    const lots = [];
    for await (const lot of iterateur) {
      lots.push(lot);
    }

    expect(lots.map((l) => l.length)).toEqual([2, 2, 2, 1]);
    expect(evenements).toEqual(['concurrent']);
  });

  it('ne cède jamais la main si un seul lot est produit (contrôle négatif)', async () => {
    const evenements = [];
    const iterateur = readFECLignes(fixture('sample_tab.txt'), { intervalleCedeMain: 1000 });
    setImmediate(() => evenements.push('concurrent'));

    const lots = [];
    for await (const lot of iterateur) {
      lots.push(lot);
    }

    // Un seul lot (dernier lot partiel yield en sortie de boucle, sans cession
    // associée) : le for-await se termine avant que le setImmediate concurrent
    // ait eu l'occasion de s'exécuter.
    expect(lots).toHaveLength(1);
    expect(evenements).toEqual([]);
  });

  it('toutes les lignes sont reçues, dans l\'ordre, même avec intervalleCedeMain=1 (un item par lot)', async () => {
    const items1 = await collect(readFECLignes(fixture('sample_tab.txt'), { intervalleCedeMain: 1 }));
    const itemsDefaut = await collect(readFECLignes(fixture('sample_tab.txt')));
    expect(items1.map((i) => i.ligne?.CompteNum ?? i.anomalie)).toEqual(
      itemsDefaut.map((i) => i.ligne?.CompteNum ?? i.anomalie)
    );
  });
});

describe('erreurs de header', () => {
  it('lève une erreur au premier next() si le séparateur est inconnu', async () => {
    const contenuInvalide = 'JournalCode;JournalLib\nACH;Achats\n';
    const iterateur = readFECLignes(contenuInvalide);
    await expect(iterateur.next()).rejects.toThrow(/Séparateur non reconnu/);
  });

  it('lève une erreur si des colonnes obligatoires sont manquantes', async () => {
    const enteteIncomplet = 'JournalCode\tJournalLib\n';
    const iterateur = readFECLignes(enteteIncomplet);
    await expect(iterateur.next()).rejects.toThrow(/libellé\(s\) manquant\(s\)/);
  });
});

describe('anomalies', () => {
  it('yield un item { anomalie } pour une ligne mal formée, sans interrompre le flux', async () => {
    const entete = fixture('sample_tab.txt').split('\n')[0];
    const ligneCourte = 'ACH\tAchats\tAC0001\t20240115\t60600'; // colonnes manquantes
    const contenu = `${entete}\n${ligneCourte}\n`;

    const items = await collect(readFECLignes(contenu));
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveProperty('anomalie');
    expect(items[0].anomalie.Ligne).toBe(2);
    expect(items[0].anomalie.Message).toMatch(/colonne\(s\) manquante\(s\)|corrompu/);
  });

  it('colonnes manquantes (moins de la moitié) : message "incomplet" précis', async () => {
    const entete = fixture('sample_tab.txt').split('\n')[0];
    const colonnes = entete
      .replace('Montantdevise', 'MontantDevise')
      .replace('Idevise', 'IDevise')
      .split('\t');
    const nbColonnes = colonnes.length;
    // 3 colonnes manquantes : au-delà de la tolérance de padding (1-2), mais loin d'être
    // la moitié des colonnes -> message "incomplet", pas "corrompu"
    const champs = new Array(nbColonnes - 3).fill('x');
    const contenu = `${entete}\n${champs.join('\t')}\n`;

    const items = await collect(readFECLignes(contenu));
    expect(items).toHaveLength(1);
    expect(items[0].anomalie.Ligne).toBe(2);
    expect(items[0].anomalie.Message).toBe(
      `Fichier FEC incomplet, colonne(s) manquante(s) à la ligne 2 : ${colonnes.slice(-3).join(', ')}. Vérifiez le format d'export.`
    );
  });

  it('colonnes manquantes (plus de la moitié) : message "corrompu" précis', async () => {
    const entete = fixture('sample_tab.txt').split('\n')[0];
    const nbColonnes = entete.split('\t').length;
    const nbLues = 2; // très en dessous de la moitié de nbColonnes
    const champs = new Array(nbLues).fill('x');
    const contenu = `${entete}\n${champs.join('\t')}\n`;

    const items = await collect(readFECLignes(contenu));
    expect(items).toHaveLength(1);
    expect(items[0].anomalie.Ligne).toBe(2);
    expect(items[0].anomalie.Message).toBe(
      `Le fichier FEC semble corrompu ou mal exporté (ligne 2 : ${nbLues} colonne(s) lue(s) sur ${nbColonnes} attendues). Essayez de le ré-exporter depuis votre logiciel comptable.`
    );
  });

  it('trop de colonnes : message "en trop" précis', async () => {
    const entete = fixture('sample_tab.txt').split('\n')[0];
    const nbColonnes = entete.split('\t').length;
    const champs = new Array(nbColonnes + 3).fill('x');
    const contenu = `${entete}\n${champs.join('\t')}\n`;

    const items = await collect(readFECLignes(contenu));
    expect(items).toHaveLength(1);
    expect(items[0].anomalie.Ligne).toBe(2);
    expect(items[0].anomalie.Message).toBe(
      `Fichier FEC invalide, trop de colonnes à la ligne 2 (3 colonne(s) en trop). Vérifiez le format d'export.`
    );
  });

  it('yield une anomalie { Message } en plus de la ligne quand Debit est vide', async () => {
    const entete = fixture('sample_tab.txt').split('\n')[0];
    const colonnes = entete.split('\t');
    const champs = new Array(colonnes.length).fill('');
    champs[colonnes.indexOf('JournalCode')]  = 'ACH';
    champs[colonnes.indexOf('JournalLib')]   = 'Achats';
    champs[colonnes.indexOf('EcritureNum')]  = 'AC0001';
    champs[colonnes.indexOf('EcritureDate')] = '20240115';
    champs[colonnes.indexOf('CompteNum')]    = '60600';
    champs[colonnes.indexOf('Credit')]       = '0,00';
    // Debit reste vide
    const contenu = `${entete}\n${champs.join('\t')}\n`;

    const items = await collect(readFECLignes(contenu));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveProperty('anomalie');
    expect(items[0].anomalie.Message).toMatch(/Montant vide \(Debit\).*ligne 2/);
    expect(items[1]).toHaveProperty('ligne');
    expect(items[1].ligne.Debit).toBe(0);
  });

  it('tolère 1-2 colonnes manquantes en fin de ligne : traité comme ligne normale (padding), pas une anomalie', async () => {
    const entete = fixture('sample_tab.txt').split('\n')[0];
    const nbColonnes = entete.split('\t').length;
    // 2 colonnes manquantes en fin de ligne (les 2 dernières colonnes du header sont MontantDevise/IDevise)
    const colonnes = entete.split('\t');
    const champs = new Array(nbColonnes - 2).fill('');
    champs[4] = 'AC0001';   // EcritureNum
    champs[3] = '20240115'; // EcritureDate
    champs[0] = 'ACH';
    champs[1] = 'Achats';
    champs[5] = '20240115'; // CompteNum placeholder-ish, doesn't matter for this test
    champs[colonnes.indexOf('Debit')]  = '0,00';
    champs[colonnes.indexOf('Credit')] = '0,00';
    const contenu = `${entete}\n${champs.join('\t')}\n`;

    const items = await collect(readFECLignes(contenu));
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('anomalie');
    expect(items[0]).toHaveProperty('ligne');
    expect(items[0]).toHaveProperty('contexte');
  });

  it('traite normalement la dernière ligne de données sans saut de ligne final', async () => {
    const entete = fixture('sample_tab.txt').split('\n')[0];
    const colonnes = entete.split('\t');
    const nbColonnes = colonnes.length;
    const champs = new Array(nbColonnes).fill('');
    champs[colonnes.indexOf('JournalCode')] = 'ACH';
    champs[colonnes.indexOf('JournalLib')] = 'Achats';
    champs[colonnes.indexOf('EcritureNum')] = 'AC0099';
    champs[colonnes.indexOf('EcritureDate')] = '20240115';
    champs[colonnes.indexOf('CompteNum')] = '60600';
    champs[colonnes.indexOf('Debit')]  = '0,00';
    champs[colonnes.indexOf('Credit')] = '0,00';
    // Pas de \n final après cette ligne
    const contenu = `${entete}\n${champs.join('\t')}`;

    const items = await collect(readFECLignes(contenu));
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('anomalie');
    expect(items[0].contexte.ecritureNum).toBe('AC0099');
  });
});

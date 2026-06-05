import { describe, it, expect } from 'vitest';
import { FECReader } from '../src/index.js';

describe('performance', () => {
  // Génère un fichier FEC volumineux pour les tests de performance
  const generateLargeFEC = (numRows) => {
    const T = '\t';
    const HEADER = [
      'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate',
      'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
      'PieceRef', 'PieceDate', 'EcritureLib',
      'Debit', 'Credit',
      'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
    ].join(T);

    const rows = [];
    for (let i = 0; i < numRows; i++) {
      const row = [
        'ACH', 'Achats', `AC${i.toString().padStart(5, '0')}`, '20240115',
        '60600', 'Fournitures', '', '',
        `FA${i.toString().padStart(6, '0')}`, '20240110', 'Achat fournitures',
        '100,00', '0,00', '', '', '', '', '',
      ].join(T);
      rows.push(row);
    }

    return [HEADER, ...rows].join('\n');
  };

  it('parse un fichier FEC avec 1000 lignes', () => {
    const largeFEC = generateLargeFEC(1000);
    const start = performance.now();
    const result = FECReader(largeFEC);
    const end = performance.now();

    expect(result.books['ACH'].lineCount).toBe(1000);
    console.log(`Parsing 1000 rows took ${end - start}ms`);
  });

  it('parse un fichier FEC avec 10000 lignes', () => {
    const largeFEC = generateLargeFEC(10000);
    const start = performance.now();
    const result = FECReader(largeFEC);
    const end = performance.now();

    expect(result.books['ACH'].lineCount).toBe(10000);
    console.log(`Parsing 10000 rows took ${end - start}ms`);
  });
});
import { describe, it, expect } from 'vitest';
import { FECReader } from '../src/index.js';

// Minimal valid FEC with French accents (é, è, ç) to verify encoding
const T = '\t';
const HEADER = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate',
  'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib',
  'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
].join(T);

const DATA_ROW = [
  'ACH', 'Achats', 'AC0001', '20240101',
  '60600', 'Fournitures générales', '', '',
  'FA001', '20240101', 'Achat équipement',
  '100,00', '0,00',
  '', '', '', '', '',
].join(T);

const FEC_TEXT = HEADER + '\n' + DATA_ROW;

// Encode a JS string to a specific encoding as a Uint8Array
function encodeAs(text, encoding) {
  return new TextEncoder().encode(
    new TextDecoder(encoding).decode(
      new TextEncoder().encode(text)
    )
  );
}

// Windows-1252 assigns printable characters to 0x80–0x9F (unlike ISO-8859-*)
// This table maps those Unicode codepoints back to their Windows-1252 byte value
const WIN1252_EXTRA = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
  [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
  [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
  [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
]);

// Build a Uint8Array in Windows-1252 from a JS string
function toWindows1252(text) {
  const bytes = [];
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp <= 0x7F)              bytes.push(cp);
    else if (WIN1252_EXTRA.has(cp)) bytes.push(WIN1252_EXTRA.get(cp));
    else if (cp <= 0xFF)         bytes.push(cp);
    else                         bytes.push(63); // '?' for unmappable
  }
  return new Uint8Array(bytes);
}

describe('FECReader — détection d\'encodage', () => {

  it('accepte un Buffer UTF-8 et préserve les accents', () => {
    const buffer = Buffer.from(FEC_TEXT, 'utf8');
    const result = FECReader(buffer);
    expect(result.Journaux['ACH']).toBeDefined();
    const ecritures = Object.values(result.Journaux['ACH'].Ecritures);
    const entry = ecritures.flatMap(e => e.Lignes)[0];
    expect(result.Comptes[entry.CompteNum].Libelle).toBe('Fournitures générales');
    expect(entry.EcritureLib).toBe('Achat équipement');
  });

  it('accepte un Buffer UTF-8 avec BOM et retire le BOM', () => {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const content = Buffer.from(FEC_TEXT, 'utf8');
    const buffer = Buffer.concat([bom, content]);
    const result = FECReader(buffer);
    expect(result.Journaux['ACH']).toBeDefined();
    const ecritures = Object.values(result.Journaux['ACH'].Ecritures);
    const entry = ecritures.flatMap(e => e.Lignes)[0];
    expect(result.Comptes[entry.CompteNum].Libelle).toBe('Fournitures générales');
  });

  it('accepte un Buffer Windows-1252 et préserve les accents', () => {
    const buffer = Buffer.from(toWindows1252(FEC_TEXT));
    const result = FECReader(buffer);
    expect(result.Journaux['ACH']).toBeDefined();
    const ecritures = Object.values(result.Journaux['ACH'].Ecritures);
    const entry = ecritures.flatMap(e => e.Lignes)[0];
    expect(result.Comptes[entry.CompteNum].Libelle).toBe('Fournitures générales');
    expect(entry.EcritureLib).toBe('Achat équipement');
  });

  it('accepte un Buffer Windows-1252 avec caractères 0x80–0x9F (€, –)', () => {
    const fecAvecEuro = HEADER + '\n' + [
      'ACH', 'Achats', 'AC0002', '20240101',
      '60600', 'Fournitures – bureau', '', '',
      'FA002', '20240101', 'Achat €',
      '100,00', '0,00',
      '', '', '', '', '',
    ].join(T);
    const buffer = Buffer.from(toWindows1252(fecAvecEuro));
    const result = FECReader(buffer);
    const ecritures = Object.values(result.Journaux['ACH'].Ecritures);
    const entry = ecritures.flatMap(e => e.Lignes)[0];
    expect(result.Comptes[entry.CompteNum].Libelle).toBe('Fournitures – bureau');
    expect(entry.EcritureLib).toBe('Achat €');
    expect(result.Metadonnees.Fichier.Encodage).toBe('Windows-1252');
  });

  it('accepte un ArrayBuffer', () => {
    const buf = Buffer.from(FEC_TEXT, 'utf8');
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const result = FECReader(arrayBuffer);
    expect(result.Journaux['ACH']).toBeDefined();
  });

  it('accepte un Uint8Array', () => {
    const uint8 = new TextEncoder().encode(FEC_TEXT);
    const result = FECReader(uint8);
    expect(result.Journaux['ACH']).toBeDefined();
  });

  it('lève une erreur pour un type d\'entrée invalide', () => {
    expect(() => FECReader(12345)).toThrow('FECReader : paramètre invalide');
    expect(() => FECReader({ text: FEC_TEXT })).toThrow('FECReader : paramètre invalide');
  });

});

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

// Build a Uint8Array in Windows-1252 from a JS string
function toWindows1252(text) {
  // TextEncoder only supports UTF-8 — encode manually for latin chars
  const bytes = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    bytes.push(code <= 0xFF ? code : 63); // '?' for unmappable
  }
  return new Uint8Array(bytes);
}

describe('FECReader — détection d\'encodage', () => {

  it('accepte un Buffer UTF-8 et préserve les accents', () => {
    const buffer = Buffer.from(FEC_TEXT, 'utf8');
    const result = FECReader(buffer);
    expect(result.books['ACH']).toBeDefined();
    const entry = Object.values(result.books['ACH'].entries)[0][0];
    expect(entry.CompteLib).toBe('Fournitures générales');
    expect(entry.EcritureLib).toBe('Achat équipement');
  });

  it('accepte un Buffer UTF-8 avec BOM et retire le BOM', () => {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const content = Buffer.from(FEC_TEXT, 'utf8');
    const buffer = Buffer.concat([bom, content]);
    const result = FECReader(buffer);
    expect(result.books['ACH']).toBeDefined();
    const entry = Object.values(result.books['ACH'].entries)[0][0];
    expect(entry.CompteLib).toBe('Fournitures générales');
  });

  it('accepte un Buffer Windows-1252 et préserve les accents', () => {
    const buffer = Buffer.from(toWindows1252(FEC_TEXT));
    const result = FECReader(buffer);
    expect(result.books['ACH']).toBeDefined();
    const entry = Object.values(result.books['ACH'].entries)[0][0];
    expect(entry.CompteLib).toBe('Fournitures générales');
    expect(entry.EcritureLib).toBe('Achat équipement');
  });

  it('accepte un ArrayBuffer', () => {
    const buf = Buffer.from(FEC_TEXT, 'utf8');
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const result = FECReader(arrayBuffer);
    expect(result.books['ACH']).toBeDefined();
  });

  it('accepte un Uint8Array', () => {
    const uint8 = new TextEncoder().encode(FEC_TEXT);
    const result = FECReader(uint8);
    expect(result.books['ACH']).toBeDefined();
  });

  it('lève une erreur pour un type d\'entrée invalide', () => {
    expect(() => FECReader(12345)).toThrow('FECReader : paramètre invalide');
    expect(() => FECReader({ text: FEC_TEXT })).toThrow('FECReader : paramètre invalide');
  });

});

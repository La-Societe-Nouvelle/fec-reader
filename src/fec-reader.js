// La Société Nouvelle

import booksProps from "./data/books.json" with { type: "json" };
import { mapAssetAccounts } from './asset-mapping.js';

const COLUMNS_PREFIX = [
  "JournalCode", "JournalLib", "EcritureNum", "EcritureDate",
  "CompteNum",  "CompteLib",   "CompAuxNum",  "CompAuxLib",
  "PieceRef",   "PieceDate",   "EcritureLib",
];
const COLUMNS_SUFFIX = [
  "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise",
];
const COLUMNS_FEC                 = [...COLUMNS_PREFIX, "Debit",   "Credit",   ...COLUMNS_SUFFIX];
const COLUMNS_FEC_WITH_DIRECTION  = [...COLUMNS_PREFIX, "Montant", "Sens",     ...COLUMNS_SUFFIX];

/**
 * Parse a FEC file (Fichier des Écritures Comptables) and return structured data.
 *
 * Accepted input types:
 *   - Buffer         : Node.js buffer — encoding auto-detected
 *   - ArrayBuffer    : browser FileReader result — encoding auto-detected
 *   - Uint8Array     : encoding auto-detected
 *   - string         : passed through as-is (no encoding conversion)
 *
 * Encoding detection order (spec DGFiP : ASCII | ISO 8859-15 | UTF-8) :
 *   1. UTF-8 BOM (EF BB BF) → UTF-8
 *   2. Valid UTF-8 (no replacement chars) → UTF-8
 *   3. Fallback → Windows-1252 (superset of ISO-8859-15/ISO-8859-1, covers Sage/EBP/Ciel)
 *
 * Accepted formats:
 *   - Separator : tab '\t' or pipe '|'
 *   - Columns   : standard Débit/Crédit or variant Montant/Sens
 *
 * @param {string|Buffer|ArrayBuffer|Uint8Array} input
 * @returns {{ books: Object, meta: Object }}
 * @throws {Error} If the file has an unrecognized separator or missing columns
 */
export function FECReader(input) {
  const content = decodeInput(input);
  const { separator, header, format, indexColumns } = parseHeader(content);
  const rows = content.slice(content.indexOf("\n") + 1).split("\n");
  const { journals, accounts, accountsAux, firstDate, lastDate } = collectData(rows, separator, header, indexColumns, format);
  return buildOutput(journals, accounts, accountsAux, firstDate, lastDate);
}

/**
 * Decode raw bytes to a string, auto-detecting encoding.
 * Strings are passed through without conversion.
 *
 * @param {string|Buffer|ArrayBuffer|Uint8Array} input
 * @returns {string}
 */
function decodeInput(input) {
  if (typeof input === "string") return input;

  let bytes;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
    bytes = new Uint8Array(input);
  } else {
    throw new Error("FECReader : paramètre invalide (string, Buffer ou ArrayBuffer attendu)");
  }

  // UTF-8 BOM
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder("utf-8").decode(bytes.slice(3));
  }

  // Valid UTF-8 — no replacement character means no invalid sequences
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) return utf8;

  // Fallback: Windows-1252 — compatible avec ISO 8859-15 (norme DGFiP).
  return new TextDecoder("windows-1252").decode(bytes);
}

/**
 * Extract separator, column list, format and index map from the first line of the file.
 * Throws if the separator is unrecognized or required columns are missing.
 *
 * @param {string} content
 * @returns {{ separator: string, header: string[], format: string, indexColumns: Object }}
 */
function parseHeader(content) {
  const firstLine = content.slice(0, content.indexOf("\n"));
  const separator = getSeparator(firstLine);

  const header = firstLine
    .replaceAll("\r", "")
    .replace("MontantDevise", "Montantdevise")
    .replace("IDevise", "Idevise")
    .split(separator);

  const format = header.includes("Montant") ? "withDirection" : "default";
  const expectedColumns = format === "default" ? COLUMNS_FEC : COLUMNS_FEC_WITH_DIRECTION;

  const missingColumns = expectedColumns.filter(col => !header.includes(col));
  if (missingColumns.length > 0) {
    throw new Error(`Fichier erroné (libellé(s) manquant(s) : ${missingColumns.join(', ')})`);
  }

  const indexColumns = Object.fromEntries(header.map((col, idx) => [col, idx]));

  return { separator, header, format, indexColumns };
}

/**
 * Iterate over all data rows and accumulate journals, accounts and period boundaries.
 *
 * @param {string[]} rows
 * @param {string} separator
 * @param {string[]} header
 * @param {Object} indexColumns - Column name → index map
 * @param {string} format - 'default' | 'withDirection'
 * @returns {{ journals: Object, accounts: Object, accountsAux: Object, firstDate: string|null, lastDate: string|null }}
 */
function collectData(rows, separator, header, indexColumns, format) {
  const journals = {};
  const accounts = {};
  const accountsAux = {};
  let firstDate = null;
  let lastDate = null;

  rows.forEach((rowString, index) => {
    const row = rowString.replace("\r", "").split(separator);

    if (row.length !== header.length) {
      if (rowString.trim() !== "") throw new Error(`Erreur - Ligne incomplète (${index + 2})`);
      return;
    }

    const rowData = parseRow(indexColumns, row, format);
    const { JournalCode, JournalLib, EcritureNum, EcritureDate, CompteNum, CompteLib, CompAuxNum, CompAuxLib } = rowData;

    // Journal
    if (!(JournalCode in journals)) {
      journals[JournalCode] = {
        label: JournalLib,
        type: classifyBook(JournalCode, JournalLib),
        lineCount: 0,
        lastDate: null,
        entries: {},
      };
    }
    const journal = journals[JournalCode];
    if (!journal.entries[EcritureNum]) journal.entries[EcritureNum] = [];
    journal.entries[EcritureNum].push(rowData);
    journal.lineCount++;
    if (journal.lastDate === null || EcritureDate > journal.lastDate) journal.lastDate = EcritureDate;

    // Accounts
    if (!(CompteNum in accounts)) {
      accounts[CompteNum] = { accountNum: CompteNum, accountLib: CompteLib };
    }
    if (CompAuxNum && !(CompAuxNum in accountsAux)) {
      accountsAux[CompAuxNum] = { accountNum: CompAuxNum, accountLib: CompAuxLib };
    }

    // Period
    if (firstDate === null || EcritureDate < firstDate) firstDate = EcritureDate;
    if (lastDate === null || EcritureDate > lastDate) lastDate = EcritureDate;
  });

  return { journals, accounts, accountsAux, firstDate, lastDate };
}

/**
 * Assemble the final output structure from accumulated data.
 * Applies asset account mapping. All dates are kept in source format (YYYYMMDD).
 *
 * @param {Object} journals
 * @param {Object} accounts
 * @param {Object} accountsAux
 * @param {string|null} firstDate - Earliest EcritureDate seen (YYYYMMDD)
 * @param {string|null} lastDate  - Latest EcritureDate seen (YYYYMMDD)
 * @returns {{ books: Object, meta: Object }}
 */
function buildOutput(journals, accounts, accountsAux, firstDate, lastDate) {
  const books = {};
  for (const [code, journal] of Object.entries(journals)) {
    books[code] = {
      label: journal.label,
      type: journal.type,
      lineCount: journal.lineCount,
      lastDate: journal.lastDate,
      entries: journal.entries,
    };
  }

  return {
    books,
    meta: {
      accounts: mapAssetAccounts(accounts),
      accountsAux,
      period: {
        firstDate,
        lastDate,
      },
    },
  };
}

/**
 * Parse a single data row into a keyed object.
 * Strips surrounding quotes and whitespace from each field.
 * Converts Montant/Sens to Debit/Credit for withDirection format.
 * Parses Debit and Credit as numbers.
 *
 * @param {Object} indexColumns - Column name → index map
 * @param {string[]} row
 * @param {string} format - 'default' | 'withDirection'
 * @returns {Object}
 */
function parseRow(indexColumns, row, format) {
  const rowData = Object.fromEntries(
    Object.entries(indexColumns).map(([col, idx]) => [
      col,
      row[idx]
        .replace(/^"/, "")
        .replace(/"$/, "")
        .replace(/^\s+|\s+$/, ""),
    ])
  );

  if (format === "withDirection") {
    rowData.Debit = rowData.Sens === "D" ? rowData.Montant : "0,00";
    rowData.Credit = rowData.Sens === "C" ? rowData.Montant : "0,00";
    delete rowData.Montant;
    delete rowData.Sens;
  }

  rowData.Debit = parseAmount(rowData.Debit);
  rowData.Credit = parseAmount(rowData.Credit);

  return rowData;
}

/**
 * Detect the field separator from the header line.
 * @param {string} firstLine
 * @returns {'\t' | '|'}
 * @throws {string} If neither tab nor pipe is found
 */
function getSeparator(firstLine) {
  if (firstLine.includes("\t")) return "\t";
  if (firstLine.includes("|")) return "|";
  throw new Error("Séparateur non reconnu (attendu : tabulation ou pipe)");
}

const parseAmount = (str) => parseFloat(str.replace(',', '.'));

/**
 * Classify a journal by its code and label against known book types.
 * @param {string} bookCode
 * @param {string} bookLib
 * @returns {'ANOUVEAUX' | 'VENTES' | 'ACHATS' | 'OPERATIONS' | 'AUTRE'}
 */
function classifyBook(bookCode, bookLib) {
  const lib = bookLib.toUpperCase();
  if (booksProps.ANOUVEAUX.codes.includes(bookCode) || booksProps.ANOUVEAUX.labels.includes(lib)) return "ANOUVEAUX";
  if (booksProps.VENTES.codes.includes(bookCode)    || booksProps.VENTES.labels.includes(lib))    return "VENTES";
  if (booksProps.ACHATS.codes.includes(bookCode)    || booksProps.ACHATS.labels.includes(lib))    return "ACHATS";
  if (booksProps.OPERATIONS.codes.includes(bookCode)|| booksProps.OPERATIONS.labels.includes(lib))return "OPERATIONS";
  return "AUTRE";
}

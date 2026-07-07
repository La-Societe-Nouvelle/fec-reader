/**
 * FEC Reader
 * Part of @lasocietenouvelle/fec-reader
 * https://github.com/La-Societe-Nouvelle/fec-reader
 * License: EUPL-1.2
 */

const COLONNES_PREFIXE = [
  "JournalCode", "JournalLib", "EcritureNum", "EcritureDate",
  "CompteNum",  "CompteLib",   "CompAuxNum",  "CompAuxLib",
  "PieceRef",   "PieceDate",   "EcritureLib",
];
const COLONNES_SUFFIXE = [
  "EcritureLet", "DateLet", "ValidDate", "MontantDevise", "IDevise",
];
const COLONNES_FEC            = [...COLONNES_PREFIXE, "Debit",   "Credit",   ...COLONNES_SUFFIXE];
const COLONNES_FEC_AVEC_SENS  = [...COLONNES_PREFIXE, "Montant", "Sens",     ...COLONNES_SUFFIXE];

// Champs disponibles pour l'option `champs` (clés possibles d'une ligne construite,
// dans l'ordre canonique utilisé pour la construction — cf. buildRow).
const CHAMPS_LIGNE_DISPONIBLES = [
  "CompteNum", "CompAuxNum", "PieceRef", "PieceDate", "EcritureLib",
  "Debit", "Credit",
  "EcritureLet", "DateLet", "ValidDate", "MontantDevise", "IDevise",
  "CompteLib", "CompAuxLib",
];

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
 *   1. UTF-8 BOM (EF BB BF) → UTF-8 BOM
 *   2. Valid UTF-8 (no replacement chars) → UTF-8
 *   3. Fallback → Windows-1252 (superset of ISO-8859-15/ISO-8859-1, covers Sage/EBP/Ciel)
 *
 * Accepted formats:
 *   - Separator : tab '\t' or pipe '|'
 *   - Columns   : standard Débit/Crédit or variant Montant/Sens
 *
 * @param {string|Buffer|ArrayBuffer|Uint8Array} input
 * @param {Object} [options]
 * @param {boolean} [options.lignes=true] - If false, rows are not materialized into
 *   `Ecritures[num].Lignes[]` (only the existing aggregates are kept). Significantly
 *   reduces retained memory on large files.
 * @param {(ligne: Object, contexte: Object) => void} [options.onLigne] - Callback invoked
 *   for each row, with a cleaned context (`journalCode`, `journalLib`, `ecritureNum`,
 *   `ecritureDate`, `compteNum`, `compAuxNum`). Never triggers construction of `Lignes[]`.
 *   The row includes `CompteLib`/`CompAuxLib` (absent in classic `Lignes[]` mode, but
 *   useful here since nothing is retained after the call).
 * @param {string} [options.nomFichier] - Original filename (e.g. "552100554FEC20231231.txt").
 *   If provided, the SIREN and fiscal year-end date are extracted from the name (DGFiP
 *   convention: `<Siren>FEC<AAAAMMJJ>`) and exposed in `Metadonnees.Fichier`. Does not
 *   affect content parsing.
 * @param {string[]} [options.champs] - Whitelist of fields to build for each row
 *   (`Lignes[]` or the `onLigne` argument). Among: `CompteNum`, `CompAuxNum`,
 *   `PieceRef`, `PieceDate`, `EcritureLib`, `Debit`, `Credit`, `EcritureLet`, `DateLet`,
 *   `ValidDate`, `MontantDevise`, `IDevise`, `CompteLib`, `CompAuxLib`. If not provided,
 *   all fields are built (historical behavior). An unknown field name throws.
 *   `CompteLib`/`CompAuxLib` explicitly requested always win over the usual
 *   auto-exclusion in `lignes: true` mode.
 * @returns {{ Journaux: Object, Comptes: Object, ComptesAux: Object, Anomalies: Object[], Metadonnees: Object }}
 * @throws {Error} If the file has an unrecognized separator or missing header columns
 *   (unrecoverable — nothing can be parsed). Malformed individual rows do not throw:
 *   they are skipped and reported in `Anomalies`.
 */
export function FECReader(input, options = {}) {
  const { lignes = true, onLigne = null, nomFichier = null, champs = null } = options;
  const champsSet = validateFields(champs);
  const { content, encoding } = decodeInput(input);
  const { separateur, header, format, columnIndexes } = parseHeader(content);
  const { journaux, comptes, comptesAux, firstDate, lastDate, anomalies } = collectData(content, separateur, header, columnIndexes, format, { lignes, onLigne, champsSet });
  const { siren, clotureExercice } = parseFilename(nomFichier);
  return buildOutput(journaux, comptes, comptesAux, anomalies, firstDate, lastDate, encoding, separateur, format, siren, clotureExercice);
}

/**
 * Stream FEC rows as an async iterator of batches, yielding periodically to
 * the event loop so a large file does not block a shared-process server.
 *
 * Unlike `FECReader`, this builds no aggregate: no `Journaux`, `Comptes`,
 * `ComptesAux`, or return value. Each yielded batch is an array of up to
 * `intervalleCedeMain` items, each either:
 *   - `{ ligne, contexte }` for a valid row (same shape as `onLigne`'s arguments)
 *   - `{ anomalie: { Ligne, Message } }` for a malformed row (skipped, not thrown)
 *
 * Rows are NOT yielded one at a time: an async generator's `.next()` always
 * returns a Promise, so a `for await` consuming one item per row pays that
 * promise-resolution cost once per row. Under a request-scoped
 * `AsyncLocalStorage` context (e.g. a Next.js Server Action) that cost is
 * amplified — each continuation must restore the ALS context — and at
 * hundreds of thousands of rows this made per-row yielding measurably slower
 * and less stable than batching (regression found and fixed 2026-07-07; see
 * CHANGELOG.md [2.0.0-beta.1] for the measurements). Batching
 * reduces the number of suspension points from one per row to one per
 * `intervalleCedeMain` rows.
 *
 * Header errors (unrecognized separator, missing required columns) throw
 * synchronously on the first `.next()` call, before any yield — same
 * unrecoverable-error contract as `FECReader`.
 *
 * Node.js only — uses `setImmediate` internally, not available in browsers,
 * unlike `FECReader`.
 *
 * @param {string|Buffer|ArrayBuffer|Uint8Array} input
 * @param {Object} [options]
 * @param {string[]} [options.champs] - Same whitelist as `FECReader`'s `options.champs`.
 * @param {number} [options.intervalleCedeMain=1000] - Number of rows per yielded
 *   batch, and number of rows between two `await setImmediate` yields to the event loop.
 * @returns {AsyncGenerator<Array<{ligne: Object, contexte: Object}|{anomalie: {Ligne: number, Message: string}}>>}
 * @throws {Error} If the file has an unrecognized separator or missing header columns.
 */
export async function* readFECLignes(input, options = {}) {
  const { champs = null, intervalleCedeMain = 1000 } = options;
  const champsSet = validateFields(champs);
  const { content } = decodeInput(input);
  const { separateur, header, format, columnIndexes } = parseHeader(content);

  const iJournalCode  = columnIndexes["JournalCode"];
  const iJournalLib   = columnIndexes["JournalLib"];
  const iEcritureNum  = columnIndexes["EcritureNum"];
  const iEcritureDate = columnIndexes["EcritureDate"];
  const iCompteNum    = columnIndexes["CompteNum"];
  const iCompAuxNum   = columnIndexes["CompAuxNum"];

  const clean = (s) => (!s ? "" : s.replace(/^[\s"]+|[\s"]+$/g, ""));

  const lineIndex = {
    compteNum:     iCompteNum,
    compAuxNum:    iCompAuxNum,
    compteLib:     columnIndexes["CompteLib"],
    compAuxLib:    columnIndexes["CompAuxLib"],
    pieceRef:      columnIndexes["PieceRef"],
    pieceDate:     columnIndexes["PieceDate"],
    ecritureLib:   columnIndexes["EcritureLib"],
    debit:         columnIndexes["Debit"],
    credit:        columnIndexes["Credit"],
    montant:       columnIndexes["Montant"],
    sens:          columnIndexes["Sens"],
    ecritureLet:   columnIndexes["EcritureLet"],
    dateLet:       columnIndexes["DateLet"],
    validDate:     columnIndexes["ValidDate"],
    montantDevise: columnIndexes["MontantDevise"],
    iDevise:       columnIndexes["IDevise"],
  };

  const firstNewlineIndex = content.indexOf("\n");
  let lineStart = firstNewlineIndex + 1;
  let lineIndexCounter = 0;
  let batch = [];

  while (lineStart < content.length) {
    let lineEnd = content.indexOf("\n", lineStart);
    if (lineEnd === -1) lineEnd = content.length;

    const rawLine = content.slice(lineStart, lineEnd).replace("\r", "");
    lineStart = lineEnd + 1;
    lineIndexCounter++;

    if (rawLine === "") continue;

    const rowFields = rawLine.split(separateur);

    const messageAnomalie = validateRowColumns(rowFields, header, lineIndexCounter);
    if (messageAnomalie) {
      batch.push({ anomalie: { Ligne: lineIndexCounter + 1, Message: messageAnomalie } });
    } else {
      const ligne = buildRow(rowFields, clean, lineIndex, false, champsSet, format);
      const contexte = buildContext(rowFields, clean, {
        iJournalCode, iJournalLib, iEcritureNum, iEcritureDate, iCompteNum, iCompAuxNum,
      });
      batch.push({ ligne, contexte });
    }

    if (batch.length >= intervalleCedeMain) {
      yield batch;
      batch = [];
      await new Promise(setImmediate);
    }
  }

  if (batch.length > 0) yield batch;
}

/**
 * Reconcile a row's column count against the header, tolerating 1-2 missing
 * trailing columns (some software omits the final separator when there's no
 * currency). Mutates `rowFields` in place when padding is applied.
 *
 * @param {string[]} rowFields
 * @param {string[]} header
 * @param {number} lineIndex - 1-indexed line number (before the +1 used in messages)
 * @returns {string|null} An anomaly message if the row cannot be reconciled, else `null`.
 */
function validateRowColumns(rowFields, header, lineIndex) {
  if (rowFields.length < header.length && rowFields.length >= header.length - 2) {
    while (rowFields.length < header.length) rowFields.push("");
  }

  if (rowFields.length === header.length) return null;

  const missing = rowFields.length < header.length ? header.slice(rowFields.length) : [];
  const extra    = rowFields.length > header.length ? rowFields.length - header.length : 0;
  if (missing.length >= header.length / 2) {
    return `Le fichier FEC semble corrompu ou mal exporté (ligne ${lineIndex + 1} : ${rowFields.length} colonne(s) lue(s) sur ${header.length} attendues). Essayez de le ré-exporter depuis votre logiciel comptable.`;
  } else if (missing.length > 0) {
    return `Fichier FEC incomplet — colonne(s) manquante(s) à la ligne ${lineIndex + 1} : ${missing.join(", ")}. Vérifiez le format d'export.`;
  }
  return `Fichier FEC invalide — trop de colonnes à la ligne ${lineIndex + 1} (${extra} colonne(s) en trop). Vérifiez le format d'export.`;
}

/**
 * Build the per-row context object (journal/écriture/compte identifiers) shared
 * between `collectData`'s `onLigne` callback and `readFECLignes`'s yielded item.
 *
 * @param {string[]} rowFields
 * @param {Function} clean
 * @param {Object} contextIdx - `{ iJournalCode, iJournalLib, iEcritureNum, iEcritureDate, iCompteNum, iCompAuxNum }`
 * @returns {{ journalCode: string, journalLib: string, ecritureNum: string, ecritureDate: string, compteNum: string, compAuxNum: string }}
 */
function buildContext(rowFields, clean, contextIdx) {
  return {
    journalCode:  clean(rowFields[contextIdx.iJournalCode]),
    journalLib:   clean(rowFields[contextIdx.iJournalLib]),
    ecritureNum:  clean(rowFields[contextIdx.iEcritureNum]),
    ecritureDate: clean(rowFields[contextIdx.iEcritureDate]),
    compteNum:    clean(rowFields[contextIdx.iCompteNum]),
    compAuxNum:   clean(rowFields[contextIdx.iCompAuxNum]),
  };
}

/**
 * Validate `options.champs` against the known set of row field names.
 *
 * @param {string[]|null} fields
 * @returns {Set<string>|null} `null` when `fields` is not provided (all fields kept).
 * @throws {Error} If `fields` contains an unknown field name.
 */
function validateFields(fields) {
  if (fields === null) return null;
  if (fields.length === 0) {
    throw new Error('FECReader : l\'option champs ne peut pas être un tableau vide');
  }
  const invalides = fields.filter((c) => !CHAMPS_LIGNE_DISPONIBLES.includes(c));
  if (invalides.length > 0) {
    throw new Error(`FECReader : champ(s) invalide(s) dans l'option champs : ${invalides.join(', ')}`);
  }
  return new Set(fields);
}

/**
 * Extract SIREN and fiscal year-end date from a FEC filename, per the DGFiP
 * naming convention `<Siren>FEC<AAAAMMJJ>[...]`.
 *
 * @param {string|null} filename
 * @returns {{ siren: string|null, clotureExercice: string|null }}
 */
function parseFilename(filename) {
  if (!filename) return { siren: null, clotureExercice: null };
  const correspondance = /(\d{9,14})FEC(\d{8})/i.exec(filename);
  if (!correspondance) return { siren: null, clotureExercice: null };
  return { siren: correspondance[1], clotureExercice: correspondance[2] };
}

/**
 * Decode raw bytes to a string, auto-detecting encoding.
 * Strings are passed through without conversion.
 *
 * @param {string|Buffer|ArrayBuffer|Uint8Array} input
 * @returns {{ content: string, encoding: string }}
 */
function decodeInput(input) {
  if (typeof input === "string") return { content: input, encoding: "UTF-8" };

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
    return { content: new TextDecoder("utf-8").decode(bytes.slice(3)), encoding: "UTF-8 BOM" };
  }

  // Valid UTF-8 — strict decode throws on any invalid byte sequence
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { content: utf8, encoding: "UTF-8" };
  } catch {
    // Fallback: Windows-1252 — compatible avec ISO 8859-15 (norme DGFiP).
    return { content: new TextDecoder("windows-1252").decode(bytes), encoding: "Windows-1252" };
  }
}

/**
 * Extract separator, column list, format and index map from the first line of the file.
 * Throws if the separator is unrecognized or required columns are missing.
 *
 * @param {string} content
 * @returns {{ separateur: string, header: string[], format: string, columnIndexes: Object }}
 */
function parseHeader(content) {
  const firstLine = content.slice(0, content.indexOf("\n"));
  const separateur = getSeparator(firstLine);

  const header = firstLine
    .replaceAll("\r", "")
    .replace("Montantdevise", "MontantDevise")
    .replace("Idevise", "IDevise")
    .split(separateur);

  const format = header.includes("Montant") ? "avecSens" : "standard";
  const expectedColumns = format === "standard" ? COLONNES_FEC : COLONNES_FEC_AVEC_SENS;

  const missingColumns = expectedColumns.filter(col => !header.includes(col));
  if (missingColumns.length > 0) {
    throw new Error(`Fichier erroné (libellé(s) manquant(s) : ${missingColumns.join(', ')})`);
  }

  const columnIndexes = Object.fromEntries(header.map((col, idx) => [col, idx]));

  return { separateur, header, format, columnIndexes };
}

/**
 * Iterate over all data rows and accumulate journals, accounts and period boundaries.
 * Processes line-by-line via indexOf to avoid allocating a full split("\n") array.
 *
 * @param {string} content
 * @param {string} separateur
 * @param {string[]} header
 * @param {Object} columnIndexes - Column name → index map
 * @param {string} format - 'standard' | 'avecSens'
 * @param {Object} options
 * @param {boolean} options.lignes - If false (and no onLigne), rows are neither parsed nor retained.
 * @param {(ligne: Object, contexte: Object) => void} options.onLigne - Per-row callback; if provided, rows are not retained.
 * @returns {{ journaux: Object, comptes: Object, comptesAux: Object, anomalies: Object[], firstDate: string|null, lastDate: string|null }}
 */
function collectData(content, separateur, header, columnIndexes, format, { lignes, onLigne, champsSet }) {
  const keepLines = lignes && !onLigne;
  const dataRequired = keepLines || !!onLigne;

  const journaux   = {};
  const comptes    = {};
  const comptesAux = {};
  const anomalies  = [];
  let firstDate = null;
  let lastDate = null;

  const iJournalCode  = columnIndexes["JournalCode"];
  const iJournalLib   = columnIndexes["JournalLib"];
  const iEcritureNum  = columnIndexes["EcritureNum"];
  const iEcritureDate = columnIndexes["EcritureDate"];
  const iCompteNum    = columnIndexes["CompteNum"];
  const iCompteLib    = columnIndexes["CompteLib"];
  const iCompAuxNum   = columnIndexes["CompAuxNum"];
  const iCompAuxLib   = columnIndexes["CompAuxLib"];

  // Early-exit on empty string: even a regex on "" has a non-zero setup cost, and
  // many FEC fields (CompAuxNum, MontantDevise, IDevise...) are empty on most rows.
  const clean = (s) => (!s ? "" : s.replace(/^[\s"]+|[\s"]+$/g, ""));

  // Row constructor selected once per file (format and keepLines are invariant
  // for the whole parse) : each row then produces a fixed-shape object literal,
  // with no `delete`, letting V8 keep a stable hidden class instead of falling
  // back to dictionary mode on every row.
  const lineIndex = {
    compteNum:     iCompteNum,
    compAuxNum:    iCompAuxNum,
    compteLib:     iCompteLib,
    compAuxLib:    iCompAuxLib,
    pieceRef:      columnIndexes["PieceRef"],
    pieceDate:     columnIndexes["PieceDate"],
    ecritureLib:   columnIndexes["EcritureLib"],
    debit:         columnIndexes["Debit"],
    credit:        columnIndexes["Credit"],
    montant:       columnIndexes["Montant"],
    sens:          columnIndexes["Sens"],
    ecritureLet:   columnIndexes["EcritureLet"],
    dateLet:       columnIndexes["DateLet"],
    validDate:     columnIndexes["ValidDate"],
    montantDevise: columnIndexes["MontantDevise"],
    iDevise:       columnIndexes["IDevise"],
  };
  const buildRowFn = dataRequired
    ? (fields, clean, idx, keepLines) => buildRow(fields, clean, idx, keepLines, champsSet, format)
    : null;

  const firstNewlineIndex = content.indexOf("\n");
  let lineStart = firstNewlineIndex + 1;
  let lineIndexCounter = 0;

  while (lineStart < content.length) {
    let lineEnd = content.indexOf("\n", lineStart);
    if (lineEnd === -1) lineEnd = content.length;

    const rawLine = content.slice(lineStart, lineEnd).replace("\r", "");
    lineStart = lineEnd + 1;
    lineIndexCounter++;

    if (rawLine === "") continue;

    const rowFields = rawLine.split(separateur);

    // Tolerate lines missing 1-2 trailing columns (some software omits final separator when no currency)
    const messageAnomalie = validateRowColumns(rowFields, header, lineIndexCounter);
    if (messageAnomalie) {
      anomalies.push({ Ligne: lineIndexCounter + 1, Message: messageAnomalie });
      continue;
    }

    const data = dataRequired ? buildRowFn(rowFields, clean, lineIndex, keepLines) : null;

    const { journalCode, journalLib, ecritureNum, ecritureDate, compteNum, compAuxNum } =
      buildContext(rowFields, clean, { iJournalCode, iJournalLib, iEcritureNum, iEcritureDate, iCompteNum, iCompAuxNum });
    const compteLib  = clean(rowFields[iCompteLib]);
    const compAuxLib = clean(rowFields[iCompAuxLib]);

    // Journal
    if (!(journalCode in journaux)) {
      journaux[journalCode] = {
        Libelle:   journalLib,
        NombreEcritures: 0,
        NombreLignes: 0,
        DerniereDate: null,
        Ecritures:    {},
      };
    }
    const journal = journaux[journalCode];
    if (!journal.Ecritures[ecritureNum]) {
      journal.Ecritures[ecritureNum] = keepLines
        ? { EcritureDate: ecritureDate, Lignes: [] }
        : { EcritureDate: ecritureDate };
      journal.NombreEcritures++;
      if (journal.DerniereDate === null || ecritureDate > journal.DerniereDate) journal.DerniereDate = ecritureDate;
    }
    if (keepLines) {
      journal.Ecritures[ecritureNum].Lignes.push(data);
    }
    if (onLigne) {
      onLigne(data, { journalCode, journalLib, ecritureNum, ecritureDate, compteNum, compAuxNum });
    }
    journal.NombreLignes++;

    // Comptes
    if (!(compteNum in comptes)) {
      comptes[compteNum] = { Libelle: compteLib };
    }
    if (compAuxNum && !(compAuxNum in comptesAux)) {
      comptesAux[compAuxNum] = { Libelle: compAuxLib };
    }

    // Période
    if (firstDate === null || ecritureDate < firstDate) firstDate = ecritureDate;
    if (lastDate === null || ecritureDate > lastDate) lastDate = ecritureDate;
  }

  return { journaux, comptes, comptesAux, anomalies, firstDate, lastDate };
}

/**
 * Assemble the final output structure from accumulated data.
 * All dates are kept in source format (YYYYMMDD).
 *
 * @param {Object} journaux
 * @param {Object} comptes
 * @param {Object} comptesAux
 * @param {Object[]} anomalies - Malformed rows skipped during parsing ({ Ligne, Message })
 * @param {string|null} firstDate - Earliest EcritureDate seen (YYYYMMDD)
 * @param {string|null} lastDate - Latest EcritureDate seen (YYYYMMDD)
 * @param {string} encoding - Detected encoding
 * @param {string} separateur - Field separator used
 * @param {string} format - 'standard' | 'avecSens'
 * @param {string|null} siren - SIREN extracted from the original filename, if provided
 * @param {string|null} clotureExercice - Fiscal year-end date (YYYYMMDD) extracted from
 *   the original filename, if provided
 * @returns {{ Journaux: Object, Comptes: Object, ComptesAux: Object, Anomalies: Object[], Metadonnees: Object }}
 */
function buildOutput(journaux, comptes, comptesAux, anomalies, firstDate, lastDate, encoding, separateur, format, siren, clotureExercice) {
  return {
    Journaux: journaux,
    Comptes: comptes,
    ComptesAux: comptesAux,
    Anomalies: anomalies,
    Metadonnees: {
      Periode: {
        DateDebut: firstDate,
        DateFin: lastDate,
      },
      Fichier: {
        Encodage: encoding,
        Separateur: separateur,
        Format: format,
        Siren: siren,
        ClotureExercice: clotureExercice,
      },
    },
  };
}

/**
 * Build a data row object, honoring the `champs` whitelist.
 *
 * Follows a fixed canonical order of `if (include(...))` checks, always run in the
 * same sequence for a given `fieldsSet`/`format`/`keepLines` (all invariant for
 * the whole file) — the object shape never varies from one row to the next, letting
 * V8 keep the same hidden class across all rows.
 *
 * `CompteLib`/`CompAuxLib` follow a special rule: with no `fieldsSet` (default, all
 * fields), they are omitted when `keepLines` (already available via `Comptes`/
 * `ComptesAux`) and included otherwise (`onLigne` mode, row never retained). When
 * `fieldsSet` is explicit, it always wins over that default — the caller's choice.
 *
 * @param {string[]} fields
 * @param {Function} clean - Field cleaner (strips quotes and whitespace)
 * @param {Object} idx - Column index map (see `lineIndex` in collectData)
 * @param {boolean} keepLines
 * @param {Set<string>|null} fieldsSet - Field whitelist (`options.champs`), or `null` for all fields
 * @param {string} format - 'standard' | 'avecSens'
 * @returns {Object}
 */
function buildRow(fields, clean, idx, keepLines, fieldsSet, format) {
  const include = (name) => fieldsSet === null || fieldsSet.has(name);
  const data = {};

  if (include("CompteNum"))   data.CompteNum   = clean(fields[idx.compteNum]);
  if (include("CompAuxNum"))  data.CompAuxNum  = clean(fields[idx.compAuxNum]);
  if (include("PieceRef"))    data.PieceRef    = clean(fields[idx.pieceRef]);
  if (include("PieceDate"))   data.PieceDate   = clean(fields[idx.pieceDate]);
  if (include("EcritureLib")) data.EcritureLib = clean(fields[idx.ecritureLib]);

  if (include("Debit") || include("Credit")) {
    if (format === "avecSens") {
      const sens    = clean(fields[idx.sens]);
      const montant = clean(fields[idx.montant]);
      if (include("Debit"))  data.Debit  = parseAmount(sens === "D" ? montant : "0,00");
      if (include("Credit")) data.Credit = parseAmount(sens === "C" ? montant : "0,00");
    } else {
      if (include("Debit"))  data.Debit  = parseAmount(clean(fields[idx.debit]));
      if (include("Credit")) data.Credit = parseAmount(clean(fields[idx.credit]));
    }
  }

  if (include("EcritureLet"))   data.EcritureLet   = clean(fields[idx.ecritureLet]);
  if (include("DateLet"))       data.DateLet       = clean(fields[idx.dateLet]);
  if (include("ValidDate"))     data.ValidDate     = clean(fields[idx.validDate]);
  if (include("MontantDevise")) data.MontantDevise = clean(fields[idx.montantDevise]);
  if (include("IDevise"))       data.IDevise       = clean(fields[idx.iDevise]);

  const includeCompteLib  = fieldsSet === null ? !keepLines : fieldsSet.has("CompteLib");
  const includeCompAuxLib = fieldsSet === null ? !keepLines : fieldsSet.has("CompAuxLib");
  if (includeCompteLib)  data.CompteLib  = clean(fields[idx.compteLib]);
  if (includeCompAuxLib) data.CompAuxLib = clean(fields[idx.compAuxLib]);

  return data;
}

/**
 * Detect the field separator from the header line.
 * @param {string} firstLine
 * @returns {'\t' | '|'}
 * @throws {Error} If neither tab nor pipe is found
 */
function getSeparator(firstLine) {
  if (firstLine.includes("\t")) return "\t";
  if (firstLine.includes("|")) return "|";
  throw new Error("Séparateur non reconnu (attendu : tabulation ou pipe)");
}

const parseAmount = (str) => {
  if (!str || str.trim() === '') return 0;
  return parseFloat(str.replace(',', '.'));
};

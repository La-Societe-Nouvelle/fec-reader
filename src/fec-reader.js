// La Société Nouvelle

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
// dans l'ordre canonique utilisé pour la construction — cf. construireLigne).
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
 * @param {string} [options.nomFichier] - Nom du fichier d'origine (ex: "552100554FEC20231231.txt").
 *   Si fourni, le SIREN et la date de clôture d'exercice sont extraits du nom (norme
 *   DGFiP : `<Siren>FEC<AAAAMMJJ>`) et exposés dans `Metadonnees.Fichier`. N'affecte pas
 *   le parsing du contenu.
 * @param {string[]} [options.champs] - Liste blanche des champs à construire pour chaque
 *   ligne (`Lignes[]` ou argument de `onLigne`). Parmi : `CompteNum`, `CompAuxNum`,
 *   `PieceRef`, `PieceDate`, `EcritureLib`, `Debit`, `Credit`, `EcritureLet`, `DateLet`,
 *   `ValidDate`, `MontantDevise`, `IDevise`, `CompteLib`, `CompAuxLib`. Si non fourni, tous
 *   les champs sont construits (comportement historique). Un nom de champ inconnu lève une
 *   erreur. `CompteLib`/`CompAuxLib` explicitement demandés priment toujours sur
 *   l'auto-exclusion habituelle en mode `lignes: true`.
 * @returns {{ journaux: Object, comptes: Object, comptesAux: Object, anomalies: Object[], meta: Object }}
 * @throws {Error} If the file has an unrecognized separator or missing header columns
 *   (unrecoverable — nothing can be parsed). Malformed individual rows do not throw:
 *   they are skipped and reported in `Anomalies`.
 */
export function FECReader(input, options = {}) {
  const { lignes = true, onLigne = null, nomFichier = null, champs = null } = options;
  const champsSet = validerChamps(champs);
  const { contenu, encodage } = decodeInput(input);
  const { separateur, entete, format, indexColonnes } = parseHeader(contenu);
  const { journaux, comptes, comptesAux, premiereDate, derniereDate, anomalies } = collectData(contenu, separateur, entete, indexColonnes, format, { lignes, onLigne, champsSet });
  const { siren, clotureExercice } = parseNomFichier(nomFichier);
  return buildOutput(journaux, comptes, comptesAux, anomalies, premiereDate, derniereDate, encodage, separateur, format, siren, clotureExercice);
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
 * and less stable than batching (regression found and fixed 2026-07-07, see
 * `docs/superpowers/specs/2026-07-07-fec-lignes-async-design.md`). Batching
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
export async function* FECLignesAsync(input, options = {}) {
  const { champs = null, intervalleCedeMain = 1000 } = options;
  const champsSet = validerChamps(champs);
  const { contenu } = decodeInput(input);
  const { separateur, entete, format, indexColonnes } = parseHeader(contenu);

  const iJournalCode  = indexColonnes["JournalCode"];
  const iJournalLib   = indexColonnes["JournalLib"];
  const iEcritureNum  = indexColonnes["EcritureNum"];
  const iEcritureDate = indexColonnes["EcritureDate"];
  const iCompteNum    = indexColonnes["CompteNum"];
  const iCompAuxNum   = indexColonnes["CompAuxNum"];

  const nettoyer = (s) => (!s ? "" : s.replace(/^[\s"]+|[\s"]+$/g, ""));

  const indexLigne = {
    compteNum:     iCompteNum,
    compAuxNum:    iCompAuxNum,
    compteLib:     indexColonnes["CompteLib"],
    compAuxLib:    indexColonnes["CompAuxLib"],
    pieceRef:      indexColonnes["PieceRef"],
    pieceDate:     indexColonnes["PieceDate"],
    ecritureLib:   indexColonnes["EcritureLib"],
    debit:         indexColonnes["Debit"],
    credit:        indexColonnes["Credit"],
    montant:       indexColonnes["Montant"],
    sens:          indexColonnes["Sens"],
    ecritureLet:   indexColonnes["EcritureLet"],
    dateLet:       indexColonnes["DateLet"],
    validDate:     indexColonnes["ValidDate"],
    montantDevise: indexColonnes["MontantDevise"],
    iDevise:       indexColonnes["IDevise"],
  };

  const premierSautLigne = contenu.indexOf("\n");
  let debutLigne = premierSautLigne + 1;
  let indiceLigne = 0;
  let lot = [];

  while (debutLigne < contenu.length) {
    let finLigne = contenu.indexOf("\n", debutLigne);
    if (finLigne === -1) finLigne = contenu.length;

    const ligneBrute = contenu.slice(debutLigne, finLigne).replace("\r", "");
    debutLigne = finLigne + 1;
    indiceLigne++;

    if (ligneBrute === "") continue;

    const champsLigne = ligneBrute.split(separateur);

    const messageAnomalie = reconcilierColonnes(champsLigne, entete, indiceLigne);
    if (messageAnomalie) {
      lot.push({ anomalie: { Ligne: indiceLigne + 1, Message: messageAnomalie } });
    } else {
      const ligne = construireLigneRow(champsLigne, nettoyer, indexLigne, false, champsSet, format);
      const contexte = construireContexte(champsLigne, nettoyer, {
        iJournalCode, iJournalLib, iEcritureNum, iEcritureDate, iCompteNum, iCompAuxNum,
      });
      lot.push({ ligne, contexte });
    }

    if (lot.length >= intervalleCedeMain) {
      yield lot;
      lot = [];
      await new Promise(setImmediate);
    }
  }

  if (lot.length > 0) yield lot;
}

/**
 * Reconcile a row's column count against the header, tolerating 1-2 missing
 * trailing columns (some software omits the final separator when there's no
 * currency). Mutates `champsLigne` in place when padding is applied.
 *
 * @param {string[]} champsLigne
 * @param {string[]} entete
 * @param {number} indiceLigne - 1-indexed line number (before the +1 used in messages)
 * @returns {string|null} An anomaly message if the row cannot be reconciled, else `null`.
 */
function reconcilierColonnes(champsLigne, entete, indiceLigne) {
  if (champsLigne.length < entete.length && champsLigne.length >= entete.length - 2) {
    while (champsLigne.length < entete.length) champsLigne.push("");
  }

  if (champsLigne.length === entete.length) return null;

  const manquantes = champsLigne.length < entete.length ? entete.slice(champsLigne.length) : [];
  const enTrop     = champsLigne.length > entete.length ? champsLigne.length - entete.length : 0;
  if (manquantes.length >= entete.length / 2) {
    return `Le fichier FEC semble corrompu ou mal exporté (ligne ${indiceLigne + 1} : ${champsLigne.length} colonne(s) lue(s) sur ${entete.length} attendues). Essayez de le ré-exporter depuis votre logiciel comptable.`;
  } else if (manquantes.length > 0) {
    return `Fichier FEC incomplet — colonne(s) manquante(s) à la ligne ${indiceLigne + 1} : ${manquantes.join(", ")}. Vérifiez le format d'export.`;
  }
  return `Fichier FEC invalide — trop de colonnes à la ligne ${indiceLigne + 1} (${enTrop} colonne(s) en trop). Vérifiez le format d'export.`;
}

/**
 * Build the per-row context object (journal/écriture/compte identifiers) shared
 * between `collectData`'s `onLigne` callback and `FECLignesAsync`'s yielded item.
 *
 * @param {string[]} champsLigne
 * @param {Function} nettoyer
 * @param {Object} idxContexte - `{ iJournalCode, iJournalLib, iEcritureNum, iEcritureDate, iCompteNum, iCompAuxNum }`
 * @returns {{ journalCode: string, journalLib: string, ecritureNum: string, ecritureDate: string, compteNum: string, compAuxNum: string }}
 */
function construireContexte(champsLigne, nettoyer, idxContexte) {
  return {
    journalCode:  nettoyer(champsLigne[idxContexte.iJournalCode]),
    journalLib:   nettoyer(champsLigne[idxContexte.iJournalLib]),
    ecritureNum:  nettoyer(champsLigne[idxContexte.iEcritureNum]),
    ecritureDate: nettoyer(champsLigne[idxContexte.iEcritureDate]),
    compteNum:    nettoyer(champsLigne[idxContexte.iCompteNum]),
    compAuxNum:   nettoyer(champsLigne[idxContexte.iCompAuxNum]),
  };
}

/**
 * Validate `options.champs` against the known set of row field names.
 *
 * @param {string[]|null} champs
 * @returns {Set<string>|null} `null` when `champs` is not provided (all fields kept).
 * @throws {Error} If `champs` contains an unknown field name.
 */
function validerChamps(champs) {
  if (champs === null) return null;
  if (champs.length === 0) {
    throw new Error('FECReader : l\'option champs ne peut pas être un tableau vide');
  }
  const invalides = champs.filter((c) => !CHAMPS_LIGNE_DISPONIBLES.includes(c));
  if (invalides.length > 0) {
    throw new Error(`FECReader : champ(s) invalide(s) dans l'option champs : ${invalides.join(', ')}`);
  }
  return new Set(champs);
}

/**
 * Extract SIREN and fiscal year-end date from a FEC filename, per the DGFiP
 * naming convention `<Siren>FEC<AAAAMMJJ>[...]`.
 *
 * @param {string|null} nomFichier
 * @returns {{ siren: string|null, clotureExercice: string|null }}
 */
function parseNomFichier(nomFichier) {
  if (!nomFichier) return { siren: null, clotureExercice: null };
  const correspondance = /(\d{9,14})FEC(\d{8})/i.exec(nomFichier);
  if (!correspondance) return { siren: null, clotureExercice: null };
  return { siren: correspondance[1], clotureExercice: correspondance[2] };
}

/**
 * Decode raw bytes to a string, auto-detecting encoding.
 * Strings are passed through without conversion.
 *
 * @param {string|Buffer|ArrayBuffer|Uint8Array} input
 * @returns {{ contenu: string, encodage: string }}
 */
function decodeInput(input) {
  if (typeof input === "string") return { contenu: input, encodage: "UTF-8" };

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
    return { contenu: new TextDecoder("utf-8").decode(bytes.slice(3)), encodage: "UTF-8 BOM" };
  }

  // Valid UTF-8 — strict decode throws on any invalid byte sequence
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { contenu: utf8, encodage: "UTF-8" };
  } catch {
    // Fallback: Windows-1252 — compatible avec ISO 8859-15 (norme DGFiP).
    return { contenu: new TextDecoder("windows-1252").decode(bytes), encodage: "Windows-1252" };
  }
}

/**
 * Extract separator, column list, format and index map from the first line of the file.
 * Throws if the separator is unrecognized or required columns are missing.
 *
 * @param {string} contenu
 * @returns {{ separateur: string, entete: string[], format: string, indexColonnes: Object }}
 */
function parseHeader(contenu) {
  const premiereLigne = contenu.slice(0, contenu.indexOf("\n"));
  const separateur = getSeparator(premiereLigne);

  const entete = premiereLigne
    .replaceAll("\r", "")
    .replace("Montantdevise", "MontantDevise")
    .replace("Idevise", "IDevise")
    .split(separateur);

  const format = entete.includes("Montant") ? "avecSens" : "standard";
  const colonnesAttendues = format === "standard" ? COLONNES_FEC : COLONNES_FEC_AVEC_SENS;

  const colonnesManquantes = colonnesAttendues.filter(col => !entete.includes(col));
  if (colonnesManquantes.length > 0) {
    throw new Error(`Fichier erroné (libellé(s) manquant(s) : ${colonnesManquantes.join(', ')})`);
  }

  const indexColonnes = Object.fromEntries(entete.map((col, idx) => [col, idx]));

  return { separateur, entete, format, indexColonnes };
}

/**
 * Iterate over all data rows and accumulate journals, accounts and period boundaries.
 * Processes line-by-line via indexOf to avoid allocating a full split("\n") array.
 *
 * @param {string} contenu
 * @param {string} separateur
 * @param {string[]} entete
 * @param {Object} indexColonnes - Column name → index map
 * @param {string} format - 'standard' | 'avecSens'
 * @param {Object} options
 * @param {boolean} options.lignes - If false (and no onLigne), rows are neither parsed nor retained.
 * @param {(ligne: Object, contexte: Object) => void} options.onLigne - Per-row callback; if provided, rows are not retained.
 * @returns {{ journaux: Object, comptes: Object, comptesAux: Object, anomalies: Object[], premiereDate: string|null, derniereDate: string|null }}
 */
function collectData(contenu, separateur, entete, indexColonnes, format, { lignes, onLigne, champsSet }) {
  const garderLignes = lignes && !onLigne;
  const donneesRequises = garderLignes || !!onLigne;

  const journaux   = {};
  const comptes    = {};
  const comptesAux = {};
  const anomalies  = [];
  let premiereDate = null;
  let derniereDate = null;

  const iJournalCode  = indexColonnes["JournalCode"];
  const iJournalLib   = indexColonnes["JournalLib"];
  const iEcritureNum  = indexColonnes["EcritureNum"];
  const iEcritureDate = indexColonnes["EcritureDate"];
  const iCompteNum    = indexColonnes["CompteNum"];
  const iCompteLib    = indexColonnes["CompteLib"];
  const iCompAuxNum   = indexColonnes["CompAuxNum"];
  const iCompAuxLib   = indexColonnes["CompAuxLib"];

  // Early-exit on empty string: even a regex on "" has a non-zero setup cost, and
  // many FEC fields (CompAuxNum, MontantDevise, IDevise...) are empty on most rows.
  const nettoyer = (s) => (!s ? "" : s.replace(/^[\s"]+|[\s"]+$/g, ""));

  // Row constructor selected once per file (format and garderLignes are invariant
  // for the whole parse) : each row then produces a fixed-shape object literal,
  // with no `delete`, letting V8 keep a stable hidden class instead of falling
  // back to dictionary mode on every row.
  const indexLigne = {
    compteNum:     iCompteNum,
    compAuxNum:    iCompAuxNum,
    compteLib:     iCompteLib,
    compAuxLib:    iCompAuxLib,
    pieceRef:      indexColonnes["PieceRef"],
    pieceDate:     indexColonnes["PieceDate"],
    ecritureLib:   indexColonnes["EcritureLib"],
    debit:         indexColonnes["Debit"],
    credit:        indexColonnes["Credit"],
    montant:       indexColonnes["Montant"],
    sens:          indexColonnes["Sens"],
    ecritureLet:   indexColonnes["EcritureLet"],
    dateLet:       indexColonnes["DateLet"],
    validDate:     indexColonnes["ValidDate"],
    montantDevise: indexColonnes["MontantDevise"],
    iDevise:       indexColonnes["IDevise"],
  };
  const construireLigne = donneesRequises
    ? (champs, nettoyer, idx, garderLignes) => construireLigneRow(champs, nettoyer, idx, garderLignes, champsSet, format)
    : null;

  const premierSautLigne = contenu.indexOf("\n");
  let debutLigne = premierSautLigne + 1;
  let indiceLigne = 0;

  while (debutLigne < contenu.length) {
    let finLigne = contenu.indexOf("\n", debutLigne);
    if (finLigne === -1) finLigne = contenu.length;

    const ligneBrute = contenu.slice(debutLigne, finLigne).replace("\r", "");
    debutLigne = finLigne + 1;
    indiceLigne++;

    if (ligneBrute === "") continue;

    const champs = ligneBrute.split(separateur);

    // Tolerate lines missing 1-2 trailing columns (some software omits final separator when no currency)
    const messageAnomalie = reconcilierColonnes(champs, entete, indiceLigne);
    if (messageAnomalie) {
      anomalies.push({ Ligne: indiceLigne + 1, Message: messageAnomalie });
      continue;
    }

    const donnees = donneesRequises ? construireLigne(champs, nettoyer, indexLigne, garderLignes) : null;

    const { journalCode, journalLib, ecritureNum, ecritureDate, compteNum, compAuxNum } =
      construireContexte(champs, nettoyer, { iJournalCode, iJournalLib, iEcritureNum, iEcritureDate, iCompteNum, iCompAuxNum });
    const compteLib  = nettoyer(champs[iCompteLib]);
    const compAuxLib = nettoyer(champs[iCompAuxLib]);

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
      journal.Ecritures[ecritureNum] = garderLignes
        ? { EcritureDate: ecritureDate, Lignes: [] }
        : { EcritureDate: ecritureDate };
      journal.NombreEcritures++;
      if (journal.DerniereDate === null || ecritureDate > journal.DerniereDate) journal.DerniereDate = ecritureDate;
    }
    if (garderLignes) {
      journal.Ecritures[ecritureNum].Lignes.push(donnees);
    }
    if (onLigne) {
      onLigne(donnees, { journalCode, journalLib, ecritureNum, ecritureDate, compteNum, compAuxNum });
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
    if (premiereDate === null || ecritureDate < premiereDate) premiereDate = ecritureDate;
    if (derniereDate === null || ecritureDate > derniereDate) derniereDate = ecritureDate;
  }

  return { journaux, comptes, comptesAux, anomalies, premiereDate, derniereDate };
}

/**
 * Assemble the final output structure from accumulated data.
 * All dates are kept in source format (YYYYMMDD).
 *
 * @param {Object} journaux
 * @param {Object} comptes
 * @param {Object} comptesAux
 * @param {Object[]} anomalies - Malformed rows skipped during parsing ({ Ligne, Message })
 * @param {string|null} premiereDate - Earliest EcritureDate seen (YYYYMMDD)
 * @param {string|null} derniereDate - Latest EcritureDate seen (YYYYMMDD)
 * @param {string} encodage - Detected encoding
 * @param {string} separateur - Field separator used
 * @param {string} format - 'standard' | 'avecSens'
 * @param {string|null} siren - SIREN extracted from the original filename, if provided
 * @param {string|null} clotureExercice - Fiscal year-end date (YYYYMMDD) extracted from
 *   the original filename, if provided
 * @returns {{ journaux: Object, comptes: Object, comptesAux: Object, anomalies: Object[], meta: Object }}
 */

function buildOutput(journaux, comptes, comptesAux, anomalies, premiereDate, derniereDate, encodage, separateur, format, siren, clotureExercice) {
  return {
    Journaux: journaux,
    Comptes: comptes,
    ComptesAux: comptesAux,
    Anomalies: anomalies,
    Metadonnees: {
      Periode: {
        DateDebut: premiereDate,
        DateFin: derniereDate,
      },
      Fichier: {
        Encodage: encodage,
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
 * Follows a fixed canonical order of `if (inclure(...))` checks, always run in the
 * same sequence for a given `champsSet`/`format`/`garderLignes` (all invariant for
 * the whole file) — the object shape never varies from one row to the next, letting
 * V8 keep the same hidden class across all rows.
 *
 * `CompteLib`/`CompAuxLib` follow a special rule: with no `champsSet` (default, all
 * fields), they are omitted when `garderLignes` (already available via `Comptes`/
 * `ComptesAux`) and included otherwise (`onLigne` mode, row never retained). When
 * `champsSet` is explicit, it always wins over that default — the caller's choice.
 *
 * @param {string[]} champs
 * @param {Function} nettoyer - Field cleaner (strips quotes and whitespace)
 * @param {Object} idx - Column index map (see `indexLigne` in collectData)
 * @param {boolean} garderLignes
 * @param {Set<string>|null} champsSet - Field whitelist (`options.champs`), or `null` for all fields
 * @param {string} format - 'standard' | 'avecSens'
 * @returns {Object}
 */
function construireLigneRow(champs, nettoyer, idx, garderLignes, champsSet, format) {
  const inclure = (nom) => champsSet === null || champsSet.has(nom);
  const donnees = {};

  if (inclure("CompteNum"))   donnees.CompteNum   = nettoyer(champs[idx.compteNum]);
  if (inclure("CompAuxNum"))  donnees.CompAuxNum  = nettoyer(champs[idx.compAuxNum]);
  if (inclure("PieceRef"))    donnees.PieceRef    = nettoyer(champs[idx.pieceRef]);
  if (inclure("PieceDate"))   donnees.PieceDate   = nettoyer(champs[idx.pieceDate]);
  if (inclure("EcritureLib")) donnees.EcritureLib = nettoyer(champs[idx.ecritureLib]);

  if (inclure("Debit") || inclure("Credit")) {
    if (format === "avecSens") {
      const sens    = nettoyer(champs[idx.sens]);
      const montant = nettoyer(champs[idx.montant]);
      if (inclure("Debit"))  donnees.Debit  = parseAmount(sens === "D" ? montant : "0,00");
      if (inclure("Credit")) donnees.Credit = parseAmount(sens === "C" ? montant : "0,00");
    } else {
      if (inclure("Debit"))  donnees.Debit  = parseAmount(nettoyer(champs[idx.debit]));
      if (inclure("Credit")) donnees.Credit = parseAmount(nettoyer(champs[idx.credit]));
    }
  }

  if (inclure("EcritureLet"))   donnees.EcritureLet   = nettoyer(champs[idx.ecritureLet]);
  if (inclure("DateLet"))       donnees.DateLet       = nettoyer(champs[idx.dateLet]);
  if (inclure("ValidDate"))     donnees.ValidDate     = nettoyer(champs[idx.validDate]);
  if (inclure("MontantDevise")) donnees.MontantDevise = nettoyer(champs[idx.montantDevise]);
  if (inclure("IDevise"))       donnees.IDevise       = nettoyer(champs[idx.iDevise]);

  const inclureCompteLib  = champsSet === null ? !garderLignes : champsSet.has("CompteLib");
  const inclureCompAuxLib = champsSet === null ? !garderLignes : champsSet.has("CompAuxLib");
  if (inclureCompteLib)  donnees.CompteLib  = nettoyer(champs[idx.compteLib]);
  if (inclureCompAuxLib) donnees.CompAuxLib = nettoyer(champs[idx.compAuxLib]);

  return donnees;
}

/**
 * Detect the field separator from the header line.
 * @param {string} premiereLigne
 * @returns {'\t' | '|'}
 * @throws {Error} If neither tab nor pipe is found
 */
function getSeparator(premiereLigne) {
  if (premiereLigne.includes("\t")) return "\t";
  if (premiereLigne.includes("|")) return "|";
  throw new Error("Séparateur non reconnu (attendu : tabulation ou pipe)");
}

const parseAmount = (str) => {
  if (!str || str.trim() === '') return 0;
  return parseFloat(str.replace(',', '.'));
};

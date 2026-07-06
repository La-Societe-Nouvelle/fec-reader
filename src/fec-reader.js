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
 * @returns {{ journaux: Object, comptes: Object, comptesAux: Object, anomalies: Object[], meta: Object }}
 * @throws {Error} If the file has an unrecognized separator or missing header columns
 *   (unrecoverable — nothing can be parsed). Malformed individual rows do not throw:
 *   they are skipped and reported in `Anomalies`.
 */
export function FECReader(input, options = {}) {
  const { lignes = true, onLigne = null, nomFichier = null } = options;
  const { contenu, encodage } = decodeInput(input);
  const { separateur, entete, format, indexColonnes } = parseHeader(contenu);
  const { journaux, comptes, comptesAux, premiereDate, derniereDate, anomalies } = collectData(contenu, separateur, entete, indexColonnes, format, { lignes, onLigne });
  const { siren, clotureExercice } = parseNomFichier(nomFichier);
  return buildOutput(journaux, comptes, comptesAux, anomalies, premiereDate, derniereDate, encodage, separateur, format, siren, clotureExercice);
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
function collectData(contenu, separateur, entete, indexColonnes, format, { lignes, onLigne }) {
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
    ? (format === "avecSens" ? parseRowAvecSens : parseRowStandard)
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
    if (champs.length < entete.length && champs.length >= entete.length - 2) {
      while (champs.length < entete.length) champs.push("");
    }

    if (champs.length !== entete.length) {
      const manquantes = champs.length < entete.length ? entete.slice(champs.length) : [];
      const enTrop     = champs.length > entete.length ? champs.length - entete.length : 0;
      let message;
      if (manquantes.length >= entete.length / 2) {
        message = `Le fichier FEC semble corrompu ou mal exporté (ligne ${indiceLigne + 1} : ${champs.length} colonne(s) lue(s) sur ${entete.length} attendues). Essayez de le ré-exporter depuis votre logiciel comptable.`;
      } else if (manquantes.length > 0) {
        message = `Fichier FEC incomplet — colonne(s) manquante(s) à la ligne ${indiceLigne + 1} : ${manquantes.join(", ")}. Vérifiez le format d'export.`;
      } else {
        message = `Fichier FEC invalide — trop de colonnes à la ligne ${indiceLigne + 1} (${enTrop} colonne(s) en trop). Vérifiez le format d'export.`;
      }
      anomalies.push({ Ligne: indiceLigne + 1, Message: message });
      continue;
    }

    const donnees = donneesRequises ? construireLigne(champs, nettoyer, indexLigne, garderLignes) : null;
    const { debit, credit } = extraireMontants(champs, nettoyer, indexLigne, format, donnees);

    const journalCode  = nettoyer(champs[iJournalCode]);
    const journalLib   = nettoyer(champs[iJournalLib]);
    const ecritureNum  = nettoyer(champs[iEcritureNum]);
    const ecritureDate = nettoyer(champs[iEcritureDate]);
    const compteNum    = nettoyer(champs[iCompteNum]);
    const compteLib    = nettoyer(champs[iCompteLib]);
    const compAuxNum   = nettoyer(champs[iCompAuxNum]);
    const compAuxLib   = nettoyer(champs[iCompAuxLib]);

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
      comptes[compteNum] = { Libelle: compteLib, Debit: 0, Credit: 0, Solde: 0, SoldeAN: 0 };
    }
    const compte = comptes[compteNum];
    compte.Debit += debit;
    compte.Credit += credit;
    compte.Solde = compte.Debit - compte.Credit;
    if (journalCode === "AN") {
      compte.SoldeAN += debit - credit;
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
 * Extract Debit/Credit amounts for a row, regardless of whether the row is being
 * fully materialized — solde aggregation on `Comptes` needs these unconditionally.
 * Reuses the amounts already computed in `donnees` when available, to avoid parsing twice.
 *
 * @param {string[]} champs
 * @param {Function} nettoyer
 * @param {Object} idx
 * @param {string} format - 'standard' | 'avecSens'
 * @param {Object|null} donnees - Already-built row (if `lignes`/`onLigne` requested it)
 * @returns {{ debit: number, credit: number }} - 0 instead of NaN when unparseable, so
 *   solde aggregation is not poisoned by a single bad amount.
 */
function extraireMontants(champs, nettoyer, idx, format, donnees) {
  if (donnees) return { debit: donnees.Debit || 0, credit: donnees.Credit || 0 };
  if (format === "avecSens") {
    const sens    = nettoyer(champs[idx.sens]);
    const montant = parseAmount(nettoyer(champs[idx.montant]));
    return { debit: sens === "D" ? montant || 0 : 0, credit: sens === "C" ? montant || 0 : 0 };
  }
  return {
    debit:  parseAmount(nettoyer(champs[idx.debit])) || 0,
    credit: parseAmount(nettoyer(champs[idx.credit])) || 0,
  };
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
 * Build a data row object for the 'standard' format (Debit/Credit columns).
 * Always produces the same object shape (same keys, same order) for a given
 * `garderLignes` value — `garderLignes` is invariant for the whole file, so the
 * object shape never varies from one row to the next, letting V8 keep the same
 * hidden class across all rows.
 *
 * @param {string[]} champs
 * @param {Function} nettoyer - Field cleaner (strips quotes and whitespace)
 * @param {Object} idx - Column index map (see `indexLigne` in collectData)
 * @param {boolean} garderLignes - If true (rows materialized into `Lignes[]`),
 *   CompteLib/CompAuxLib are omitted (already available via `Comptes`/`ComptesAux`).
 *   If false (`onLigne` mode), they are included since the row is never retained
 *   after the callback returns.
 * @returns {Object}
 */
function parseRowStandard(champs, nettoyer, idx, garderLignes) {
  const donnees = {
    CompteNum:     nettoyer(champs[idx.compteNum]),
    CompAuxNum:    nettoyer(champs[idx.compAuxNum]),
    PieceRef:      nettoyer(champs[idx.pieceRef]),
    PieceDate:     nettoyer(champs[idx.pieceDate]),
    EcritureLib:   nettoyer(champs[idx.ecritureLib]),
    Debit:         parseAmount(nettoyer(champs[idx.debit])),
    Credit:        parseAmount(nettoyer(champs[idx.credit])),
    EcritureLet:   nettoyer(champs[idx.ecritureLet]),
    DateLet:       nettoyer(champs[idx.dateLet]),
    ValidDate:     nettoyer(champs[idx.validDate]),
    MontantDevise: nettoyer(champs[idx.montantDevise]),
    IDevise:       nettoyer(champs[idx.iDevise]),
  };
  if (!garderLignes) {
    donnees.CompteLib  = nettoyer(champs[idx.compteLib]);
    donnees.CompAuxLib = nettoyer(champs[idx.compAuxLib]);
  }
  return donnees;
}

/**
 * Build a data row object for the 'avecSens' format (Montant/Sens columns,
 * converted to Debit/Credit). Same shape-stability rationale as `parseRowStandard`.
 *
 * @param {string[]} champs
 * @param {Function} nettoyer
 * @param {Object} idx
 * @param {boolean} garderLignes
 * @returns {Object}
 */
function parseRowAvecSens(champs, nettoyer, idx, garderLignes) {
  const sens    = nettoyer(champs[idx.sens]);
  const montant = nettoyer(champs[idx.montant]);
  const donnees = {
    CompteNum:     nettoyer(champs[idx.compteNum]),
    CompAuxNum:    nettoyer(champs[idx.compAuxNum]),
    PieceRef:      nettoyer(champs[idx.pieceRef]),
    PieceDate:     nettoyer(champs[idx.pieceDate]),
    EcritureLib:   nettoyer(champs[idx.ecritureLib]),
    Debit:         parseAmount(sens === "D" ? montant : "0,00"),
    Credit:        parseAmount(sens === "C" ? montant : "0,00"),
    EcritureLet:   nettoyer(champs[idx.ecritureLet]),
    DateLet:       nettoyer(champs[idx.dateLet]),
    ValidDate:     nettoyer(champs[idx.validDate]),
    MontantDevise: nettoyer(champs[idx.montantDevise]),
    IDevise:       nettoyer(champs[idx.iDevise]),
  };
  if (!garderLignes) {
    donnees.CompteLib  = nettoyer(champs[idx.compteLib]);
    donnees.CompAuxLib = nettoyer(champs[idx.compAuxLib]);
  }
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

const parseAmount = (str) => parseFloat(str.replace(',', '.'));

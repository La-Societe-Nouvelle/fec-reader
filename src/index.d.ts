/**
 * FEC Reader
 * Part of @lasocietenouvelle/fec-reader
 * https://github.com/La-Societe-Nouvelle/fec-reader
 * License: EUPL-1.2
 */

// ---------------------------------------------------------------------------
// Types partagés — utilisés à la fois par FECReader et readFECLignes
// ---------------------------------------------------------------------------

export interface LigneEcriture {
  CompteNum: string;
  CompAuxNum: string;
  PieceRef: string;
  PieceDate: string;
  EcritureLib: string;
  Debit: number;
  Credit: number;
  EcritureLet: string;
  DateLet: string;
  ValidDate: string;
  MontantDevise: string;
  IDevise: string;
}

/** Ligne transmise à `onLigne` — inclut CompteLib/CompAuxLib, retirés dans `Lignes[]` car déjà disponibles via `Comptes`/`ComptesAux`. */
export interface LigneAvecLibelles extends LigneEcriture {
  CompteLib: string;
  CompAuxLib: string;
}

export interface LigneContexte {
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  ecritureDate: string;
  compteNum: string;
  compAuxNum: string;
}

export interface Anomalie {
  /** Numéro de ligne dans le fichier source (1-indexé, en-tête inclus). */
  Ligne: number;
  Message: string;
}

// ---------------------------------------------------------------------------
// FECReader — parsing complet, structure JSON en retour
// ---------------------------------------------------------------------------

export interface Compte {
  Libelle: string;
}

export interface Ecriture {
  EcritureDate: string;
  /** Absent lorsque l'option `lignes: false` ou `onLigne` est utilisée. */
  Lignes?: LigneEcriture[];
}

export interface Journal {
  Libelle: string;
  NombreEcritures: number;
  NombreLignes: number;
  DerniereDate: string;
  Ecritures: Record<string, Ecriture>;
}

export interface FECData {
  Journaux: Record<string, Journal>;
  Comptes: Record<string, Compte>;
  ComptesAux: Record<string, Compte>;
  /** Lignes mal formées (nombre de colonnes incorrect, ignorées) ou avec un montant vide
   * (Debit/Credit/Montant, traité comme 0 mais pas ignoré) rencontrées pendant le parsing.
   * Vide si le fichier est valide. */
  Anomalies: Anomalie[];
  Metadonnees: {
    Periode: {
      DateDebut: string | null;
      DateFin: string | null;
    };
    Fichier: {
      Encodage: 'UTF-8' | 'UTF-8 BOM' | 'Windows-1252';
      Separateur: '\t' | '|';
      Format: 'standard' | 'avecSens';
      /** SIREN extrait du nom de fichier (`options.nomFichier`), ou `null` si non fourni / non reconnu. */
      Siren: string | null;
      /** Date de clôture d'exercice (YYYYMMDD) extraite du nom de fichier, ou `null` si non fourni / non reconnu. */
      ClotureExercice: string | null;
    };
  };
}

export interface FECReaderOptions {
  /** Si `false`, `Ecritures[num].Lignes[]` n'est pas construit — seuls les agrégats sont conservés.
   * @default true */
  lignes?: boolean;
  /** Callback par ligne. Fourni, il désactive `Lignes[]` même si `lignes` vaut `true`. */
  onLigne?: (ligne: LigneAvecLibelles, contexte: LigneContexte) => void;
  /** Nom du fichier d'origine (`<Siren>FEC<AAAAMMJJ>`) pour extraire Siren/ClotureExercice. N'affecte pas le parsing. */
  nomFichier?: string;
  /** Liste blanche des champs à construire par ligne. Un nom inconnu lève une erreur.
   * `CompteLib`/`CompAuxLib` explicites priment sur l'auto-exclusion en mode `lignes: true`. */
  champs?: Array<keyof LigneAvecLibelles>;
}

/**
 * Parse un fichier FEC et retourne les données structurées.
 * Encodage auto-détecté sur les octets bruts : BOM UTF-8 → UTF-8 → Windows-1252.
 *
 * @throws {Error} Séparateur/colonnes d'en-tête invalides (cas irrécupérables). Une ligne
 *   mal formée ne lève pas d'exception — elle est signalée dans `Anomalies`.
 */
export function FECReader(input: string | Buffer | ArrayBuffer | Uint8Array, options?: FECReaderOptions): FECData;

// ---------------------------------------------------------------------------
// readFECLignes — itération async par lots, sans agrégat en retour
// ---------------------------------------------------------------------------

export interface ReadFECLignesOptions {
  /** Même liste blanche que `FECReaderOptions.champs`. */
  champs?: Array<keyof LigneAvecLibelles>;
  /** Lignes par lot yield, et par cession à l'event loop (`await setImmediate`). Le
   * batching évite le coût par-ligne du protocole async — voir CHANGELOG.md [1.1.0-beta.1].
   * @default 1000 */
  intervalleCedeMain?: number;
}

export type ReadFECLignesItem =
  | { ligne: LigneAvecLibelles; contexte: LigneContexte }
  | { anomalie: Anomalie };

/**
 * Itère de façon asynchrone sur les lignes d'un FEC, par lots de `intervalleCedeMain`
 * items, en cédant la main à l'event loop entre deux lots. Ne construit aucun agrégat
 * (`Journaux`/`Comptes`) contrairement à `FECReader` — flux pur.
 *
 * @throws {Error} Mêmes cas irrécupérables que `FECReader`, levés au premier `.next()`.
 *
 * Node.js uniquement (`setImmediate`) — contrairement à `FECReader`, pas utilisable en navigateur.
 */
export function readFECLignes(
  input: string | Buffer | ArrayBuffer | Uint8Array,
  options?: ReadFECLignesOptions
): AsyncGenerator<ReadFECLignesItem[]>;

export interface Compte {
  Libelle: string;
}

export interface Anomalie {
  /** Numéro de ligne dans le fichier source (1-indexé, en-tête inclus). */
  Ligne: number;
  Message: string;
}

export interface Journal {
  Libelle: string;
  NombreEcritures: number;
  NombreLignes: number;
  DerniereDate: string;
  Ecritures: Record<string, Ecriture>;
}

export interface Ecriture {
  EcritureDate: string;
  /** Absent lorsque l'option `lignes: false` ou `onLigne` est utilisée. */
  Lignes?: LigneEcriture[];
}

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

export interface FECData {
  Journaux: Record<string, Journal>;
  Comptes: Record<string, Compte>;
  ComptesAux: Record<string, Compte>;
  /** Lignes ignorées pendant le parsing car mal formées (nombre de colonnes incorrect). Vide si le fichier est valide. */
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

export interface FECReaderOptions {
  /**
   * Si `false`, les lignes ne sont pas matérialisées dans `Ecritures[num].Lignes[]` :
   * seuls les agrégats (`NombreEcritures`, `NombreLignes`, `DerniereDate`, `EcritureDate`)
   * sont conservés. Réduit fortement la mémoire retenue sur les gros fichiers.
   * @default true
   */
  lignes?: boolean;
  /**
   * Callback invoqué pour chaque ligne de données parsée. Lorsqu'il est fourni,
   * `Ecritures[num].Lignes[]` n'est pas construit, quelle que soit la valeur de `lignes`.
   */
  onLigne?: (ligne: LigneAvecLibelles, contexte: LigneContexte) => void;
  /**
   * Nom du fichier d'origine (ex: "552100554FEC20231231.txt"). Si fourni, le SIREN et
   * la date de clôture d'exercice sont extraits du nom (norme DGFiP : `<Siren>FEC<AAAAMMJJ>`)
   * et exposés dans `Metadonnees.Fichier`. N'affecte pas le parsing du contenu.
   */
  nomFichier?: string;
  /**
   * Liste blanche des champs à construire pour chaque ligne (`Lignes[]` ou argument de
   * `onLigne`). Si non fourni, tous les champs sont construits (comportement historique).
   * Un nom de champ inconnu lève une erreur. `CompteLib`/`CompAuxLib` explicitement
   * demandés priment toujours sur l'auto-exclusion habituelle en mode `lignes: true`.
   */
  champs?: Array<keyof LigneAvecLibelles>;
}

/**
 * Parse un fichier FEC (Fichier des Écritures Comptables) et retourne les données structurées.
 *
 * Accepte une chaîne pré-décodée ou des octets bruts (Buffer / ArrayBuffer / Uint8Array).
 * Lorsque des octets sont fournis, l'encodage est auto-détecté :
 * BOM UTF-8 → UTF-8 → Windows-1252 (fallback).
 *
 * @throws {Error} Si le séparateur n'est pas reconnu ou si des colonnes obligatoires sont absentes
 *   (cas irrécupérables — rien ne peut être parsé). Une ligne de données mal formée ne lève
 *   pas d'exception : elle est ignorée et signalée dans `Anomalies`.
 */
export function FECReader(input: string | Buffer | ArrayBuffer | Uint8Array, options?: FECReaderOptions): FECData;

export interface FECLignesAsyncOptions {
  /**
   * Liste blanche des champs à construire pour chaque ligne. Mêmes règles et
   * mêmes noms que `FECReaderOptions.champs`. Si non fourni, tous les champs
   * sont construits.
   */
  champs?: Array<keyof LigneAvecLibelles>;
  /**
   * Nombre de lignes par lot yield, et nombre de lignes entre deux cessions de
   * la main à l'event loop (`await setImmediate`). Les lots réduisent le
   * nombre de points de suspension du générateur async : un `for await` qui
   * consommerait une ligne à la fois paierait le coût de résolution de
   * promesse du protocole async à chaque ligne (amplifié sous un contexte
   * `AsyncLocalStorage`, ex. une Server Action Next.js — voir
   * `docs/superpowers/specs/2026-07-07-fec-lignes-async-design.md`).
   * @default 1000
   */
  intervalleCedeMain?: number;
}

export type FECLigneAsyncItem =
  | { ligne: LigneAvecLibelles; contexte: LigneContexte }
  | { anomalie: Anomalie };

/**
 * Itère de façon asynchrone sur les lignes de données d'un fichier FEC, par
 * lots de `intervalleCedeMain` items, en cédant la main à l'event loop
 * (`setImmediate`) après chaque lot complet — pour ne pas bloquer un serveur
 * à process partagé pendant un parsing volumineux.
 *
 * Contrairement à `FECReader`, ne construit aucun agrégat : ni `Journaux`, ni
 * `Comptes`, ni valeur de retour. Chaque item d'un lot est soit une ligne
 * valide (`{ ligne, contexte }`), soit une anomalie (`{ anomalie }`) pour une
 * ligne mal formée — le flux continue dans les deux cas.
 *
 * @throws {Error} Si le séparateur n'est pas reconnu ou si des colonnes
 *   obligatoires sont absentes — levée de façon synchrone au premier appel
 *   à `.next()` (donc à la première itération du `for await`), avant tout yield.
 *
 * Node.js uniquement — utilise `setImmediate` en interne, indisponible dans
 * les navigateurs, contrairement à `FECReader`.
 */
export function FECLignesAsync(
  input: string | Buffer | ArrayBuffer | Uint8Array,
  options?: FECLignesAsyncOptions
): AsyncGenerator<FECLigneAsyncItem[]>;

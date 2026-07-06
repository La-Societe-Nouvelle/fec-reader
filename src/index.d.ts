export interface Compte {
  Libelle: string;
}

export interface CompteGeneral extends Compte {
  /** Somme des débits, tous journaux confondus. */
  Debit: number;
  /** Somme des crédits, tous journaux confondus. */
  Credit: number;
  /** `Debit - Credit`, tous journaux confondus. */
  Solde: number;
  /** `Debit - Credit` restreint au journal des à-nouveaux (code journal `AN`). */
  SoldeAN: number;
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
  Comptes: Record<string, CompteGeneral>;
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

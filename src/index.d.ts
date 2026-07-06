export interface Compte {
  Libelle: string;
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
  Metadonnees: {
    Periode: {
      DateDebut: string | null;
      DateFin: string | null;
    };
    Fichier: {
      Encodage: 'UTF-8' | 'UTF-8 BOM' | 'Windows-1252';
      Separateur: '\t' | '|';
      Format: 'standard' | 'avecSens';
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
}

/**
 * Parse un fichier FEC (Fichier des Écritures Comptables) et retourne les données structurées.
 *
 * Accepte une chaîne pré-décodée ou des octets bruts (Buffer / ArrayBuffer / Uint8Array).
 * Lorsque des octets sont fournis, l'encodage est auto-détecté :
 * BOM UTF-8 → UTF-8 → Windows-1252 (fallback).
 *
 * @throws {Error} Si le séparateur n'est pas reconnu ou si des colonnes obligatoires sont absentes
 */
export function FECReader(input: string | Buffer | ArrayBuffer | Uint8Array, options?: FECReaderOptions): FECData;

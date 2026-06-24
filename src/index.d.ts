export interface Compte {
  compteLib: string;
}

export interface LigneEcriture {
  EcritureDate: string;
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

export interface Journal {
  libelle: string;
  nbLignes: number;
  derniereDate: string;
  ecritures: Record<string, LigneEcriture[]>;
}

export interface FECData {
  journaux: Record<string, Journal>;
  comptes: Record<string, Compte>;
  comptesAux: Record<string, Compte>;
  meta: {
    periode: {
      premiereDate: string | null;
      derniereDate: string | null;
    };
    fichier: {
      encodage: 'UTF-8' | 'UTF-8 BOM' | 'Windows-1252';
      separateur: '\t' | '|';
      format: 'standard' | 'avecSens';
    };
  };
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
export function FECReader(input: string | Buffer | ArrayBuffer | Uint8Array): FECData;

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
  Lignes: Record<string, LigneEcriture[]>;
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

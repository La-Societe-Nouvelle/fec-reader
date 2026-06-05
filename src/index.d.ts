export interface FECAccount {
  accountNum: string;
  accountLib: string;
  directMatching?: boolean;
  assetAccountNum?: string;
  assetAccountLib?: string;
  amortisationAccountNum?: string;
  amortisationAccountLib?: string;
  depreciationAccountNum?: string;
  depreciationAccountLib?: string;
}

export interface FECRow {
  JournalCode: string;
  JournalLib: string;
  EcritureNum: string;
  EcritureDate: string;
  CompteNum: string;
  CompteLib: string;
  CompAuxNum: string;
  CompAuxLib: string;
  PieceRef: string;
  PieceDate: string;
  EcritureLib: string;
  Debit: number;
  Credit: number;
  EcritureLet: string;
  DateLet: string;
  ValidDate: string;
  Montantdevise: string;
  Idevise: string;
}

export type BookType = 'ANOUVEAUX' | 'VENTES' | 'ACHATS' | 'OPERATIONS' | 'AUTRE';

export interface FECBook {
  label: string;
  type: BookType;
  lineCount: number;
  lastDate: string;
  entries: Record<string, FECRow[]>;
}

export interface FECResult {
  books: Record<string, FECBook>;
  meta: {
    accounts: Record<string, FECAccount>;
    accountsAux: Record<string, { accountNum: string; accountLib: string }>;
    period: {
      firstDate: string | null;
      lastDate: string | null;
    };
  };
}

/**
 * Parse a FEC file (Fichier des Écritures Comptables) and return structured data.
 *
 * Accepts a pre-decoded string (backward compatible) or raw bytes (Buffer /
 * ArrayBuffer / Uint8Array). When bytes are provided the encoding is
 * auto-detected: UTF-8 BOM → UTF-8 → Windows-1252 fallback.
 *
 * @throws {Error} If separator is unrecognized or required columns are missing
 */
export function FECReader(input: string | Buffer | ArrayBuffer | Uint8Array): FECResult;

/**
 * Enrich amortisation/depreciation accounts (28x, 39x) with references
 * to their corresponding asset accounts based on account number prefix matching.
 */
export function mapAssetAccounts(accounts: Record<string, FECAccount>): Record<string, FECAccount>;

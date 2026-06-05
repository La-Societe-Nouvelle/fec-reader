import { describe, it, expect } from 'vitest';
import { mapAssetAccounts } from '../src/asset-mapping.js';

describe('mapAssetAccounts', () => {
  it('matching direct 2813 → 213 (directMatching: true)', () => {
    const accounts = {
      '213': { accountNum: '213', accountLib: 'Matériel de bureau' },
      '2813': { accountNum: '2813', accountLib: 'Amort. matériel de bureau' },
    };
    const result = mapAssetAccounts(accounts);

    expect(result['2813'].directMatching).toBe(true);
    expect(result['2813'].assetAccountNum).toBe('213');
    expect(result['2813'].assetAccountLib).toBe('Matériel de bureau');
    expect(result['213'].amortisationAccountNum).toBe('2813');
  });

  it('pas de compte correspondant → directMatching: false', () => {
    const accounts = {
      '2891': { accountNum: '2891', accountLib: 'Amort. sans correspondance' },
    };
    const result = mapAssetAccounts(accounts);

    expect(result['2891'].directMatching).toBe(false);
    expect(result['2891'].assetAccountNum).toBeUndefined();
  });

  it('matching dépréciation 391 → 31 (directMatching: true)', () => {
    const accounts = {
      '31': { accountNum: '31', accountLib: 'Stocks matières premières' },
      '391': { accountNum: '391', accountLib: 'Dépréciation stocks matières' },
    };
    const result = mapAssetAccounts(accounts);

    expect(result['391'].directMatching).toBe(true);
    expect(result['391'].assetAccountNum).toBe('31');
    expect(result['31'].depreciationAccountNum).toBe('391');
  });

  it('matching ambigu (plusieurs comptes actifs possibles) → directMatching: false', () => {
    // 2813 cherche un compte commençant par '213' — deux candidats : ambiguïté
    const accounts = {
      '213':   { accountNum: '213',   accountLib: 'Matériel de bureau' },
      '21300': { accountNum: '21300', accountLib: 'Matériel de bureau (détail)' },
      '2813':  { accountNum: '2813',  accountLib: 'Amort. matériel de bureau' },
    };
    const result = mapAssetAccounts(accounts);

    expect(result['2813'].directMatching).toBe(false);
    expect(result['2813'].assetAccountNum).toBeUndefined();
  });

  it('ne modifie pas les comptes sans rapport', () => {
    const accounts = {
      '401000': { accountNum: '401000', accountLib: 'Fournisseurs' },
      '60600': { accountNum: '60600', accountLib: 'Fournitures' },
    };
    const result = mapAssetAccounts(accounts);

    expect(result['401000']).toEqual(accounts['401000']);
    expect(result['60600']).toEqual(accounts['60600']);
  });

  it('gère les comptes avec des formats non standard', () => {
    const accounts = {
      '281300': { accountNum: '281300', accountLib: 'Amortissement matériel' },
      '21300': { accountNum: '21300', accountLib: 'Matériel' },
    };
    const result = mapAssetAccounts(accounts);

    expect(result['281300'].directMatching).toBe(true);
    expect(result['281300'].assetAccountNum).toBe('21300');
  });

  it('gère les comptes d\'amortissement sans correspondance', () => {
    const accounts = {
      '2813': { accountNum: '2813', accountLib: 'Amortissement sans correspondance' },
    };
    const result = mapAssetAccounts(accounts);

    expect(result['2813'].directMatching).toBe(false);
    expect(result['2813'].assetAccountNum).toBeUndefined();
  });

  it('gère les comptes avec des numéros très longs', () => {
    const accounts = {
      '28131000': { accountNum: '28131000', accountLib: 'Amortissement' },
      '2131000': { accountNum: '2131000', accountLib: 'Matériel' },
    };
    const result = mapAssetAccounts(accounts);

    expect(result['28131000'].directMatching).toBe(true);
    expect(result['28131000'].assetAccountNum).toBe('2131000');
  });
});

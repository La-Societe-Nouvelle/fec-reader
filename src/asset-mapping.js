// La Société Nouvelle

/**
 * Enrich amortisation and depreciation accounts (28x, 39x) with a reference
 * to their corresponding asset account (2x, 3x) based on account number prefix matching.
 *
 * Example: account 2813 → matched to account 213 (directMatching: true)
 *
 * @param {Object} accounts - Account map keyed by account number
 * @returns {Object} Same map with directMatching, assetAccountNum, assetAccountLib
 *   added to each amortisation/depreciation account, and reciprocal links on asset accounts.
 */
export const mapAssetAccounts = (accounts) => {
  let updatedAccounts = { ...accounts };

  let accountsToMap = Object.keys(updatedAccounts).filter((accountNum) =>
    /^(2[8-9]|39)/.test(accountNum)
  ); // amortisation & depreciation accounts
  let assetAccounts = Object.keys(updatedAccounts).filter((accountNum) =>
    /^(2[0-1]|3[0-8])/.test(accountNum)
  ); // immobilisation & stock accounts

  accountsToMap.forEach((accountToMapNum) => {
    let assetAccount = assetAccounts.filter((assetAccount) =>
      assetAccount.startsWith(accountToMapNum[0] + accountToMapNum.substring(2))
    );
    if (assetAccount.length === 1) {
      let assetAccountNum = assetAccount[0];
      updatedAccounts[accountToMapNum] = {
        ...updatedAccounts[accountToMapNum],
        directMatching: true,
        assetAccountNum: assetAccountNum,
        assetAccountLib: updatedAccounts[assetAccountNum].accountLib,
      };

      if (accountToMapNum.charAt(1) === '8') {
        updatedAccounts[assetAccountNum] = {
          ...updatedAccounts[assetAccountNum],
          amortisationAccountNum: accountToMapNum,
          amortisationAccountLib: updatedAccounts[accountToMapNum].accountLib,
        };
      } else if (accountToMapNum.charAt(1) === '9') {
        updatedAccounts[assetAccountNum] = {
          ...updatedAccounts[assetAccountNum],
          depreciationAccountNum: accountToMapNum,
          depreciationAccountLib: updatedAccounts[accountToMapNum].accountLib,
        };
      }
    } else {
      updatedAccounts[accountToMapNum] = {
        ...updatedAccounts[accountToMapNum],
        directMatching: false,
        assetAccountNum: undefined,
        assetAccountLib: undefined,
      };
    }
  });

  return updatedAccounts;
};

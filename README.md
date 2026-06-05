# @lasocietenouvelle/fec-reader

Parser de fichiers FEC — **Fichier des Écritures Comptables** 

Transforme un FEC brut en structure JSON exploitable : journaux, écritures groupées, comptes, période comptable.

Le FEC est un fichier normalisé produit par les logiciels de comptabilité et remis à l'administration fiscale (DGFiP) lors des contrôles. Il contient l'ensemble des écritures comptables d'un exercice.

> **Documentation METRIZ :** [Lecture du FEC dans METRIZ](https://www.lasocietenouvelle.org/docs/metriz-webapp/lecture-fec) — détail de l'utilisation dans le contexte de l'empreinte sociétale.

---

## Installation

```bash
npm install @lasocietenouvelle/fec-reader
```

Requiert **Node.js ≥ 20**.

---

## Utilisation

**Node.js**

```js
import { readFileSync } from 'fs';
import { FECReader } from '@lasocietenouvelle/fec-reader';

const buffer = readFileSync('./mon-fichier.txt');  // pas d'encodage — Buffer brut

try {
  const result = FECReader(buffer);  // encodage auto-détecté

  console.log(result.meta.period);
  // { firstDate: '20240101', lastDate: '20241231' }

  console.log(Object.keys(result.books));
  // [ 'AN', 'ACH', 'VTE', 'OD' ]

} catch (error) {
  console.error('Erreur de parsing FEC:', error.message);
}
```

**Navigateur**

```js
import { FECReader } from '@lasocietenouvelle/fec-reader';

reader.readAsArrayBuffer(file);
reader.onload = (e) => {
  const result = FECReader(e.target.result);  // encodage auto-détecté
};
```

---

## Structure de sortie

```js
{
  books: {
    "ACH": {
      label: "Achats",           // Libellé du journal
      type: "ACHATS",            // Type détecté (voir ci-dessous)
      lineCount: 142,            // Nombre total de lignes
      lastDate: "20241231",      // Dernière EcritureDate (YYYYMMDD)
      entries: {
        "AC0001": [              // Clé = EcritureNum brut (format selon logiciel source)
          { JournalCode, JournalLib, EcritureNum, EcritureDate,
            CompteNum, CompteLib, CompAuxNum, CompAuxLib,
            PieceRef, PieceDate, EcritureLib,
            Debit,   // number
            Credit,  // number
            EcritureLet, DateLet, ValidDate, Montantdevise, Idevise }
        ]
      }
    }
  },
  meta: {
    accounts: {
      "213100": {
        accountNum: "213100",
        accountLib: "Bâtiment",
        // Présent si un compte d'amortissement correspondant est trouvé :
        amortisationAccountNum: "281310",
        amortisationAccountLib: "Amort. bâtiment"
      },
      "281310": {
        accountNum: "281310",
        accountLib: "Amort. bâtiment",
        directMatching: true,       // false si aucun compte d'actif trouvé
        assetAccountNum: "213100",
        assetAccountLib: "Bâtiment"
      },
      // Comptes de dépréciation (39x) → même logique, clé depreciationAccountNum :
      "391000": {
        accountNum: "391000",
        accountLib: "Dépréc. matières premières",
        directMatching: true,
        assetAccountNum: "310000",
        assetAccountLib: "Matières premières"
      }
      // Quand directMatching: false, assetAccountNum est absent du JSON
      // (les clés undefined sont supprimées par JSON.stringify)
    },
    accountsAux: {
      "F001": { accountNum: "F001", accountLib: "Dupont SARL" }
    },
    period: {
      firstDate: "20240101",  // YYYYMMDD
      lastDate:  "20241231"   // YYYYMMDD
    }
  }
}
```

### Types de journaux

| Type | Description |
|------|-------------|
| `ANOUVEAUX` | À-nouveaux |
| `ACHATS` | Achats |
| `VENTES` | Ventes |
| `OPERATIONS` | Opérations diverses |
| `AUTRE` | Non reconnu |

---

## Formats acceptés

| Critère | Valeurs acceptées |
|---------|-------------------|
| Extensions | `.txt`, `.csv` |
| Encodage | Auto-détecté — UTF-8 (avec ou sans BOM), ISO 8859-15, ASCII (spec DGFiP art. A 47 A-1 LPF) |
| Séparateur | Tabulation `\t` ou pipe `\|` |
| Colonnes | Standard Débit/Crédit ou variante Montant/Sens |

**Exemples concrets :**

**Format standard (Débit/Crédit) :**
```
JournalCode	JournalLib	EcritureNum	...	Debit	Credit	...
ACH	Achats	AC0001	...	1200,00	0,00	...
```

**Format alternatif (Montant/Sens) :**
```
JournalCode|JournalLib|EcritureNum|...|Montant|Sens|...
VTE|Ventes|VT0001|...|2500,00|C|...
```

Les colonnes `Montant` et `Sens` sont automatiquement converties en `Debit` et `Credit`.

Les dates sont conservées au format source **YYYYMMDD** (format DGFiP).

---

## API

### `FECReader(input)`

Parse le contenu d'un fichier FEC et retourne la structure JSON décrite ci-dessus.

- `input` — `Buffer | ArrayBuffer | Uint8Array` — contenu brut du fichier, encodage auto-détecté
- Lève une `Error` si le séparateur n'est pas reconnu ou si des colonnes obligatoires sont manquantes

### `mapAssetAccounts(accounts)`

Enrichit un plan de comptes avec les correspondances entre comptes d'actif et leurs comptes d'amortissement ou de dépréciation associés.
Utilisé en interne par `FECReader`, mais exporté pour un usage autonome.

Le FEC contient typiquement plusieurs catégories de comptes :
- **À-nouveaux** (journal AN) — montants initiaux d'immobilisations (20x–27x), amortissements (28x–29x), stocks (31x–37x)
- **Immobilisations** (20x–27x) et **amortissements** (28x–29x) — acquisitions, productions, via fournisseurs (40x)
- **Stocks** (31x–37x) et **dépréciations de stocks** (39x)
- **Charges externes** (60x–62x) — détail par fournisseur
- **Production** (70x–72x) — ventes, variations de stocks, immobilisations produites
- **Formation** — taxe d'apprentissage et participation à la formation professionnelle

`mapAssetAccounts` établit automatiquement les liens entre comptes d'actif (2x, 3x) et leurs comptes d'amortissement ou dépréciation associés (28x, 39x), en se basant sur la concordance des numéros de compte.

**Exemple d'utilisation :**
```js
import { mapAssetAccounts } from '@lasocietenouvelle/fec-reader';

const accounts = {
  '213': { accountNum: '213', accountLib: 'Matériel de bureau' },
  '2813': { accountNum: '2813', accountLib: 'Amort. matériel de bureau' },
};

const enrichedAccounts = mapAssetAccounts(accounts);

console.log(enrichedAccounts['2813']);
// {
//   accountNum: '2813',
//   accountLib: 'Amort. matériel de bureau',
//   directMatching: true,
//   assetAccountNum: '213',
//   assetAccountLib: 'Matériel de bureau'
// }
```

**Paramètres :**
- `accounts` — `Object` — dictionnaire `{ [accountNum]: { accountNum, accountLib } }`
- **Retourne** le même dictionnaire enrichi avec `directMatching`, `assetAccountNum`, etc.

---

## Licence

MIT — [La Société Nouvelle](https://lasocietenouvelle.org)

---

## Support et contribution

Pour signaler un bug, demander une fonctionnalité ou contribuer au projet :
- [Ouvrir une issue sur GitHub](https://github.com/lasocietenouvelle/fec-reader/issues)
- [Consulter le code source](https://github.com/lasocietenouvelle/fec-reader)

Les contributions sont les bienvenues ! Veuillez ouvrir une issue avant de proposer une pull request pour discuter des changements.

---


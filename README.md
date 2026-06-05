# @lasocietenouvelle/fec-reader

[![npm](https://img.shields.io/npm/v/@lasocietenouvelle/fec-reader)](https://www.npmjs.com/package/@lasocietenouvelle/fec-reader)

Parser de fichiers FEC — **Fichier des Écritures Comptables**

Transforme un FEC brut en structure JSON exploitable : journaux, écritures groupées, comptes, période comptable.

Le FEC est un fichier normalisé produit par les logiciels de comptabilité et remis à l'administration fiscale (DGFiP) lors des contrôles. Il contient l'ensemble des écritures comptables d'un exercice.

> **Documentation METRIZ :** [Lecture du FEC dans METRIZ](https://www.lasocietenouvelle.org/docs/metriz-webapp/lecture-fec) — détail de l'utilisation dans le contexte de l'empreinte sociétale.

---

## Installation

```bash
npm install @lasocietenouvelle/fec-reader
```

Requiert **Node.js ≥ 20**. Package en **ES Modules uniquement** (`"type": "module"` dans votre `package.json`).

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

## Formats acceptés

| Critère | Valeurs acceptées |
|---------|-------------------|
| Extensions | `.txt`, `.csv` |
| Encodage | Auto-détecté — UTF-8 (avec ou sans BOM), Windows-1252 / ISO 8859-15, ASCII (spec DGFiP art. A 47 A-1 LPF) |
| Séparateur | Tabulation `\t` ou pipe `\|` |
| Colonnes montant | Débit / Crédit (format standard) ou Montant / Sens (format alternatif — converti automatiquement) |
| Colonnes devise | `MontantDevise` ou `Montantdevise`, `IDevise` ou `Idevise` |

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

Parse le contenu d'un fichier FEC et retourne la structure JSON décrite ci-dessous.

**Paramètre :**

| Nom | Type | Description |
|-----|------|-------------|
| `input` | `Buffer \| ArrayBuffer \| Uint8Array` | Contenu brut du fichier FEC — encodage auto-détecté |

**Retour :** un objet `FECResult` contenant `books` et `meta` (voir [Structure de sortie](#structure-de-sortie)).

**Erreurs levées :**

| Condition | Message |
|-----------|---------|
| Séparateur non reconnu | `Séparateur non reconnu (attendu : tabulation ou pipe)` |
| Colonnes obligatoires manquantes | `Fichier erroné (libellé(s) manquant(s) : <colonnes>)` |
| Ligne incomplète | `Erreur - Ligne incomplète (<numéro de ligne>)` |

---

### `mapAssetAccounts(accounts)`

Enrichit un plan de comptes avec les correspondances entre comptes d'actif et leurs comptes d'amortissement ou de dépréciation associés.
Utilisé en interne par `FECReader`, mais exporté pour un usage autonome.

**Paramètre :**

| Nom | Type | Description |
|-----|------|-------------|
| `accounts` | `Record<string, { accountNum, accountLib }>` | Dictionnaire de comptes indexé par numéro |

**Retour :** le même dictionnaire enrichi avec `directMatching`, `assetAccountNum`, etc.

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

---

## Structure de sortie

### `FECResult`

| Propriété | Type | Description |
|-----------|------|-------------|
| `books` | `Record<string, FECBook>` | Journaux comptables indexés par code journal |
| `meta.accounts` | `Record<string, FECAccount>` | Comptes généraux enrichis |
| `meta.accountsAux` | `Record<string, FECAccount>` | Comptes auxiliaires (tiers) |
| `meta.period.firstDate` | `string \| null` | Date de la première écriture (YYYYMMDD) |
| `meta.period.lastDate` | `string \| null` | Date de la dernière écriture (YYYYMMDD) |

### `FECBook`

| Propriété | Type | Description |
|-----------|------|-------------|
| `label` | `string` | Libellé du journal |
| `type` | `BookType` | Type classifié (voir [Classification des journaux](#classification-des-journaux)) |
| `lineCount` | `number` | Nombre total de lignes d'écriture |
| `lastDate` | `string` | Date de la dernière écriture (YYYYMMDD) |
| `entries` | `Record<string, FECRow[]>` | Écritures regroupées par numéro d'écriture |

### `FECRow`

| Champ | Type | Description |
|-------|------|-------------|
| `JournalCode` | `string` | Code journal |
| `JournalLib` | `string` | Libellé journal |
| `EcritureNum` | `string` | Numéro d'écriture |
| `EcritureDate` | `string` | Date d'écriture (YYYYMMDD) |
| `CompteNum` | `string` | Numéro de compte général |
| `CompteLib` | `string` | Libellé du compte général |
| `CompAuxNum` | `string?` | Numéro de compte auxiliaire |
| `CompAuxLib` | `string?` | Libellé du compte auxiliaire |
| `PieceRef` | `string` | Référence de pièce |
| `PieceDate` | `string` | Date de pièce (YYYYMMDD) |
| `EcritureLib` | `string` | Libellé de l'écriture |
| `Debit` | `number` | Montant débit (converti depuis Montant/Sens si nécessaire) |
| `Credit` | `number` | Montant crédit (converti depuis Montant/Sens si nécessaire) |
| `EcritureLet` | `string?` | Lettrage de l'écriture |
| `DateLet` | `string?` | Date de lettrage |
| `ValidDate` | `string?` | Date de validation |
| `Montantdevise` | `string?` | Montant en devise d'origine |
| `Idevise` | `string?` | Identifiant de devise |

### `FECAccount`

| Propriété | Type | Description |
|-----------|------|-------------|
| `accountNum` | `string` | Numéro de compte |
| `accountLib` | `string` | Libellé du compte |
| `directMatching` | `boolean?` | Vrai si un compte actif correspondant a été trouvé |
| `assetAccountNum` | `string?` | Numéro du compte d'actif associé |
| `assetAccountLib` | `string?` | Libellé du compte d'actif associé |
| `amortisationAccountNum` | `string?` | Numéro du compte d'amortissement lié |
| `depreciationAccountNum` | `string?` | Numéro du compte de dépréciation lié |

---

## Classification des journaux

Chaque journal est automatiquement classifié selon son code et son libellé :

| Type | Codes reconnus | Libellés reconnus |
|------|---------------|-------------------|
| `ANOUVEAUX` | `AN`, `RAN`, `AA`, `AD` | `A NOUVEAUX`, `A NOUVEAU` |
| `VENTES` | `VT`, `VE` | `VENTES` |
| `ACHATS` | `HA` | `ACHATS`, `BANQUE` |
| `OPERATIONS` | `OD`, `ODA`, `INV` | *(aucun libellé fixe)* |
| `AUTRE` | — | Tout journal non classifié ci-dessus |

---

## Licence

MIT — [La Société Nouvelle](https://lasocietenouvelle.org)

---

## Support et contribution

Pour signaler un bug, demander une fonctionnalité ou contribuer au projet :
- [Ouvrir une issue sur GitHub](https://github.com/lasocietenouvelle/fec-reader/issues)
- [Consulter le code source](https://github.com/lasocietenouvelle/fec-reader)

Les contributions sont les bienvenues ! Veuillez ouvrir une issue avant de proposer une pull request pour discuter des changements.

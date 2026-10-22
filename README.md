# @lasocietenouvelle/fec-reader

[![npm](https://img.shields.io/npm/v/@lasocietenouvelle/fec-reader)](https://www.npmjs.com/package/@lasocietenouvelle/fec-reader)

Parser de fichiers FEC (Fichier des Écritures Comptables)

Transforme un FEC brut en structure JSON exploitable : journaux, écritures groupées, comptes, période comptable.

Le FEC est un fichier normalisé produit par les logiciels de comptabilité et remis à l'administration fiscale (DGFiP) lors des contrôles.

---

## Installation

```bash
npm install @lasocietenouvelle/fec-reader
```

Requiert **Node.js ≥ 20**. Package en **ES Modules uniquement** (`"type": "module"`).

---

## Utilisation

```js
import { readFileSync } from 'fs';
import { FECReader } from '@lasocietenouvelle/fec-reader';

const buffer = readFileSync('./mon-fichier.txt');  // Buffer brut, pas d'encodage à préciser

try {
  const result = FECReader(buffer);  // encodage auto-détecté

  console.log(result.Metadonnees.Periode);      // { DateDebut: '20240101', DateFin: '20241231' }
  console.log(Object.keys(result.Journaux));     // [ 'AN', 'ACH', 'VTE', 'OD' ]

  const { AnomaliesParType: n } = result;
  if (n['colonnes'] || n['montant-invalide'] || n['sens-invalide']) {
    console.error('FEC non conforme', result.Anomalies);
  }
} catch (error) {
  console.error('Erreur de parsing FEC :', error.message); // séparateur/en-tête invalide, cas irrécupérable
}
```

---

## Formats acceptés

| Critère | Valeurs acceptées |
|---------|-------------------|
| Extensions | `.txt`, `.csv` |
| Encodage | Auto-détecté : UTF-8 (avec ou sans BOM), Windows-1252 / ISO 8859-15, ASCII |
| Séparateur | Tabulation `\t` ou pipe `\|` |
| Colonnes montant | `Debit` / `Credit` (standard) ou `Montant` / `Sens` (converti automatiquement) |

Les dates sont conservées au format source **YYYYMMDD** (format DGFiP).

---

## API

### `FECReader(input, options?) → FECData`

| Option | Type | Défaut | Description |
|--------|------|--------|-------------|
| `lignes` | `boolean` | `true` | Si `false`, `Ecritures[num].Lignes[]` n'est pas construit : seuls les agrégats sont conservés. |
| `onLigne` | `(ligne, contexte) => void` | `null` | Callback par ligne, avec `contexte = { journalCode, journalLib, ecritureNum, ecritureDate, compteNum, compAuxNum }`. `ligne` inclut `CompteLib`/`CompAuxLib`. Si fourni, `Lignes[]` n'est jamais construit, même avec `lignes: true`. |
| `nomFichier` | `string` | `null` | Nom d'origine (`<Siren>FEC<AAAAMMJJ>.txt`) : SIREN et date de clôture extraits dans `Metadonnees.Fichier`. N'affecte pas le parsing. |
| `champs` | `string[]` | `null` (tous) | Liste blanche des champs construits par ligne, parmi les clés de [`LigneEcriture`](#ligneecriture) + `CompteLib`/`CompAuxLib`. Un nom inconnu lève une erreur. |
| `maxAnomalies` | `number` | `1000` | Nombre maximal d'anomalies détaillées **par type** dans `Anomalies`. `AnomaliesParType` reste exact. `0` ne garde que les compteurs, `Infinity` désactive le plafond. Une valeur qui n'est pas un nombre ≥ 0 lève une erreur. |

```js
// Aperçu sans rétention des lignes
const apercu = FECReader(buffer, { lignes: false });

// Agrégation custom au fil du parsing, sans rétention par le package
const totauxParCompte = {};
FECReader(buffer, {
  onLigne: (ligne, { compteNum }) => {
    totauxParCompte[compteNum] = (totauxParCompte[compteNum] ?? 0) + ligne.Debit - ligne.Credit;
  },
});

// Ne construire que les champs consommés en aval
FECReader(buffer, { champs: ['CompteNum', 'CompteLib', 'Debit', 'Credit'] });
```

**Erreurs levées** (cas irrécupérables) : type d'entrée invalide, séparateur non reconnu, colonnes obligatoires manquantes dans l'en-tête. Une ligne de données mal formée ne lève pas d'exception : elle est signalée dans `result.Anomalies` (voir [Anomalies](#anomalies)) et le parsing continue.

---

### `readFECLignes(input, options?) → AsyncGenerator<Item[]>`

Parcourt les lignes du FEC par lots, sans jamais construire `Journaux`/`Comptes`. Pensé pour les gros fichiers, en cédant régulièrement la main à l'event loop. Node.js uniquement.

| Option | Type | Défaut | Effet |
|--------|------|--------|-------|
| `champs` | `string[]` | `null` | Identique à `FECReader.champs`. |
| `intervalleCedeMain` | `number` | `1000` | Lignes par lot yield, et entre deux cessions à l'event loop. |

```js
import { readFECLignes } from '@lasocietenouvelle/fec-reader';

for await (const lot of readFECLignes(buffer, { champs: ['CompteNum', 'Debit', 'Credit'] })) {
  for (const item of lot) {
    if ('anomalie' in item) { console.warn(item.anomalie.Message); continue; }
    const { ligne, contexte } = item;
    // traiter la ligne...
  }
}
```

Pour obtenir les agrégats (`Journaux`/`Comptes`) en plus du streaming, faire un second appel à `FECReader` (synchrone, rapide) sur le même contenu.

---

## Structure de sortie

### `FECData`

| Propriété | Type | Description |
|-----------|------|-------------|
| `Journaux` | `Record<string, Journal>` | Journaux comptables indexés par code journal |
| `Comptes` / `ComptesAux` | `Record<string, { Libelle }>` | Comptes généraux / auxiliaires indexés par numéro |
| `Anomalies` | `Anomalie[]` | Anomalies rencontrées, plafonnées à `maxAnomalies` par type (voir [Anomalies](#anomalies)) |
| `AnomaliesParType` | `Partial<Record<AnomalieType, number>>` | Nombre exact d'anomalies par type, jamais plafonné |
| `Metadonnees.Periode` | `{ DateDebut, DateFin }` | Bornes de la période (YYYYMMDD) |
| `Metadonnees.Fichier` | `{ Encodage, Separateur, Format, Siren, ClotureExercice }` | Métadonnées détectées / extraites de `options.nomFichier` |

### `Journal` / `Ecriture`

`Journal = { Libelle, NombreEcritures, NombreLignes, DerniereDate, Ecritures }`, où `Ecritures[num] = { EcritureDate, Lignes? }` (`Lignes` absent si `{ lignes: false }` ou `{ onLigne }`).

### `LigneEcriture`

Champs conformes à la norme DGFiP. `JournalCode`, `JournalLib`, `EcritureDate`, `EcritureNum`, `CompteLib`, `CompAuxLib` sont omis (portés par la structure ou disponibles via `Comptes`/`ComptesAux`) :

`CompteNum`, `CompAuxNum`, `PieceRef`, `PieceDate`, `EcritureLib`, `Debit`, `Credit`, `EcritureLet`, `DateLet`, `ValidDate`, `MontantDevise`, `IDevise`.

### Anomalies

`Anomalie = { Ligne, Type, Message, Champs?, Valeurs? }`. `Ligne` est 1-indexé, en-tête inclus. Les montants sont contrôlés sur chaque ligne, quelles que soient les options (`lignes`, `onLigne`, `champs`), dans `FECReader` comme dans `readFECLignes`.

| `Type` | Cas | Ligne |
|--------|-----|-------|
| `colonnes` | Nombre de colonnes non réconciliable | ignorée |
| `montant-vide` | `Debit` / `Credit` vide (la norme DGFiP attend `0,00`) | conservée, montant 0 |
| `montant-invalide` | Montant non conforme | conservée, montant 0 |
| `sens-invalide` | Format `Montant`/`Sens` : `Sens` autre que `D` / `C` | conservée, montants 0 |

Montant conforme : `^[+-]?\d{1,15}([.,]\d+)?$` après retrait des guillemets et espaces en bordure (`1234,56`, `1234.56`, `-12`, `+12,00`). Sont refusés les séparateurs de milliers (`1.234,56`, `1 234,56`), les lettres, plusieurs séparateurs décimaux, les décimales sans partie entière (`,5`) et une partie entière de plus de 15 chiffres. `Sens` est sensible à la casse : `d` est refusé.

- **Une anomalie par ligne et par type** : `Debit` et `Credit` vides donnent une seule anomalie, avec `Champs: ['Debit', 'Credit']`.
- `Valeurs` porte les valeurs brutes lues pour `montant-invalide` et `sens-invalide` (ex. `{ Debit: '12a4,50' }`).
- Format `Montant`/`Sens` : `Champs` désigne `Debit` ou `Credit` selon le sens. Si le `Sens` est invalide, seule `sens-invalide` est produite.
- Un montant refusé est lu comme **0** : l'écriture concernée devient déséquilibrée. Décider du blocage sur `AnomaliesParType`.

---

## Licence

EUPL-1.2, [La Société Nouvelle](https://lasocietenouvelle.org)

## Support et contribution

- [Ouvrir une issue sur GitHub](https://github.com/la-societe-nouvelle/fec-reader/issues)
- [Consulter le code source](https://github.com/la-societe-nouvelle/fec-reader)
- [Voir le changelog](https://github.com/la-societe-nouvelle/fec-reader/blob/main/CHANGELOG.md)

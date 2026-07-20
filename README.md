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

  if (result.Anomalies.length > 0) {
    console.warn(`${result.Anomalies.length} ligne(s) ignorée(s)`, result.Anomalies);
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

**Erreurs levées** (cas irrécupérables) : type d'entrée invalide, séparateur non reconnu, colonnes obligatoires manquantes dans l'en-tête. Une ligne de données mal formée (nombre de colonnes incorrect) ne lève pas d'exception : elle est signalée dans `result.Anomalies` (`{ Ligne, Message }`) et le parsing continue.

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
| `Anomalies` | `{ Ligne, Message }[]` | Lignes ignorées pendant le parsing (colonnes incorrectes) |
| `Metadonnees.Periode` | `{ DateDebut, DateFin }` | Bornes de la période (YYYYMMDD) |
| `Metadonnees.Fichier` | `{ Encodage, Separateur, Format, Siren, ClotureExercice }` | Métadonnées détectées / extraites de `options.nomFichier` |

### `Journal` / `Ecriture`

`Journal = { Libelle, NombreEcritures, NombreLignes, DerniereDate, Ecritures }`, où `Ecritures[num] = { EcritureDate, Lignes? }` (`Lignes` absent si `{ lignes: false }` ou `{ onLigne }`).

### `LigneEcriture`

Champs conformes à la norme DGFiP. `JournalCode`, `JournalLib`, `EcritureDate`, `EcritureNum`, `CompteLib`, `CompAuxLib` sont omis (portés par la structure ou disponibles via `Comptes`/`ComptesAux`) :

`CompteNum`, `CompAuxNum`, `PieceRef`, `PieceDate`, `EcritureLib`, `Debit`, `Credit`, `EcritureLet`, `DateLet`, `ValidDate`, `MontantDevise`, `IDevise`.

---

## Licence

EUPL-1.2, [La Société Nouvelle](https://lasocietenouvelle.org)

## Support et contribution

- [Ouvrir une issue sur GitHub](https://github.com/la-societe-nouvelle/fec-reader/issues)
- [Consulter le code source](https://github.com/la-societe-nouvelle/fec-reader)
- [Voir le changelog](https://github.com/la-societe-nouvelle/fec-reader/blob/main/CHANGELOG.md)

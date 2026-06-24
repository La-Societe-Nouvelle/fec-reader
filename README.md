# @lasocietenouvelle/fec-reader

[![npm](https://img.shields.io/npm/v/@lasocietenouvelle/fec-reader)](https://www.npmjs.com/package/@lasocietenouvelle/fec-reader)

Parser de fichiers FEC — **Fichier des Écritures Comptables**

Transforme un FEC brut en structure JSON exploitable : journaux, écritures groupées, comptes, période comptable.

Le FEC est un fichier normalisé produit par les logiciels de comptabilité et remis à l'administration fiscale (DGFiP) lors des contrôles. Il contient l'ensemble des écritures comptables d'un exercice.

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

  console.log(result.meta.periode);
  // { premiereDate: '20240101', derniereDate: '20241231' }

  console.log(Object.keys(result.journaux));
  // [ 'AN', 'ACH', 'VTE', 'OD' ]

} catch (error) {
  console.error('Erreur de parsing FEC :', error.message);
}
```

**Navigateur**

```js
import { FECReader } from '@lasocietenouvelle/fec-reader';

input.addEventListener('change', async (e) => {
  const buffer = await e.target.files[0].arrayBuffer();
  const result = FECReader(buffer);  // encodage auto-détecté
});
```

---

## Formats acceptés

| Critère | Valeurs acceptées |
|---------|-------------------|
| Extensions | `.txt`, `.csv` |
| Encodage | Auto-détecté — UTF-8 (avec ou sans BOM), Windows-1252 / ISO 8859-15, ASCII |
| Séparateur | Tabulation `\t` ou pipe `\|` |
| Colonnes montant | `Debit` / `Credit` (format standard) ou `Montant` / `Sens` (format alternatif — converti automatiquement) |

Les colonnes `Montant` et `Sens` sont automatiquement converties en `Debit` et `Credit`.

Les dates sont conservées au format source **YYYYMMDD** (format DGFiP).

---

## API

### `FECReader(input)`

Parse le contenu d'un fichier FEC et retourne la structure JSON décrite ci-dessous.

**Paramètre :**

| Nom | Type | Description |
|-----|------|-------------|
| `input` | `string \| Buffer \| ArrayBuffer \| Uint8Array` | Contenu du fichier FEC — les octets bruts sont auto-décodés |

**Retour :** un objet [`FECData`](#fecdata).

**Erreurs levées :**

| Condition | Message |
|-----------|---------|
| Type d'entrée invalide | `FECReader : paramètre invalide (string, Buffer ou ArrayBuffer attendu)` |
| Séparateur non reconnu | `Séparateur non reconnu (attendu : tabulation ou pipe)` |
| Colonnes obligatoires manquantes | `Fichier erroné (libellé(s) manquant(s) : <colonnes>)` |
| Ligne avec colonnes manquantes | `Fichier FEC incomplet — colonne(s) manquante(s) à la ligne N : <colonnes>` |
| Ligne avec trop de colonnes | `Fichier FEC invalide — trop de colonnes à la ligne N` |
| Fichier corrompu | `Le fichier FEC semble corrompu ou mal exporté (ligne N : X colonne(s) lue(s) sur Y attendues)` |

---

## Structure de sortie

### `FECData`

| Propriété | Type | Description |
|-----------|------|-------------|
| `journaux` | `Record<string, Journal>` | Journaux comptables indexés par code journal |
| `comptes` | `Record<string, Compte>` | Comptes généraux indexés par numéro de compte |
| `comptesAux` | `Record<string, Compte>` | Comptes auxiliaires (tiers) indexés par numéro |
| `meta.periode.premiereDate` | `string \| null` | Date de la première écriture (YYYYMMDD) |
| `meta.periode.derniereDate` | `string \| null` | Date de la dernière écriture (YYYYMMDD) |
| `meta.fichier.encodage` | `string` | Encodage détecté (`UTF-8`, `UTF-8 BOM`, `Windows-1252`) |
| `meta.fichier.separateur` | `string` | Séparateur détecté (`\t` ou `\|`) |
| `meta.fichier.format` | `string` | Format détecté (`standard` ou `avecSens`) |

### `Journal`

| Propriété | Type | Description |
|-----------|------|-------------|
| `libelle` | `string` | Libellé du journal |
| `nbLignes` | `number` | Nombre total de lignes d'écriture |
| `derniereDate` | `string` | Date de la dernière écriture du journal (YYYYMMDD) |
| `ecritures` | `Record<string, LigneEcriture[]>` | Lignes regroupées par numéro d'écriture |

### `LigneEcriture`

Champs conformes à la norme DGFiP. `JournalCode`, `JournalLib`, `EcritureNum`, `CompteLib` et `CompAuxLib` sont omis — ils sont portés par la structure (`journaux["ACH"]`, `ecritures["AC0001"]`) ou disponibles via `comptes[CompteNum]` et `comptesAux[CompAuxNum]`.

| Champ | Type | Description |
|-------|------|-------------|
| `EcritureDate` | `string` | Date d'écriture (YYYYMMDD) |
| `CompteNum` | `string` | Numéro de compte général |
| `CompAuxNum` | `string` | Numéro de compte auxiliaire (tiers) |
| `PieceRef` | `string` | Référence de pièce justificative |
| `PieceDate` | `string` | Date de la pièce (YYYYMMDD) |
| `EcritureLib` | `string` | Libellé de l'écriture |
| `Debit` | `number` | Montant débit |
| `Credit` | `number` | Montant crédit |
| `EcritureLet` | `string` | Code de lettrage |
| `DateLet` | `string` | Date de lettrage (YYYYMMDD) |
| `ValidDate` | `string` | Date de validation (YYYYMMDD) |
| `MontantDevise` | `string` | Montant en devise d'origine |
| `IDevise` | `string` | Code devise (ex : `EUR`, `USD`) |

### `Compte`

| Propriété | Type | Description |
|-----------|------|-------------|
| `compteLib` | `string` | Libellé du compte |

---

## Licence

EUPL-1.2 — [La Société Nouvelle](https://lasocietenouvelle.org)

---

## Support et contribution

Pour signaler un bug ou proposer une amélioration :
- [Ouvrir une issue sur GitHub](https://github.com/lasocietenouvelle/fec-reader/issues)
- [Consulter le code source](https://github.com/lasocietenouvelle/fec-reader)

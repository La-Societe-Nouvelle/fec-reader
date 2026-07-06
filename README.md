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

  console.log(result.Metadonnees.Periode);
  // { DateDebut: '20240101', DateFin: '20241231' }

  console.log(Object.keys(result.Journaux));
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

### `FECReader(input, options?)`

Parse le contenu d'un fichier FEC et retourne la structure JSON décrite ci-dessous.

**Paramètres :**

| Nom | Type | Description |
|-----|------|-------------|
| `input` | `string \| Buffer \| ArrayBuffer \| Uint8Array` | Contenu du fichier FEC — les octets bruts sont auto-décodés |
| `options.lignes` | `boolean` (défaut `true`) | Si `false`, les lignes ne sont pas matérialisées dans `Ecritures[num].Lignes[]` — seuls les agrégats (`NombreEcritures`, `NombreLignes`, `DerniereDate`, `EcritureDate`) sont conservés. Utile pour prévisualiser un gros FEC ou n'en extraire que les métadonnées, sans retenir chaque ligne en mémoire. |
| `options.onLigne` | `(ligne, contexte) => void` | Callback invoqué pour chaque ligne de données parsée. `contexte` expose `{ journalCode, journalLib, ecritureNum, ecritureDate, compteNum, compAuxNum }` déjà nettoyés. `ligne` inclut `CompteLib` et `CompAuxLib` (retirés en mode `Lignes[]` classique car déjà disponibles via `Comptes`/`ComptesAux`, mais utiles ici puisque la ligne n'est jamais retenue après l'appel). Permet de construire ses propres agrégats (ex : totaux par compte) au fil du parsing, sans que le package retienne les lignes. Quand `onLigne` est fourni, `Ecritures[num].Lignes[]` n'est jamais construit, quelle que soit la valeur de `lignes`. |

**Retour :** un objet [`FECData`](#fecdata).

**Mode allégé — exemple :**

```js
import { FECReader } from '@lasocietenouvelle/fec-reader';

// Aperçu/metadonnées uniquement, sans retenir les lignes en mémoire
const apercu = FECReader(buffer, { lignes: false });
console.log(apercu.Metadonnees.Periode, apercu.Journaux['ACH'].NombreLignes);

// Agrégation métier orchestrée par l'appelant, sans rétention des lignes par le package
const totauxParCompte = {};
FECReader(buffer, {
  onLigne: (ligne, { compteNum }) => {
    totauxParCompte[compteNum] = (totauxParCompte[compteNum] ?? 0) + ligne.Debit - ligne.Credit;
  },
});
```

Utile pour un simple aperçu ou une extraction de métadonnées sur un gros fichier, sans retenir le détail ligne par ligne.

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
| `Journaux` | `Record<string, Journal>` | Journaux comptables indexés par code journal |
| `Comptes` | `Record<string, Compte>` | Comptes généraux indexés par numéro de compte |
| `ComptesAux` | `Record<string, Compte>` | Comptes auxiliaires (tiers) indexés par numéro |
| `Metadonnees.Periode.DateDebut` | `string \| null` | Date de début de période (YYYYMMDD) |
| `Metadonnees.Periode.DateFin` | `string \| null` | Date de fin de période (YYYYMMDD) |
| `Metadonnees.Fichier.Encodage` | `string` | Encodage détecté (`UTF-8`, `UTF-8 BOM`, `Windows-1252`) |
| `Metadonnees.Fichier.Separateur` | `string` | Séparateur détecté (`\t` ou `\|`) |
| `Metadonnees.Fichier.Format` | `string` | Format détecté (`standard` ou `avecSens`) |

### `Journal`

| Propriété | Type | Description |
|-----------|------|-------------|
| `Libelle` | `string` | Libellé du journal |
| `NombreEcritures` | `number` | Nombre total d'écritures |
| `NombreLignes` | `number` | Nombre total de lignes d'écriture |
| `DerniereDate` | `string` | Date de la dernière écriture du journal (YYYYMMDD) |
| `Ecritures` | `Record<string, Ecriture>` | Lignes regroupées par numéro d'écriture |

### `Ecriture`

| Propriété | Type | Description |
|-----------|------|-------------|
| `EcritureDate` | `string` | Date d'écriture (YYYYMMDD) |
| `Lignes` | `LigneEcriture[]` (optionnel) | Lignes de l'écriture. Absent lorsque `{ lignes: false }` ou `{ onLigne }` a été utilisé. |

### `LigneEcriture`

Champs conformes à la norme DGFiP. `JournalCode`, `JournalLib`, `EcritureDate`, `EcritureNum`, `CompteLib` et `CompAuxLib` sont omis — ils sont portés par la structure (`Journaux["ACH"]`, `Ecritures["AC0001"]`) ou disponibles via `Comptes[CompteNum]` et `ComptesAux[CompAuxNum]`.

| Champ | Type | Description |
|-------|------|-------------|
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
| `Libelle` | `string` | Libellé du compte |

---

## Licence

EUPL-1.2 — [La Société Nouvelle](https://lasocietenouvelle.org)

---

## Support et contribution

Pour signaler un bug ou proposer une amélioration :
- [Ouvrir une issue sur GitHub](https://github.com/la-societe-nouvelle/fec-reader/issues)
- [Consulter le code source](https://github.com/la-societe-nouvelle/fec-reader)

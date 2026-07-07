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
| `options.nomFichier` | `string` | Nom du fichier d'origine (ex : `"552100554FEC20231231.txt"`). Si fourni, le SIREN et la date de clôture d'exercice sont extraits du nom selon la convention DGFiP `<Siren>FEC<AAAAMMJJ>` et exposés dans `Metadonnees.Fichier.Siren` / `Metadonnees.Fichier.ClotureExercice`. `null` si non fourni ou si le nom ne suit pas la convention. N'affecte pas le parsing du contenu — utile pour vérifier a posteriori que la date de clôture déclarée dans le nom correspond à `Metadonnees.Periode.DateFin` déduite du contenu. |
| `options.champs` | `string[]` | Liste blanche des champs à construire pour chaque ligne (`Lignes[]` ou argument de `onLigne`), parmi `CompteNum`, `CompAuxNum`, `PieceRef`, `PieceDate`, `EcritureLib`, `Debit`, `Credit`, `EcritureLet`, `DateLet`, `ValidDate`, `MontantDevise`, `IDevise`, `CompteLib`, `CompAuxLib`. Si non fourni, tous les champs sont construits (comportement historique). Un nom de champ inconnu lève une erreur. `CompteLib`/`CompAuxLib` explicitement demandés priment toujours sur l'auto-exclusion habituelle en mode `lignes: true`. Réduit le travail de parsing par ligne — utile quand seul un sous-ensemble des champs est réellement consommé en aval. |

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

**Champs restreints — exemple :**

```js
// Preview : seuls les champs affichés sont construits par ligne
const apercu = FECReader(buffer, { champs: ['CompteNum', 'CompteLib', 'EcritureLib'] });

// Production : les 11 champs réellement consommés, sans le reste (PieceRef, EcritureLet...)
const complet = FECReader(buffer, {
  champs: ['CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'EcritureLib', 'Debit', 'Credit'],
});
```

**Rapport simplifié par journal :**

```js
const result = FECReader(buffer, {
  champs: ['CompteNum', 'CompteLib', 'Debit', 'Credit'], // Ignore PieceRef, EcritureLet, etc.
});

console.log(result.Journaux['ACH'].Ecritures['AC0001'].Lignes[0]);
// { CompteNum: "60600", CompteLib: "Fournitures admin.", Debit: 1200, Credit: 0 }
```

**Vérification de cohérence SIREN/date :**

```js
const result = FECReader(buffer, { nomFichier: "123456789FEC20241231.txt" });

// Vérifier que la date de clôture dans le nom correspond à la période du fichier
if (result.Metadonnees.Fichier.ClotureExercice !== result.Metadonnees.Periode.DateFin) {
  console.warn("La date de clôture dans le nom de fichier ne correspond pas à la période du FEC !");
}

const siren = result.Metadonnees.Fichier.Siren;
if (!siren) console.warn("Le nom de fichier ne suit pas la convention DGFiP.");
```

**Erreurs levées** (cas irrécupérables — rien ne peut être parsé) :

| Condition | Message |
|-----------|---------|
| Type d'entrée invalide | `FECReader : paramètre invalide (string, Buffer ou ArrayBuffer attendu)` |
| Séparateur non reconnu | `Séparateur non reconnu (attendu : tabulation ou pipe)` |
| Colonnes obligatoires manquantes dans l'en-tête | `Fichier erroné (libellé(s) manquant(s) : <colonnes>)` |

**Lignes de données mal formées : pas d'exception**

Une ligne dont le nombre de colonnes est incorrect (colonnes manquantes ou en trop) n'interrompt pas le parsing : elle est ignorée et signalée dans `result.Anomalies` (`{ Ligne, Message }`), le reste du fichier est traité normalement. Utile pour ne pas devoir réimporter le fichier à chaque correction lors du nettoyage d'un FEC :

```js
const result = FECReader(buffer);
if (result.Anomalies.length > 0) {
  console.warn(`${result.Anomalies.length} ligne(s) ignorée(s) :`, result.Anomalies);
}
```

| Message d'anomalie |
|---------------------|
| `Fichier FEC incomplet — colonne(s) manquante(s) à la ligne N : <colonnes>` |
| `Fichier FEC invalide — trop de colonnes à la ligne N (<N> colonne(s) en trop)` |
| `Le fichier FEC semble corrompu ou mal exporté (ligne N : X colonne(s) lue(s) sur Y attendues)` |

---

### Itération asynchrone (`readFECLignes`)

Pour un parsing volumineux sur un serveur à process partagé, `readFECLignes`
permet de traiter les lignes sans bloquer l'event loop. Il yield des **lots**
d'items (pas une ligne à la fois) :

```js
import { readFECLignes } from '@lasocietenouvelle/fec-reader';

for await (const lot of readFECLignes(buffer, { champs: ['CompteNum', 'Debit', 'Credit'] })) {
  for (const item of lot) {
    if ('anomalie' in item) {
      console.warn(item.anomalie.Message);
      continue;
    }
    const { ligne, contexte } = item;
    // traiter la ligne...
  }
}
```

Contrairement à `FECReader`, `readFECLignes` ne construit aucun agrégat
(`Journaux`/`Comptes`/`Anomalies`) : c'est un flux pur. Pour obtenir l'agrégat
en plus du streaming, faites un second appel à `FECReader` (synchrone, rapide)
sur le même contenu.

Options : `champs` (identique à `FECReader`), `intervalleCedeMain` (nombre de
lignes par lot yield, et nombre de lignes entre deux cessions de la main à
l'event loop, défaut `1000`).

**Pourquoi des lots et pas une ligne à la fois ?** Un `for await` qui
consommerait une ligne à la fois forcerait le générateur à traverser le
protocole des générateurs async (résolution de promesse) à chaque ligne. Ce
coût, négligeable isolément, s'est révélé significatif sous un contexte
`AsyncLocalStorage` imbriqué (ex. une Server Action Next.js avec `auth()` +
contexte de requête) : mesuré en conditions réelles, un flux ligne par ligne
sur ~420 000 lignes était 2 à 4x plus lent que l'équivalent synchrone, et
instable (RSS croissante d'un appel à l'autre dans le même process). Yield par
lot de `intervalleCedeMain` ramène le nombre de points de suspension du
générateur d'un par ligne à un par lot, ce qui restaure une performance stable
et comparable au parsing synchrone. Détails et mesures dans le
`CHANGELOG.md` (section `[2.0.0-beta.1]`).

`readFECLignes` est réservé à Node.js : il utilise `setImmediate` en interne,
indisponible dans les navigateurs (contrairement à `FECReader`, qui accepte
`ArrayBuffer` pour un usage `FileReader` en environnement navigateur).

**Traitement par lots avec suivi de progression :**

```js
import { readFECLignes } from '@lasocietenouvelle/fec-reader';

let lignesTraitees = 0;
const montantsTotaux = { debit: 0, credit: 0 };

for await (const lot of readFECLignes(buffer, {
  intervalleCedeMain: 5000, // Cède la main tous les 5000 lignes
  champs: ['CompteNum', 'Debit', 'Credit'],
})) {
  for (const item of lot) {
    if ('anomalie' in item) {
      console.warn(`Ligne ${item.anomalie.Ligne} : ${item.anomalie.Message}`);
      continue;
    }
    montantsTotaux.debit += item.ligne.Debit;
    montantsTotaux.credit += item.ligne.Credit;
    lignesTraitees++;
  }
  console.log(`Traité : ${lignesTraitees} lignes...`);
}
```

---

### Tableau récapitulatif des options

| Option | Type | Défaut | Description | Cas d'usage |
|--------|------|--------|-------------|-------------|
| `lignes` | `boolean` | `true` | Si `false`, désactive `Ecritures[num].Lignes[]` | Prévisualisation, métadonnées, gros fichiers |
| `onLigne` | `(ligne, contexte) => void` | `null` | Callback par ligne (`ligne`, `contexte`) | Streaming, agrégation custom |
| `nomFichier` | `string` | `null` | Nom du fichier (ex : `"SIRENFECYYYYMMDD.txt"`) | Extraction SIREN/date de clôture |
| `champs` | `string[]` | `null` | Liste blanche des champs à construire | Réduction mémoire, performance |

---

## Structure de sortie

### `FECData`

| Propriété | Type | Description |
|-----------|------|-------------|
| `Journaux` | `Record<string, Journal>` | Journaux comptables indexés par code journal |
| `Comptes` | `Record<string, Compte>` | Comptes généraux indexés par numéro de compte |
| `ComptesAux` | `Record<string, Compte>` | Comptes auxiliaires (tiers) indexés par numéro |
| `Anomalies` | `{ Ligne: number, Message: string }[]` | Lignes de données ignorées pendant le parsing (nombre de colonnes incorrect). Tableau vide si le fichier est valide. |
| `Metadonnees.Periode.DateDebut` | `string \| null` | Date de début de période (YYYYMMDD) |
| `Metadonnees.Periode.DateFin` | `string \| null` | Date de fin de période (YYYYMMDD) |
| `Metadonnees.Fichier.Encodage` | `string` | Encodage détecté (`UTF-8`, `UTF-8 BOM`, `Windows-1252`) |
| `Metadonnees.Fichier.Separateur` | `string` | Séparateur détecté (`\t` ou `\|`) |
| `Metadonnees.Fichier.Format` | `string` | Format détecté (`standard` ou `avecSens`) |
| `Metadonnees.Fichier.Siren` | `string \| null` | SIREN extrait de `options.nomFichier`, ou `null` |
| `Metadonnees.Fichier.ClotureExercice` | `string \| null` | Date de clôture d'exercice (YYYYMMDD) extraite de `options.nomFichier`, ou `null` |

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

Forme commune à `Comptes` et `ComptesAux` :

| Propriété | Type | Description |
|-----------|------|-------------|
| `Libelle` | `string` | Libellé du compte |

---

## Migration depuis v1.x

### ⚠️ Changement cassant : gestion des lignes mal formées

**Avant (v1.x)** :

```js
try {
  const result = FECReader(buffer);
} catch (e) {
  console.error("Erreur :", e.message); // Incluait les lignes mal formées
}
```

**Depuis v2.0** : les lignes mal formées ne lèvent plus d'exception — elles sont signalées dans `result.Anomalies` et le parsing continue.

```js
const result = FECReader(buffer);
if (result.Anomalies.length > 0) {
  console.warn(`${result.Anomalies.length} ligne(s) ignorée(s) :`);
  result.Anomalies.forEach(a => console.warn(`Ligne ${a.Ligne} : ${a.Message}`));
}
// result.Journaux, result.Comptes, etc. contiennent les données valides
```

Les erreurs irrécupérables (séparateur non reconnu, colonnes manquantes dans l'en-tête) lèvent toujours une exception — seul le traitement des lignes mal formées a changé.

---

## Licence

EUPL-1.2 — [La Société Nouvelle](https://lasocietenouvelle.org)

---

## Support et contribution

Pour signaler un bug ou proposer une amélioration :
- [Ouvrir une issue sur GitHub](https://github.com/la-societe-nouvelle/fec-reader/issues)
- [Consulter le code source](https://github.com/la-societe-nouvelle/fec-reader)

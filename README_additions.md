# Sections à ajouter au README.md

---

## 📌 1. Remplacer la section "Mode allégé" (lignes 93-111) par cette version améliorée

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

**Aperçu complet avec métadonnées :**

```js
import { FECReader } from '@lasocietenouvelle/fec-reader';

const apercu = FECReader(buffer, {
  lignes: false,
  nomFichier: "123456789FEC20241231.txt"
});

console.log(`Période : ${apercu.Metadonnees.Periode.DateDebut} → ${apercu.Metadonnees.Periode.DateFin}`);
console.log(`SIREN : ${apercu.Metadonnees.Fichier.Siren}`);
console.log(`Clôture : ${apercu.Metadonnees.Fichier.ClotureExercice}`);
console.log(`Journaux :`, Object.keys(apercu.Journaux));
console.log(`Lignes totales :`, Object.values(apercu.Journaux)
  .reduce((sum, j) => sum + j.NombreLignes, 0));
console.log(`Anomalies :`, apercu.Anomalies.length);
```

**Agrégation custom avec `onLigne` :**

```js
import { FECReader } from '@lasocietenouvelle/fec-reader';

const soldeParCompte = {};

FECReader(buffer, {
  onLigne: (ligne, { compteNum }) => {
    soldeParCompte[compteNum] = (soldeParCompte[compteNum] ?? 0)
      + ligne.Debit - ligne.Credit;
  }
});

// Résultat : { "60600": 1200, "401000": -1440, ... }
console.log(soldeParCompte);
```

**Avantage** : Aucune ligne n'est stockée en mémoire — idéal pour les fichiers > 100k lignes.

---

## 📌 2. Ajouter après "Champs restreints — exemple:" (ligne 113)

**Exemple avancé : Rapport simplifié par journal :**

```js
import { FECReader } from '@lasocietenouvelle/fec-reader';

const result = FECReader(buffer, {
  champs: ['CompteNum', 'CompteLib', 'Debit', 'Credit'] // Ignore PieceRef, EcritureLet, etc.
});

// Résultat : chaque ligne ne contient que les 4 champs demandés
console.log(result.Journaux['ACH'].Ecritures['AC0001'].Lignes[0]);
// { CompteNum: "60600", CompteLib: "Fournitures admin.", Debit: 1200, Credit: 0 }
```

**Gain** : ~50% de mémoire en moins si vous n'avez besoin que de 4-5 champs sur 13.

---

## 📌 3. Ajouter dans la section "Itération asynchrone" (après ligne 177)

**Traitement par lots avec `FECLignesAsync` (Node.js) :**

```js
import { FECLignesAsync } from '@lasocietenouvelle/fec-reader';

let comptesTraites = 0;
let montantsTotaux = { debit: 0, credit: 0 };

for await (const lot of FECLignesAsync(buffer, {
  intervalleCedeMain: 5000, // Cède la main tous les 5000 lignes
  champs: ['CompteNum', 'Debit', 'Credit'] // Seuls ces champs sont construits
})) {
  for (const item of lot) {
    if ('anomalie' in item) {
      console.warn(`Ligne ${item.anomalie.Ligne} : ${item.anomalie.Message}`);
      continue;
    }
    montantsTotaux.debit += item.ligne.Debit;
    montantsTotaux.credit += item.ligne.Credit;
    comptesTraites++;
  }
  // Progression
  console.log(`Traité : ${comptesTraites} lignes...`);
}

console.log(`Total : ${comptesTraites} lignes (D: ${montantsTotaux.debit}, C: ${montantsTotaux.credit})`);
```

**Pourquoi `intervalleCedeMain` ?**
Sans lui, un `for await` ligne-à-ligne serait **2-4× plus lent** sous `AsyncLocalStorage` (ex: Next.js Server Actions), à cause du coût de résolution de promesse par ligne. Le batching restaure des performances stables.

---

## 📌 4. Ajouter dans la section "API" après la description de `nomFichier`

**Vérification de cohérence SIREN/date :**

```js
import { FECReader } from '@lasocietenouvelle/fec-reader';

const result = FECReader(buffer, {
  nomFichier: "123456789FEC20241231.txt"
});

// Vérifier que la date de clôture dans le nom correspond à la période du fichier
if (result.Metadonnees.Fichier.ClotureExercice !== result.Metadonnees.Periode.DateFin) {
  console.warn("⚠️ La date de clôture dans le nom de fichier ne correspond pas à la période du FEC !");
}

// Extraire le SIREN pour l'associer à une entreprise
const siren = result.Metadonnees.Fichier.Siren;
if (!siren) console.warn("Le nom de fichier ne suit pas la convention DGFiP.");
```

---

## 📌 5. Ajouter dans la section "Lignes de données mal formées" (après ligne 142)

**Diagnostic des anomalies :**

```js
import { FECReader } from '@lasocietenouvelle/fec-reader';

const result = FECReader(buffer);

if (result.Anomalies.length > 0) {
  console.log(`⚠️ ${result.Anomalies.length} ligne(s) ignorée(s) :`);
  result.Anomalies.forEach(({ Ligne, Message }) => {
    console.log(`  Ligne ${Ligne} : ${Message}`);
  });

  // Option : Réessayer avec un sous-ensemble de lignes valides
  const { Anomalies, ...rest } = result;
  // `rest` contient les données parsées (sans les lignes en erreur)
}
```

**Types de messages :**

| Message | Description |
|---------|-------------|
| `Fichier FEC incomplet — colonne(s) manquante(s) à la ligne N : <colonnes>` | Quelques colonnes manquantes (moins de la moitié) |
| `Fichier FEC invalide — trop de colonnes à la ligne N (<N> colonne(s) en trop)` | Trop de colonnes |
| `Le fichier FEC semble corrompu ou mal exporté (ligne N : X colonne(s) lue(s) sur Y attendues)` | Beaucoup de colonnes manquantes (>= 50%) |

---

## 📌 6. Ajouter ce tableau récapitulatif après la section API

### Tableau récapitulatif des options

| Option | Type | Défaut | Description | Cas d'usage |
|--------|------|--------|-------------|-------------|
| `lignes` | `boolean` | `true` | Si `false`, désactive `Ecritures[num].Lignes[]` | Prévisualisation, métadonnées, gros fichiers |
| `onLigne` | `(ligne, contexte) => void` | `null` | Callback par ligne (`ligne`, `contexte`) | Streaming, agrégation custom |
| `nomFichier` | `string` | `null` | Nom du fichier (ex: `"SIRENFECYYYYMMDD.txt"`) | Extraction SIREN/date de clôture |
| `champs` | `string[]` | `null` | Liste blanche des champs à construire | Réduction mémoire, performance |

---

## 📌 7. Ajouter cette section "Migration depuis v1.x" avant la section "Licence"

## Migration depuis v1.x

### ⚠️ Changement cassant : Gestion des lignes mal formées

**Avant (v1.x)** :
```js
try {
  const result = FECReader(buffer);
} catch (e) {
  console.error("Erreur :", e.message); // Inclut les lignes mal formées
}
```

**Depuis v2.0** :
Les lignes mal formées **ne lèvent plus d'exception** : elles sont signalées dans `result.Anomalies` et le parsing continue.

```js
const result = FECReader(buffer);
if (result.Anomalies.length > 0) {
  console.warn(`${result.Anomalies.length} ligne(s) ignorée(s) :`);
  result.Anomalies.forEach(a => console.warn(`Ligne ${a.Ligne} : ${a.Message}`));
}
// `result.Journaux`, `result.Comptes`, etc. contiennent les données valides
```

**Pourquoi ce changement ?**
- Permet de parser des fichiers **partiellement corrompus** (ex: export logiciel avec quelques lignes incomplètes).
- Plus robuste pour les workflows de nettoyage de FEC.
- Les erreurs **irréversibles** (séparateur non reconnu, colonnes manquantes dans l'en-tête) lèvent toujours une exception.


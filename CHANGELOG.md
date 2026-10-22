# CHANGELOG

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-03
### Added
- Première version stable de @lasocietenouvelle/fec-reader.
- Support des séparateurs tabulation/pipe et des formats Debit/Credit ou Montant/Sens.
- Auto-détection des encodages UTF-8, Windows-1252 et UTF-8 BOM.
- Types TypeScript complets (`FECData`, `Journal`, `LigneEcriture`, `Compte`).
- Suite de tests complète (41 tests couvrant parsing, encodage, erreurs, cas limites).
- Support de Node.js (Buffer, ArrayBuffer, Uint8Array) et du navigateur (File API).

---

## [1.1.0-beta.1]
### Added
- Option `{ lignes: false }` : ne matérialise plus `Ecritures[num].Lignes[]`, seuls les agrégats (`NombreEcritures`, `NombreLignes`, `DerniereDate`, `EcritureDate`) sont conservés. Utile pour un simple aperçu ou une extraction de métadonnées sur un gros fichier, sans retenir le détail ligne par ligne.
- Option `{ onLigne }` : callback invoqué pour chaque ligne parsée avec un contexte nettoyé (`journalCode`, `journalLib`, `ecritureNum`, `ecritureDate`, `compteNum`, `compAuxNum`), sans jamais construire `Lignes[]`. La ligne transmise inclut `CompteLib`/`CompAuxLib` (absents de `Lignes[]` classique).
- Option `{ nomFichier }` : extrait le SIREN et la date de clôture d'exercice du nom de fichier d'origine (convention DGFiP `<Siren>FEC<AAAAMMJJ>`), exposés dans `Metadonnees.Fichier.Siren`/`ClotureExercice`.
- Nouveau champ `Anomalies` (tableau de `{ Ligne, Message }`) : liste les lignes de données ignorées pendant le parsing, ainsi que les lignes conservées mais dont un montant (`Debit`/`Credit`/`Montant`) était vide.
- Option `{ champs }` : liste blanche des champs à construire par ligne (`Lignes[]` ou argument de `onLigne`). Si non fourni, tous les champs sont construits (comportement historique). Un nom de champ inconnu lève une erreur.
- `readFECLignes(input, options)` : itérateur async par lots de lignes (`options.intervalleCedeMain`, défaut 1000 items/lot), avec cession de la main à l'event loop après chaque lot, pour parser de gros fichiers FEC sans bloquer un serveur à process partagé. Ne construit aucun agrégat (voir `FECReader` pour Journaux/Comptes/Anomalies).
- Yield par lot plutôt que par ligne : un flux ligne par ligne s'est révélé nettement plus lent et instable sur un gros FEC. Le batching restaure une performance stable comparable au parsing synchrone.

### Changed
- `parseRow()` remplacé par un constructeur piloté par l'option `champs`, plus rapide quand `champs` restreint les colonnes construites. Aucun changement de comportement observable sans `champs`.
- Les montants vides (chaîne vide) sont désormais traités comme 0 au lieu de `NaN`, et signalés dans `Anomalies` (`Debit`/`Credit` vide n'est pas conforme à la norme DGFiP, qui attend un `0,00` explicite).

### Breaking
- Une ligne de données mal formée (nombre de colonnes incorrect) ne lève plus d'exception : elle est désormais ignorée et signalée dans `Anomalies`, le parsing se poursuit sur le reste du fichier. Le comportement pour les erreurs irrécupérables (séparateur non reconnu, colonnes d'en-tête manquantes, type d'entrée invalide) est inchangé : ces cas lèvent toujours une exception. Code appelant qui s'appuyait sur un `throw` pour détecter une ligne malformée : vérifier `result.Anomalies` à la place.

---

## [1.1.0-beta.2]
### Added
- Validation stricte des montants : un montant non conforme (`12a4,50`, `1 234,56`, `1.234,56`, `12,5,0`...) produit une anomalie `montant-invalide` et est lu comme 0. Auparavant, `parseFloat` en lisait silencieusement le début (`1 234,56` → 1).
- Format `Montant`/`Sens` : un `Sens` autre que `D`/`C` produit une anomalie `sens-invalide` (montants à 0, comme avant, mais désormais signalé).
- Champ `Type` sur chaque anomalie (`colonnes`, `montant-vide`, `montant-invalide`, `sens-invalide`), plus `Champs` et `Valeurs` (valeurs brutes) selon le type. `Message` inchangé pour les anomalies existantes.
- `FECData.AnomaliesParType` : nombre exact d'anomalies par type.
- Option `{ maxAnomalies }` (défaut 1000) : plafond du détail dans `Anomalies`, par type.

### Changed
- Le contrôle des montants est actif quelles que soient les options : `lignes: false`, `onLigne`, `champs` sans `Debit`/`Credit`, et `readFECLignes`.
- Raccourci dans le nettoyage des champs quand il n'y a rien à retirer : parsing 10 à 40 % plus rapide sur un FEC de 420 000 lignes.

### Breaking
- Des fichiers jusqu'ici lus sans anomalie peuvent maintenant en remonter : montants mal formés, `Sens` invalide, et montants vides désormais signalés aussi en mode `lignes: false` ou avec `champs` sans `Debit`/`Credit`.
- Un montant non numérique (`ABC,00`) est lu comme 0 au lieu de `NaN`, et les montants avec séparateur de milliers ou plusieurs virgules comme 0 au lieu d'une valeur tronquée.

---

## [Unreleased]

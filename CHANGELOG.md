# CHANGELOG

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2024-06-30
### Added
- First stable release of @lasocietenouvelle/fec-reader.
- Support for tab/pipe separators and Debit/Credit or Montant/Sens formats.
- Auto-detection of UTF-8, Windows-1252, and UTF-8 BOM encodings.
- Full TypeScript types (`FECData`, `Journal`, `LigneEcriture`, `Compte`).
- Comprehensive test suite (41 tests covering parsing, encoding, errors, edge cases).
- Support for Node.js (Buffer, ArrayBuffer, Uint8Array) and browser (File API).

---

## [Unreleased]
### Added
- Option `{ lignes: false }` : ne matérialise plus `Ecritures[num].Lignes[]`, seuls les agrégats (`NombreEcritures`, `NombreLignes`, `DerniereDate`, `EcritureDate`) sont conservés. Utile pour un simple aperçu ou une extraction de métadonnées sur un gros fichier, sans retenir le détail ligne par ligne.
- Option `{ onLigne }` : callback invoqué pour chaque ligne parsée avec un contexte nettoyé (`journalCode`, `journalLib`, `ecritureNum`, `ecritureDate`, `compteNum`, `compAuxNum`), sans jamais construire `Lignes[]`. La ligne transmise inclut `CompteLib`/`CompAuxLib` (absents de `Lignes[]` classique).
- Script `bench-memory.mjs` (`npm run bench:memory`) pour mesurer le gain mémoire du mode `{ lignes: false }`.

### Changed
- `parseRow()` remplacé par deux constructeurs à forme fixe (`parseRowStandard`/`parseRowAvecSens`), sans `delete` sur l'objet construit — ~2× plus rapide sur un FEC réel de ~420 000 lignes (V8 conserve une hidden class stable au lieu de repasser en mode dictionnaire à chaque ligne). Aucun changement de comportement observable.

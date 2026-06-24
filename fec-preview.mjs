// Script de test manuel — à lancer avec : node fec-preview.mjs <chemin-du-fec>
import { FECReader } from './src/index.js';
import { readFileSync, writeFileSync } from 'fs';

const fichier = process.argv[2];
if (!fichier) {
  console.error('Usage : node fec-preview.mjs <chemin-du-fec>');
  process.exit(1);
}

const t0 = performance.now();
const buffer = readFileSync(fichier);
const result = FECReader(buffer);
const duree = (performance.now() - t0).toFixed(1);

const nbJournaux  = Object.keys(result.journaux).length;
const nbEcritures = Object.values(result.journaux).reduce((acc, j) => acc + j.nbLignes, 0);

console.log(`\nParsing terminé en ${duree} ms`);
console.log('\n=== Fichier ===');
console.log('  Encodage   :', result.meta.fichier.encodage);
console.log('  Séparateur :', result.meta.fichier.separateur === '\t' ? 'tabulation' : 'pipe');
console.log('  Format     :', result.meta.fichier.format);

console.log('\n=== Période ===');
console.log('  Début exercice :', result.meta.periode.dateDebut);
console.log('  Fin exercice   :', result.meta.periode.dateFin);

console.log('\n=== Journaux ===', `(${nbJournaux} journaux, ${nbEcritures} lignes au total)`);
for (const [code, journal] of Object.entries(result.journaux)) {
  console.log(`  ${code.padEnd(6)} ${journal.libelle.padEnd(30)} ${journal.nbLignes} lignes`);
}

console.log('\n=== Comptes ===', `(${Object.keys(result.comptes).length} comptes principaux)`);
const extrait = Object.entries(result.comptes).slice(0, 5);
for (const [num, c] of extrait) console.log(`  ${num.padEnd(12)} ${c.compteLib}`);
if (Object.keys(result.comptes).length > 5) console.log('  ...');

console.log('\n=== Comptes auxiliaires ===', `(${Object.keys(result.comptesAux).length} tiers)`);
const extraitAux = Object.entries(result.comptesAux).slice(0, 5);
for (const [num, c] of extraitAux) console.log(`  ${num.padEnd(12)} ${c.compteLib}`);
if (Object.keys(result.comptesAux).length > 5) console.log('  ...');

console.log('\n=== Première écriture ===');
const premierJournal   = Object.values(result.journaux)[0];
const premiereEcriture = Object.values(premierJournal.ecritures)[0]?.[0];
if (premiereEcriture) console.log(premiereEcriture);

const jsonPath = fichier.replace(/\.[^.]+$/, '') + '-result.json';
writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
console.log(`\nRésultat exporté dans : ${jsonPath}`);

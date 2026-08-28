// World Hub package validation for Hero Collector.
// Implements the consumer side of Package Protocol 1: manifest and
// embedded-contract checks, full checksum verification, and reference
// resolution over an extracted package directory — all before any
// application state changes. The same behavioral rules are replicated
// in every World Hub consumer.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const APP_TYPE = 'hero-collector.content-pack';
export const SUPPORTED_PROTOCOL_VERSIONS = new Set([1]);
export const SUPPORTED_CONTRACT_VERSIONS = new Set([1]);

export class PackageError extends Error {}

const abs = (root, packagePath) => join(root, ...packagePath.split('/'));

function readJson(root, packagePath) {
  const file = abs(root, packagePath);
  if (!existsSync(file)) throw new PackageError(`The package is missing ${packagePath}.`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new PackageError(`The package file ${packagePath} is not valid JSON.`);
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function walk(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/** Validate an extracted package directory completely. */
export function loadPackage(root) {
  const manifest = readJson(root, 'manifest.json');
  if (manifest?.format !== 'world-hub-package') {
    throw new PackageError('This is not a World Hub package.');
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.has(manifest.protocolVersion)) {
    throw new PackageError('This package uses a newer World Hub protocol than this app understands.');
  }
  if (manifest.complete !== true) throw new PackageError('The package is marked incomplete.');
  if (manifest.applicationType !== APP_TYPE) {
    throw new PackageError(`This package is for “${manifest.applicationType}”, not for this app.`);
  }
  for (const key of ['publicationId', 'production', 'contract', 'sourceLibraryId', 'publishedAt', 'entities', 'sections']) {
    if (!(key in manifest)) throw new PackageError(`The package manifest is missing ${key}.`);
  }

  const contract = readJson(root, 'production/contract.json');
  if (contract?.format !== 'world-hub-application-contract') {
    throw new PackageError('The embedded application contract is not valid.');
  }
  if (contract.appType !== manifest.applicationType) {
    throw new PackageError('The embedded contract does not match the package application type.');
  }
  // `contract.contractVersion` is the contract FORMAT version and is what
  // this app supports; `manifest.contract.version` is the contract's revision
  // counter in the authoring library and grows with every edit.
  if (!SUPPORTED_CONTRACT_VERSIONS.has(contract.contractVersion)) {
    throw new PackageError('This package uses a contract version this app does not support.');
  }
  if (!Number.isInteger(manifest.contract.version) || manifest.contract.version < 1) {
    throw new PackageError('The package manifest carries an invalid contract revision.');
  }

  const checksums = readJson(root, 'checksums.json');
  for (const [packagePath, expected] of Object.entries(checksums)) {
    const file = abs(root, packagePath);
    if (!existsSync(file)) throw new PackageError(`The package is missing ${packagePath}.`);
    if (sha256(file) !== expected) {
      throw new PackageError(`A package file failed its checksum: ${packagePath}.`);
    }
  }
  const listed = new Set([...Object.keys(checksums), 'checksums.json']);
  for (const rel of walk(root)) {
    if (!listed.has(rel)) throw new PackageError(`The package contains an unlisted file: ${rel}.`);
  }

  const entities = readJson(root, 'catalog/entities.json');
  const worlds = readJson(root, 'catalog/worlds.json');
  const characters = readJson(root, 'catalog/characters.json');
  const relationships = readJson(root, 'catalog/relationships.json');
  const documents = readJson(root, 'catalog/documents.json');
  const assetIndex = readJson(root, 'assets/index.json');
  const content = readJson(root, 'production/content.json');

  const entityIds = new Set(entities.map((entity) => entity.id));
  for (const rel of relationships) {
    if (!entityIds.has(rel.sourceId) || !entityIds.has(rel.targetId)) {
      throw new PackageError('A packaged relationship references a missing record.');
    }
  }
  for (const doc of documents) {
    for (const entityId of doc.entityIds ?? []) {
      if (!entityIds.has(entityId)) throw new PackageError('A packaged document references a missing record.');
    }
    if (!existsSync(abs(root, doc.path))) throw new PackageError(`A document file is missing: ${doc.path}.`);
  }
  const assetIds = new Set(assetIndex.map((entry) => entry.assetId));
  for (const entry of assetIndex) {
    if (!existsSync(abs(root, entry.path))) throw new PackageError(`An asset file is missing: ${entry.path}.`);
  }
  for (const world of worlds) {
    for (const ref of [world.coverAssetId, world.backgroundAssetId]) {
      if (ref && !assetIds.has(ref)) throw new PackageError('A world profile references a missing asset.');
    }
  }
  for (const character of characters) {
    for (const ref of [character.portraitAssetId, character.tileAssetId]) {
      if (ref && !assetIds.has(ref)) throw new PackageError('A character profile references a missing asset.');
    }
  }
  for (const [slot, selected] of Object.entries(content.selections ?? {})) {
    for (const entityId of selected) {
      if (!entityIds.has(entityId)) throw new PackageError(`Selection “${slot}” references a missing record.`);
    }
  }
  for (const [setKey, itemsList] of Object.entries(content.assetSets ?? {})) {
    for (const item of itemsList) {
      if (!assetIds.has(item.assetId)) {
        throw new PackageError(`Asset set “${setKey}” references a missing asset.`);
      }
    }
  }

  return {
    root,
    manifest,
    contract,
    content,
    entities,
    worlds,
    characters,
    relationships,
    documents,
    assetIndex,
    checksums,
    entitiesById: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    assetFile(assetId, preferredRecipes = []) {
      const candidates = assetIndex.filter((entry) => entry.assetId === assetId);
      for (const recipe of preferredRecipes) {
        const match = candidates.find((entry) => entry.recipeId === recipe);
        if (match) return match;
      }
      return candidates[0] ?? null;
    },
  };
}

/** Hero Collector's own semantic pre-checks on the package content. */
export function semanticValidation(pkg) {
  const selections = pkg.content.selections ?? {};
  if (!(selections.hc_worlds ?? []).length) throw new PackageError('The package selects no worlds.');
  if (!(selections.hc_characters ?? []).length) throw new PackageError('The package selects no characters.');
  const values = pkg.content.values ?? {};
  if (!(values.hc_main_chapters ?? []).length) throw new PackageError('The package has no Main Campaign chapters.');
  for (const worldId of selections.hc_worlds) {
    const nodes = (pkg.content.entityValues?.[worldId] ?? {}).hc_campaign_nodes ?? [];
    if (nodes.length !== 30) throw new PackageError('A world does not have exactly 30 campaign nodes.');
  }
}

export function readCurrentPointer(productionDir) {
  try {
    const pointer = JSON.parse(readFileSync(join(productionDir, 'current.json'), 'utf8'));
    return pointer && typeof pointer === 'object' && pointer.publicationId ? pointer : null;
  } catch {
    return null;
  }
}

// Hero Collector's own reading of a World Hub package.
//
// The protocol-level work — manifest, checksums, references, ZIP safety —
// belongs to the shared kit under vendor/worldhub-kit and is identical in
// every consuming app. What lives here is the part only this game can judge:
// whether a structurally valid package actually describes a playable one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PackageError } from '../../../vendor/worldhub-kit/js/package-reader.mjs';

export const APP_TYPE = 'hero-collector.content-pack';

const vocabulary = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'vendor', 'worldhub-kit', 'vocabulary.json'),
  'utf8',
));

/**
 * What this build understands. A package published under a newer art
 * vocabulary is refused at load rather than resolving art through a name that
 * has since moved and arriving as missing pictures deep inside the game.
 */
export const READER_OPTIONS = {
  supportedVocabularyVersion: vocabulary.vocabularyVersion,
  renamedFrom: vocabulary.renamedFrom,
};

/** Hero Collector's semantic pre-checks on the package content. */
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

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

/**
 * Hero Collector's semantic pre-checks on the package content.
 *
 * Only what makes a package refusable outright belongs here. Everything a
 * publication can get *partly* wrong — too few heroes in a world, a Main
 * Campaign too short to introduce them, a cosmetic naming someone who left —
 * is held back by the compiler with a readable note instead, because refusing
 * the whole package over one world would lose the other three.
 */
export function semanticValidation(pkg) {
  const selections = pkg.content.selections ?? {};
  if (!(selections.hc_worlds ?? []).length) throw new PackageError('The package selects no worlds.');
  if (!(selections.hc_characters ?? []).length) throw new PackageError('The package selects no characters.');
  const values = pkg.content.values ?? {};
  if (!(values.hc_main_chapters ?? []).length) throw new PackageError('The package has no Main Campaign chapters.');

  /* Node names are plain strings now; they used to be records carrying a
     threshold, a material family and a grade. A package published under that
     older shape still passes every structural check — and would install, and
     run, with every authored name silently replaced by "Node 1". Refuse it
     instead, and say what to do.

     This reads the *shape of the data*, not the contract's revision counter:
     gating on that number refuses every publication after the next edit, which
     is a mistake this seam has already made once. */
  const stale = (list) => (list ?? []).some((entry) => entry !== null && typeof entry === 'object');
  const republish = 'It was published under an older revision of this contract. Re-import the contract in World Hub and republish the production.';
  for (const chapter of values.hc_main_chapters) {
    if (stale(chapter.chapter_nodes)) throw new PackageError(`This package's Main Campaign node names are not names. ${republish}`);
  }
  for (const worldId of selections.hc_worlds) {
    const nodes = (pkg.content.entityValues?.[worldId] ?? {}).hc_campaign_nodes;
    if (stale(nodes)) throw new PackageError(`This package's campaign node names are not names. ${republish}`);
  }
}

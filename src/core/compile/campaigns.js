// Campaign generation. A world's position in the manifest and a node's number
// decide everything mechanical about it; the manifest only supplies the name.
//
// The rule this file exists to enforce: a creative edit — renaming a node,
// swapping its art, reordering the fiction — must never change a threshold, a
// drop, a reward, or an ID.

/** Node n of a campaign (1-based) under a constant per-node growth. */
export function thresholdAt(curve, n, worldIndex = 0) {
  const worldScale = (1 + (curve.perWorldGrowthBp ?? 0) / 10000) ** worldIndex;
  const raw = curve.thresholdStart * worldScale * (1 + curve.thresholdGrowthBp / 10000) ** (n - 1);
  return Math.round(raw / curve.thresholdRound) * curve.thresholdRound;
}

/** The family rotation guarantees every family appears at every grade a
 *  campaign drops, so no recipe is left unbuildable by an unlucky draw. */
function familyAt(familyOrder, index, step, offset = 0) {
  return familyOrder[(offset + index * step) % familyOrder.length];
}

const materialId = (family, grade) => `mat_${family}_${grade}`;

/**
 * The World Campaign of one world: `nodes` nodes in `chapterSize` chapters,
 * relic pieces at the configured positions, reveals at the positions the
 * roster planner chose.
 */
export function compileWorldCampaign(balance, materialMeta, world, worldIndex, revealByPosition) {
  const config = balance.campaigns.world;
  const campaignId = `wc_${world.id}`;
  const stake = balance.rosterProgression.revealShardStake;
  const nodes = [];
  for (let index = 0; index < config.nodes; index++) {
    const number = index + 1;
    const chapter = Math.floor(index / config.chapterSize);
    const grade = config.gradeByChapter[Math.min(chapter, config.gradeByChapter.length - 1)];
    const family = familyAt(
      materialMeta.familyOrder, index,
      balance.campaigns.familyRotation.worldStep,
      worldIndex * balance.campaigns.familyRotation.worldOffsetPerWorld);
    const material = materialId(family, grade);
    const node = {
      id: `${campaignId}_${number}`,
      campaign: campaignId, world: world.id,
      chapter: chapter + 1, position: (index % config.chapterSize) + 1, number,
      chapterTitle: world.chapterTitles[chapter] ?? `${world.displayName} · Chapter ${chapter + 1}`,
      displayName: world.nodeNames[index] ?? `Node ${number}`,
      type: 'world',
      threshold: thresholdAt(config, number, worldIndex),
      material,
      previous: number === 1 ? null : `${campaignId}_${number - 1}`,
      repeatRewards: [],
      firstClearRewards: [],
      firstClear: { materials: [{ materialId: material, qty: config.firstClearMaterials }] }
    };
    const pieceIndex = config.relicPieceNodes.indexOf(number);
    if (pieceIndex !== -1) node.firstClear.relicPiece = `relic_${world.id}_p${pieceIndex + 1}`;
    const revealed = revealByPosition.get(number);
    if (revealed) {
      node.encounterCharacter = revealed;
      node.firstClear.shards = { characterId: revealed, qty: stake };
    }
    nodes.push(node);
  }
  return nodes;
}

/**
 * The Main Campaign: one chapter per authored chapter, ten nodes each. Its
 * opening nodes carry the reveals that let World Campaigns be unlocked at all.
 */
export function compileMainCampaign(balance, materialMeta, chapters, revealByNumber, { worldCount = 0 } = {}) {
  const config = balance.campaigns.main;
  const stake = balance.rosterProgression.revealShardStake;
  // An objective the live content cannot satisfy would be a permanent tease,
  // so world-spanning conditions are dropped when there are too few worlds.
  const objectives = (config.objectives ?? []).filter(objective =>
    objective.rule !== 'distinct_world_count' || worldCount >= objective.count);
  let checkpointIndex = 0;
  const nodes = [];
  chapters.forEach((chapter, chapterIndex) => {
    const grade = config.gradeLadder[Math.min(chapterIndex, config.gradeLadder.length - 1)];
    for (let position = 0; position < config.chapterSize; position++) {
      const number = chapterIndex * config.chapterSize + position + 1;
      const family = familyAt(materialMeta.familyOrder, number - 1, balance.campaigns.familyRotation.mainStep);
      const material = materialId(family, grade);
      const checkpoint = (position + 1) % config.checkpointEvery === 0;
      const node = {
        id: `main_${number}`,
        campaign: 'main', chapter: chapterIndex + 1, position: position + 1, number,
        chapterTitle: chapter.title,
        displayName: chapter.nodeNames[position] ?? `Node ${number}`,
        type: position + 1 >= config.advancedFromPosition ? 'advanced' : 'ordinary',
        threshold: thresholdAt(config, number),
        checkpoint,
        material,
        previous: number === 1 ? null : `main_${number - 1}`,
        world: null,
        repeatRewards: [],
        firstClearRewards: [],
        firstClear: checkpoint
          ? { materials: [{ materialId: material, qty: config.checkpointMaterials }], milestone: `Chapter ${chapterIndex + 1} checkpoint` }
          : { materials: [{ materialId: material, qty: config.firstClearMaterials }] }
      };
      if (checkpoint && objectives.length) {
        const objective = objectives[checkpointIndex % objectives.length];
        node.objective = {
          tagId: objective.tagId, rule: objective.rule, count: objective.count,
          text: objective.text,
          reward: { materials: [{ materialId: material, qty: objective.rewardQty }] }
        };
        checkpointIndex += 1;
      }
      const revealed = revealByNumber.get(number);
      if (revealed) {
        node.encounterCharacter = revealed;
        node.firstClear.shards = { characterId: revealed, qty: stake };
      }
      nodes.push(node);
    }
  });
  return nodes;
}

/** The world's relic: four pieces, each awarded by a fixed campaign node. */
export function compileRelic(balance, world) {
  const positions = balance.campaigns.world.relicPieceNodes;
  const roman = ['I', 'II', 'III', 'IV'];
  return {
    id: `relic_${world.id}`, world: world.id,
    displayName: world.relic.name,
    lore: world.relic.lore,
    pieces: positions.map((nodeNumber, index) => ({
      id: `relic_${world.id}_p${index + 1}`,
      position: index + 1,
      displayName: world.relic.pieces[index]?.name ?? `Piece ${roman[index] ?? index + 1}`,
      lore: world.relic.pieces[index]?.lore ?? '',
      sourceNode: `wc_${world.id}_${nodeNumber}`
    }))
  };
}

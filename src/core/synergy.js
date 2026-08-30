// Party synergy (GDD 7): tag-driven positive bonuses in integer basis points,
// evaluated from reusable TagDefinitions. Only the highest threshold in a
// stacking group applies; the total is capped by balance.synergyCapBp.
import { characterPowerForState } from './power.js';

// Evaluate one tag definition against a party (array of CharacterDefinitions).
// Returns { active, bonusBp, count, metThreshold, missing } — `missing` is a
// player-facing explanation of what would activate (or improve) the rule.
export function evaluateTag(content, tag, partyDefs) {
  let count = 0;
  switch (tag.activationRule) {
    case 'same_world_count': {
      const byWorld = {};
      for (const d of partyDefs) byWorld[d.world] = (byWorld[d.world] || 0) + 1;
      count = Math.max(0, ...Object.values(byWorld));
      break;
    }
    case 'distinct_world_count':
      count = new Set(partyDefs.map(d => d.world)).size;
      break;
    case 'archetype_pair': {
      const archetypes = new Set(partyDefs.map(d => d.archetype));
      count = tag.pair.every(a => archetypes.has(a)) ? 1 : 0;
      break;
    }
    case 'tag_count':
      count = partyDefs.filter(d => d.faction === tag.id).length;
      break;
    default:
      count = 0;
  }
  let met = null;
  for (const th of tag.thresholds) if (count >= th.count) met = th;
  const next = tag.thresholds.find(th => th.count > count);
  let missing = null;
  if (next) {
    if (tag.activationRule === 'archetype_pair') {
      const archetypes = new Set(partyDefs.map(d => d.archetype));
      const lack = tag.pair.filter(a => !archetypes.has(a))
        .map(a => content.archetypes[a].name);
      missing = `Add one ${lack.join(' and one ')} to activate ${tag.displayName}.`;
    } else if (tag.activationRule === 'same_world_count') {
      missing = `Field ${next.count} characters from a single world for +${next.bonusBp / 100}%.`;
    } else if (tag.activationRule === 'distinct_world_count') {
      missing = `Field characters from ${next.count} different worlds for +${next.bonusBp / 100}%.`;
    } else {
      missing = `Add ${next.count - count} more ${tag.displayName} member${next.count - count > 1 ? 's' : ''} for +${next.bonusBp / 100}%.`;
    }
  }
  return { tag, count, metThreshold: met, active: !!met, bonusBp: met ? met.bonusBp : 0, missing };
}

// Full party evaluation. members: array of character IDs (owned, unique).
// Returns itemized active/inactive bonuses, capped total, raw and effective power.
export function evaluateParty(content, state, members) {
  const defs = members.map(id => content.characterById[id]).filter(Boolean);
  const rawPower = members.reduce((sum, id) => {
    const cs = state.characters[id];
    return sum + (cs && cs.owned ? characterPowerForState(content, state, id) : 0);
  }, 0);

  const results = [];
  for (const tag of content.tags) {
    if (!tag.thresholds || tag.thresholds.length === 0) continue; // flavor-only tags
    // Only evaluate tag_count rules whose tag someone could plausibly carry.
    results.push(evaluateTag(content, tag, defs));
  }
  // Stacking groups: keep only the highest met threshold per group (definitions
  // already express thresholds within one tag; groups guard future content).
  const byGroup = {};
  for (const r of results) {
    if (!r.active) continue;
    const g = r.tag.stackingGroup;
    if (!byGroup[g] || r.bonusBp > byGroup[g].bonusBp) byGroup[g] = r;
  }
  const active = Object.values(byGroup);
  const inactive = results.filter(r => !r.active && r.missing);
  const totalBp = active.reduce((s, r) => s + r.bonusBp, 0);
  const cappedBp = Math.min(totalBp, content.balance.synergyCapBp);
  const effectivePower = Math.floor(rawPower * (10000 + cappedBp) / 10000);
  return { members, rawPower, active, inactive, totalBp, cappedBp, capped: totalBp > cappedBp, effectivePower };
}

// Party legality for a node (GDD 7.1, 8.2). Returns { legal, reason }.
export function partyLegality(content, state, members, node) {
  const size = content.balance.partySize;
  const filled = members.filter(Boolean);
  if (filled.length !== size) return { legal: false, reason: `A party needs exactly ${size} characters (${filled.length} selected).` };
  if (new Set(filled).size !== filled.length) return { legal: false, reason: 'The same character cannot appear twice.' };
  for (const id of filled) {
    const cs = state.characters[id];
    if (!cs || !cs.owned) return { legal: false, reason: `${content.characterById[id]?.displayName ?? id} is not owned.` };
  }
  if (node && node.type === 'world') {
    const off = filled.filter(id => content.characterById[id].world !== node.world);
    if (off.length > 0) {
      const w = content.worldById[node.world].displayName;
      return { legal: false, reason: `World nodes require five ${w} characters (${off.length} from other worlds).` };
    }
  }
  return { legal: true, reason: null };
}

// Does the party satisfy a node's optional objective?
export function objectiveSatisfied(content, objective, members) {
  const defs = members.map(id => content.characterById[id]).filter(Boolean);
  switch (objective.rule) {
    case 'tag_count':
      return defs.filter(d => d.faction === objective.tagId).length >= objective.count;
    case 'same_world_count': {
      const byWorld = {};
      for (const d of defs) byWorld[d.world] = (byWorld[d.world] || 0) + 1;
      return Math.max(0, ...Object.values(byWorld)) >= objective.count;
    }
    case 'distinct_world_count':
      return new Set(defs.map(d => d.world)).size >= objective.count;
    default:
      return false;
  }
}

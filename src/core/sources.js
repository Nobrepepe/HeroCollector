// Read-only source projections shared by Find Sources and Campaign.
import {
  nodeState, nodeUnlocked, nodeEnergyCost,
  checkClear, maxSweepCount, preferredPartyIndex, nodePartyMembers
} from './state.js';
import { focusStatus, isRevealed } from './focus.js';

export function rankMaterialSources(content, state, materialId, partyMembers = null) {
  const rows = (content.nodesByMaterial[materialId] ?? []).map(node => {
    const partyIndex = preferredPartyIndex(state, node.id);
    const members = partyMembers ?? nodePartyMembers(state, node.id).filter(Boolean);
    const status = nodeState(state, node.id);
    const unlock = nodeUnlocked(content, state, node);
    const check = checkClear(content, state, node.id, members, 1);
    const energy = nodeEnergyCost(content, node);
    const guaranteed = content.balance.nodeDefaults[node.type].repeat.count;
    const maxSweeps = status.cleared ? maxSweepCount(content, state, node.id) : 0;
    const sweepable = status.cleared && unlock.unlocked && check.ok && maxSweeps > 0;
    const available = !status.cleared && unlock.unlocked && check.ok;
    const bucket = sweepable ? 0 : available ? 1 : unlock.unlocked ? 2 : 3;
    return {
      node, status, unlock, check, energy, guaranteed, maxSweeps,
      partyIndex, members, sweepable, available, bucket,
      efficiency: guaranteed / energy
    };
  });
  rows.sort((a, b) =>
    a.bucket - b.bucket
    || b.efficiency - a.efficiency
    || a.node.number - b.node.number
    || a.node.id.localeCompare(b.node.id));
  const recommended = rows.find(r => r.sweepable || r.available);
  if (recommended) recommended.recommended = true;
  return rows;
}

// Where a hero's shards come from now: their encounter nodes (first-clear
// stakes plus the reveal itself), the Development Focus slots, and — once
// revealed — targeted grants (Tutoring, Mastery milestones, route leads).
export function rankShardSources(content, state, characterId) {
  const encounters = (content.encounterNodesByCharacter[characterId] ?? []).map(node => {
    const status = nodeState(state, node.id);
    const unlock = nodeUnlocked(content, state, node);
    return { node, status, unlock, claimed: status.firstClearClaimed };
  });
  const revealed = isRevealed(state, characterId);
  const focusSlot = focusStatus(content, state).find(entry => entry.characterId === characterId) ?? null;
  return { encounters, revealed, focusSlot };
}

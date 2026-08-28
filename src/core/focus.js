// Development Focus: deterministic shard generation. Three slots each hold a
// revealed hero; every point of Energy spent clearing campaign nodes advances
// all three meters, and full meters convert into shards automatically. Meter
// progress belongs to the SLOT: reassigning a hero keeps the accumulated
// Energy, and a maxed hero's slot holds its progress until someone new is
// assigned. All functions are deterministic; there is no RNG anywhere here.

export const FOCUS_SLOTS = ['primary', 'secondary', 'longTerm'];

export const FOCUS_SLOT_NAMES = {
  primary: 'Primary', secondary: 'Secondary', longTerm: 'Long-term'
};

export function focusRate(content, slot) {
  return content.balance.focus.rates[slot];
}

export function isRevealed(state, characterId) {
  const cs = state.characters[characterId];
  return !!(cs && (cs.revealed || cs.owned));
}

// Reveal a hero (campaign encounter, expedition lead, …). Returns true when
// this call actually revealed someone new.
export function revealCharacter(content, state, characterId) {
  const cs = state.characters[characterId];
  if (!cs || cs.revealed) return false;
  cs.revealed = true;
  return true;
}

// A hero who is owned at maximum Stars has no remaining use for shards, so a
// Focus slot holding one stops converting (and holds its progress).
export function focusHalted(state, characterId) {
  if (!characterId) return true;
  const cs = state.characters[characterId];
  return !cs || (cs.owned && cs.stars >= 7);
}

export function assignFocus(content, state, slot, characterId) {
  if (!FOCUS_SLOTS.includes(slot)) return { ok: false, reasons: ['Unknown Focus slot.'] };
  const slots = state.focus.slots;
  if (characterId === null) {
    slots[slot].characterId = null;
    return { ok: true, slot, characterId: null };
  }
  const cs = state.characters[characterId];
  if (!cs || !content.characterById[characterId]) return { ok: false, reasons: ['Unknown character.'] };
  if (!isRevealed(state, characterId)) return { ok: false, reasons: ['Only a revealed hero can be a Focus target. Encounter them in a campaign first.'] };
  if (cs.owned && cs.stars >= 7) return { ok: false, reasons: ['This hero is already at the 7-Star maximum.'] };
  // The same hero cannot occupy two slots: assigning moves them, and each
  // slot keeps its own accumulated progress.
  for (const other of FOCUS_SLOTS) {
    if (other !== slot && slots[other].characterId === characterId) slots[other].characterId = null;
  }
  slots[slot].characterId = characterId;
  return { ok: true, slot, characterId };
}

export function clearFocusSlot(state, slot) {
  if (!FOCUS_SLOTS.includes(slot)) return { ok: false, reasons: ['Unknown Focus slot.'] };
  state.focus.slots[slot].characterId = null;
  return { ok: true, slot };
}

// Advance all three meters by the Energy just spent. Full meters convert into
// shards immediately (no claim step); remainders carry over indefinitely.
// Returns one grant per slot that produced shards.
export function applyFocusEnergy(content, state, energy) {
  const grants = [];
  if (!Number.isInteger(energy) || energy <= 0) return grants;
  for (const slot of FOCUS_SLOTS) {
    const entry = state.focus.slots[slot];
    if (focusHalted(state, entry.characterId)) continue;
    const rate = focusRate(content, slot);
    entry.progress += energy;
    const shards = Math.floor(entry.progress / rate);
    if (shards > 0) {
      entry.progress -= shards * rate;
      state.characters[entry.characterId].shards += shards;
      grants.push({ slot, characterId: entry.characterId, shards });
    }
  }
  return grants;
}

export function focusStatus(content, state) {
  return FOCUS_SLOTS.map(slot => {
    const entry = state.focus.slots[slot];
    const rate = focusRate(content, slot);
    return {
      slot, name: FOCUS_SLOT_NAMES[slot], rate,
      characterId: entry.characterId,
      progress: entry.progress,
      energyToNext: entry.characterId ? rate - entry.progress : null,
      halted: focusHalted(state, entry.characterId)
    };
  });
}

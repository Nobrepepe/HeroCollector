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

// What a given Energy figure would produce, per slot, without writing a thing.
// Today's headline, the Node screen's cost line and applyFocusEnergy() all read
// this one function, so a promise made before the run and the payout after it
// can never disagree.
export function focusYield(content, state, energy) {
  const spend = Number.isInteger(energy) && energy > 0 ? energy : 0;
  return FOCUS_SLOTS.map(slot => {
    const entry = state.focus.slots[slot];
    const rate = focusRate(content, slot);
    const halted = focusHalted(state, entry.characterId);
    // A halted slot banks nothing and pays nothing: its progress stands still.
    const progress = halted ? entry.progress : entry.progress + spend;
    const shards = halted ? 0 : Math.floor(progress / rate);
    return {
      slot, name: FOCUS_SLOT_NAMES[slot], rate, halted,
      characterId: entry.characterId,
      shards, remainder: progress - shards * rate
    };
  });
}

// Advance all three meters by the Energy just spent. Full meters convert into
// shards immediately (no claim step); remainders carry over indefinitely.
// Returns one grant per slot that produced shards.
export function applyFocusEnergy(content, state, energy) {
  const grants = [];
  if (!Number.isInteger(energy) || energy <= 0) return grants;
  for (const paid of focusYield(content, state, energy)) {
    if (paid.halted) continue;
    state.focus.slots[paid.slot].progress = paid.remainder;
    if (paid.shards > 0) {
      state.characters[paid.characterId].shards += paid.shards;
      grants.push({ slot: paid.slot, characterId: paid.characterId, shards: paid.shards });
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

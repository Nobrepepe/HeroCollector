// Character Power (GDD 5): 1,000 Base + cumulative Star Power + permanent
// completed Gear Power + Power from currently equipped pieces.
// All values are integers; each equipped piece grants 10% of its tier's power.

export function cumulativeGearPower(balance, completedTier) {
  let total = 0;
  for (let t = 0; t < completedTier; t++) total += balance.gearTierPower[t];
  return total;
}

export function slotPower(balance, activeTier) {
  if (activeTier < 1 || activeTier > balance.gearTierPower.length) return 0;
  return Math.floor(balance.gearTierPower[activeTier - 1] * balance.gearSlotShareBp / 10000);
}

export function activeTier(balance, charState, maxGearTier = balance.gearTierPower.length) {
  const cap = Math.min(balance.gearTierPower.length, maxGearTier);
  return charState.gearTier >= cap ? null : charState.gearTier + 1;
}

export function characterPowerBreakdown(content, charState) {
  const b = content.balance;
  const base = b.basePower;
  const stars = charState.stars > 0 ? b.starPowerCumulative[charState.stars - 1] : 0;
  const gearPermanent = cumulativeGearPower(b, charState.gearTier);
  const tier = activeTier(b, charState, content.maxGearTier ?? b.gearTierPower.length);
  const equippedCount = tier ? Object.values(charState.slots).filter(Boolean).length : 0;
  const gearEquipped = tier ? equippedCount * slotPower(b, tier) : 0;
  return {
    base, stars, gearPermanent, gearEquipped, equippedCount,
    total: base + stars + gearPermanent + gearEquipped
  };
}

export function characterPower(content, charState) {
  return characterPowerBreakdown(content, charState).total;
}

// Power a Training path grants to every character of its world, by level.
// The Headquarters screen states this in words, so the table lives here rather
// than being restated where it is rendered.
const TRAINING_POWER_BY_LEVEL = [0, 25, 50, 100];

export function trainingPowerBonus(level) {
  return TRAINING_POWER_BY_LEVEL[level] ?? 0;
}

export function characterPowerForState(content, state, characterId) {
  const def = content.characterById[characterId];
  const base = characterPower(content, state.characters[characterId]);
  const training = def ? content.worldById[def.world]?.hq?.facilities.find(f => f.category === 'training') : null;
  const level = training ? state.headquarters?.worlds?.[def.world]?.facilities?.[training.id] ?? 0 : 0;
  return base + trainingPowerBonus(level);
}

export function maxCharacterPower(content) {
  const b = content.balance;
  return b.basePower
    + b.starPowerCumulative[b.starPowerCumulative.length - 1]
    + cumulativeGearPower(b, b.gearTierPower.length);
}

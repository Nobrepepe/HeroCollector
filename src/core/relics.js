// World relics: each world has exactly one major relic in four pieces, found
// by first-clearing the authored World Campaign nodes. Pieces grant Mastery
// only; the reconstructed relic is installed into one World Program.
//
// Holding all four pieces is not the same as owning the relic. `complete` says
// the four are in hand; `restored` says the player went to the Mastery track
// and bound them back into one object. Only a restored relic can be installed,
// so the binding is an act rather than a notification.

export function relicStatus(content, state, worldId) {
  const relic = content.relicByWorld[worldId];
  if (!relic) return null;
  const pieces = relic.pieces.map(piece => ({
    piece,
    owned: !!state.relics.pieces[piece.id],
    sourceNode: content.nodeById[piece.sourceNode] ?? null
  }));
  const ownedCount = pieces.filter(entry => entry.owned).length;
  const complete = ownedCount === relic.pieces.length;
  return {
    relic, pieces, ownedCount, total: relic.pieces.length, complete,
    // A stale bit — a piece that left the content set after the binding —
    // reads as unrestored rather than as a whole relic with a hole in it.
    restored: complete && !!state.relics.restored?.[worldId]
  };
}

// Returns true when this call granted a piece that was not already held.
export function grantRelicPiece(state, pieceId) {
  if (state.relics.pieces[pieceId]) return false;
  state.relics.pieces[pieceId] = true;
  return true;
}

// The binding. It grants nothing — no points, no payout — and that is the
// point: it is the only thing on the Mastery track the player does rather
// than earns, and it is what makes the relic installable.
export function restoreRelic(content, state, worldId) {
  const status = relicStatus(content, state, worldId);
  if (!status) return { ok: false, reasons: ['No relic has been written for this world.'] };
  if (!status.complete) {
    const missing = status.total - status.ownedCount;
    return { ok: false, reasons: [`${missing} piece${missing === 1 ? ' is' : 's are'} still buried.`] };
  }
  if (status.restored) return { ok: false, reasons: ['It is already whole.'] };
  (state.relics.restored ??= {})[worldId] = true;
  return { ok: true, worldId, relicId: status.relic.id, events: [] };
}

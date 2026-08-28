// World relics: each world has exactly one major relic in four pieces, found
// by first-clearing the authored World Campaign nodes. Pieces grant Mastery
// only; the reconstructed relic is installed into one World Program.

export function relicStatus(content, state, worldId) {
  const relic = content.relicByWorld[worldId];
  if (!relic) return null;
  const pieces = relic.pieces.map(piece => ({
    piece,
    owned: !!state.relics.pieces[piece.id],
    sourceNode: content.nodeById[piece.sourceNode] ?? null
  }));
  const ownedCount = pieces.filter(entry => entry.owned).length;
  return { relic, pieces, ownedCount, total: relic.pieces.length, complete: ownedCount === relic.pieces.length };
}

// Returns true when this call granted a piece that was not already held.
export function grantRelicPiece(state, pieceId) {
  if (state.relics.pieces[pieceId]) return false;
  state.relics.pieces[pieceId] = true;
  return true;
}

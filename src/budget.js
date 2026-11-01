// Codex: an optional paper seed must never change the live allocation.
export function resolveAllocationUsd(settings = {}) {
  const paper = Number(settings.paperAllocationUsd);
  const amount = settings.dryRun !== false && Number.isFinite(paper) && paper > 0
    ? paper : Number(settings.allocationUsd ?? 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

/**
 * 家族住宅虚拟世界(VW)的偏移量.
 * 范围:街道 0,机构 1-16,住宅 1000-1999,企业 2000-99999,家族 100000 及以上.
 */
export const FAMILY_WORLD_OFFSET = 100_000;

export function familyVirtualWorld(familyId: number): number {
  return FAMILY_WORLD_OFFSET + familyId;
}

export function isFamilyVirtualWorld(world: number): boolean {
  return world >= FAMILY_WORLD_OFFSET;
}

export function familyIdFromVirtualWorld(world: number): number | null {
  if (!isFamilyVirtualWorld(world)) {
    return null;
  }

  const familyId = world - FAMILY_WORLD_OFFSET;
  if (!Number.isInteger(familyId) || familyId < 1) {
    return null;
  }

  return familyId;
}

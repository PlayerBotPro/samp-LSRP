/** 房屋 VW 偏移范围：1000–1999（不与商店 2000+ 和家族 100000+ 重叠）。 */
export const HOUSE_WORLD_OFFSET = 1000;
/** 房屋 VW 范围上限（商店范围起点）。 */
const HOUSE_WORLD_END = 2000;

export function houseVirtualWorld(houseId: number): number {
  return HOUSE_WORLD_OFFSET + houseId;
}

export function isHouseVirtualWorld(world: number): boolean {
  return world >= HOUSE_WORLD_OFFSET && world < HOUSE_WORLD_END;
}

export function houseIdFromVirtualWorld(world: number): number | null {
  if (!isHouseVirtualWorld(world)) {
    return null;
  }

  const houseId = world - HOUSE_WORLD_OFFSET;
  if (!Number.isInteger(houseId) || houseId < 1) {
    return null;
  }

  return houseId;
}

/** 企业虚拟世界：2000–99999（不与住宅 1000–1999 和家族 100000+ 重叠）。 */
export const BUSINESS_WORLD_OFFSET = 2000;
/** 企业虚拟世界上限（家族范围的起点）。 */
const BUSINESS_WORLD_END = 100_000;

export function businessVirtualWorld(businessId: number): number {
  return BUSINESS_WORLD_OFFSET + businessId;
}

export function isBusinessVirtualWorld(world: number): boolean {
  return world >= BUSINESS_WORLD_OFFSET && world < BUSINESS_WORLD_END;
}

export function businessIdFromVirtualWorld(world: number): number | null {
  if (!isBusinessVirtualWorld(world)) {
    return null;
  }

  const businessId = world - BUSINESS_WORLD_OFFSET;
  if (!Number.isInteger(businessId) || businessId < 1) {
    return null;
  }

  return businessId;
}

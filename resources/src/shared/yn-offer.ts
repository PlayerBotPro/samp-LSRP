/** 每名玩家同时只能收到一个有效的 Y/N 请求（企业、载具、证件、邀请、selllic 等）。 */

export type YnOfferKind =
  | "biz"
  | "car"
  | "medcard"
  | "medhelp"
  | "pass"
  | "lic"
  | "show_medcard"
  | "vbilet"
  | "invite"
  | "finvite"
  | "selllic"
  | "sellgun"
  | "selldrug";

const activeBySlot = new Map<number, YnOfferKind>();

/** 占用请求槽位；如果已有其他请求，则返回 false。 */
export function claimYnOffer(slot: number, kind: YnOfferKind): boolean {
  if (activeBySlot.has(slot)) {
    return false;
  }
  activeBySlot.set(slot, kind);
  return true;
}

export function getYnOfferKind(slot: number): YnOfferKind | undefined {
  return activeBySlot.get(slot);
}

/** 清除请求；指定 kind 时，只清除类型匹配的请求。 */
export function releaseYnOffer(slot: number, kind?: YnOfferKind): void {
  if (kind !== undefined && activeBySlot.get(slot) !== kind) {
    return;
  }
  activeBySlot.delete(slot);
}

export function hasYnOffer(slot: number): boolean {
  return activeBySlot.has(slot);
}

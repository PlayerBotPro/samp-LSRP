import type { Player } from "@omp-node/core";
import { playerId } from "../../shared/player";

/** 购买流程自行写入现金期间，定期保存不会用旧值覆盖余额。 */
const holds = new Set<number>();

export function holdBusinessCash(slotId: number): void {
  holds.add(slotId);
}

export function releaseBusinessCash(slotId: number): void {
  holds.delete(slotId);
}

export function isBusinessCashHeld(player: Player): boolean {
  const id = playerId(player);
  return id !== null && holds.has(id);
}

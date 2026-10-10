import type { Player } from "@omp-node/core";
import { playerId } from "../../../shared/player";

/** 正在公交车司机班次中的玩家槽位. */
const activeSlots = new Set<number>();

export function isBusDriverOnShift(player: Player): boolean {
  const id = playerId(player);
  return id !== null && activeSlots.has(id);
}

export function setBusDriverShiftActive(slot: number, active: boolean): void {
  if (active) {
    activeSlots.add(slot);
  } else {
    activeSlots.delete(slot);
  }
}

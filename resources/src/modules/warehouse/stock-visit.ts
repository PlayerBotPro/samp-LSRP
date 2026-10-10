import type { Player } from "@omp-node/core";
import { playerId } from "../../shared/player";

/** 本次进入标记点时已显示菜单. */
const stockVisitByPlayer = new Set<number>();
/** 当前仓库对话框已打开,不要打断. */
const stockDialogBusy = new Set<number>();

export function isOrgStockDialogBusy(player: Player): boolean {
  const id = playerId(player);
  return id !== null && stockDialogBusy.has(id);
}

export function setOrgStockDialogBusy(player: Player, busy: boolean): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  if (busy) {
    stockDialogBusy.add(id);
  } else {
    stockDialogBusy.delete(id);
  }
}

/** @returns false - 本次进入标记点时已显示过菜单. */
export function markOrgStockVisit(player: Player): boolean {
  const id = playerId(player);
  if (id === null) {
    return false;
  }

  if (stockVisitByPlayer.has(id)) {
    return false;
  }

  stockVisitByPlayer.add(id);
  return true;
}

/** 离开标记点后,下次进入时可以再次打开. */
export function clearOrgStockVisit(player: Player): void {
  const id = playerId(player);
  if (id !== null) {
    stockVisitByPlayer.delete(id);
  }
}

export function clearOrgStockVisitById(id: number): void {
  stockVisitByPlayer.delete(id);
  stockDialogBusy.delete(id);
}

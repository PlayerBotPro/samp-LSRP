import type { Player } from "@omp-node/core";
import { playerId } from "../../shared/player";

/** 购买或兑换尚未完成时,不允许再次执行 /donate. */
const operations = new Set<number>();

/**
 * 将捐赠点兑换为现金时,会自行写入 `money` 字段.
 * 标记生效期间,定期保存不会用旧值覆盖现金余额.
 */
const walletHolds = new Set<number>();

export function isDonateBusy(player: Player): boolean {
  const id = playerId(player);
  return id !== null && operations.has(id);
}

export function isDonateWalletHeld(player: Player): boolean {
  const id = playerId(player);
  return id !== null && walletHolds.has(id);
}

/** 成功加锁时返回玩家槽位;null 表示槽位未知或已有购买正在进行. */
export function lockDonate(player: Player): number | null {
  const id = playerId(player);
  if (id === null || operations.has(id)) {
    return null;
  }

  operations.add(id);
  return id;
}

export function unlockDonate(slotId: number): void {
  operations.delete(slotId);
  walletHolds.delete(slotId);
}

export function holdDonateWallet(slotId: number): void {
  walletHolds.add(slotId);
}

export function releaseDonateWallet(slotId: number): void {
  walletHolds.delete(slotId);
}

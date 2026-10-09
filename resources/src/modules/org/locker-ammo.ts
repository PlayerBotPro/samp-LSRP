import type { Player } from "@omp-node/core";
import { isPlayerActive } from "../../shared/player";
import { grantWeapon } from "../anticheat/trust";
import { addWarehouseAmmo, getWarehouse, takeWarehouseAmmo } from "../warehouse";

/** 警棍不消耗仓库弹药。 */
const FREE_WEAPON_IDS = new Set<number>([3]);

export type LockerAmmoItem = {
  kind: "armor" | "weapon" | "skin" | string;
  id: number;
  ammo?: number;
};

/**
 * 每次发放要从仓库扣除多少弹药。
 * 护甲、皮肤、警棍为 0；枪械扣除完整的 `ammo`.
 */
export function lockerAmmoCost(item: LockerAmmoItem): number {
  if (item.kind !== "weapon") {
    return 0;
  }

  if (FREE_WEAPON_IDS.has(item.id)) {
    return 0;
  }

  return Math.max(0, Math.floor(item.ammo ?? 0));
}

/** 菜单项标签： `Desert Eagle (50 发子弹)` 免费时不显示括号。 */
export function lockerItemLabel(label: string, item: LockerAmmoItem): string {
  const cost = lockerAmmoCost(item);
  return cost > 0 ? `${label} (${cost} 发子弹)` : label;
}

/**
 * 从军械库发放武器：扣除库存 → 发放 → 失败时返还。
 * @returns 错误文本或 `null` 成功时。
 */
export function issueLockerWeapon(
  player: Player,
  orgId: number,
  weaponId: number,
  ammo: number,
  cost: number,
  refreshLabel: () => void
): string | null {
  const need = Math.max(0, Math.floor(cost));
  const giveAmmo = Math.max(1, Math.floor(ammo));

  if (need > 0) {
    if (!takeWarehouseAmmo(orgId, need)) {
      const have = getWarehouse(orgId)?.ammo ?? 0;
      return `仓库弹药不足（需要 ${need}，现有 ${have}).`;
    }
    refreshLabel();
  }

  if (!isPlayerActive(player) || !grantWeapon(player, weaponId, giveAmmo)) {
    if (need > 0) {
      addWarehouseAmmo(orgId, need);
      refreshLabel();
    }
    return "无法发放装备。";
  }

  return null;
}

import type { Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { applyHealth, getAccount, MAX_HEALTH, patchAccount } from "../auth/session";
import { findOwnedHouseAtInterior } from "./interior";

export function tryHealInHouse(player: Player): void {
  const house = findOwnedHouseAtInterior(player);
  if (!house) {
    player.sendClientMessage(Color.error, "此命令只能在自己的房屋内使用.");
    return;
  }

  if (!house.hasMedkit) {
    player.sendClientMessage(Color.error, "房屋里没有急救包.");
    return;
  }

  const account = getAccount(player);
  if (!account) {
    return;
  }

  patchAccount(player, { health: MAX_HEALTH });
  applyHealth(player, MAX_HEALTH);
  player.sendClientMessage(Color.info, "你已恢复健康.");
}

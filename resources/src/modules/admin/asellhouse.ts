import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { SERVER_TAG } from "../../shared/brand";
import { playerChatName } from "../../shared/player";
import { registerCommand } from "../commands/registry";
import { applyAdminVacatedHouse } from "../houses/rent";
import { adminVacateHouse, getHouse } from "../houses/repository";
import { getAccount } from "../auth/session";
import { hasAdminAccess } from "./session";

const MIN_ADMIN_LEVEL = 5;

function parseHouseId(args: string): number | null {
  const raw = args.trim();
  if (!/^\d+$/.test(raw) || raw.length > 5) {
    return null;
  }

  const houseId = Number(raw);
  if (!Number.isInteger(houseId) || houseId < 1) {
    return null;
  }

  return houseId;
}

export function bindAdminAsellhouse(): void {
  registerCommand(
    "asellhouse",
    "收回房屋(出售给政府,不予补偿)",
    (player, args) => {
      if (!hasAdminAccess(player, MIN_ADMIN_LEVEL)) {
        return;
      }

      const houseId = parseHouseId(args);
      if (houseId === null) {
        player.sendClientMessage(Color.error, "用法: /asellhouse [房屋 id]");
        return;
      }

      if (!getHouse(houseId)) {
        player.sendClientMessage(Color.error, "未找到该编号的房屋.");
        return;
      }

      void vacateHouse(player, houseId);
    },
    true
  );
}

async function vacateHouse(admin: Player, houseId: number): Promise<void> {
  const account = getAccount(admin);
  if (!account) {
    return;
  }

  let result;
  try {
    result = await adminVacateHouse(houseId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] asellhouse ${account.name} 房屋 ${houseId}:${message}`);
    admin.sendClientMessage(Color.error, "无法腾空房屋.");
    return;
  }

  if (!result.ok) {
    if (result.reason === "not_found") {
      admin.sendClientMessage(Color.error, "未找到该编号的房屋.");
      return;
    }
    admin.sendClientMessage(Color.error, "无法腾空房屋.");
    return;
  }

  applyAdminVacatedHouse(houseId);

  const label = playerChatName(admin);
  omp.log(`[${SERVER_TAG}] asellhouse ${label} 收回了 ${houseId} 号房屋`);

  if (result.wasOccupied) {
    admin.sendClientMessage(
      Color.info,
      `房屋 №${houseId} 已腾空.前任房主: id ${result.previousOwnerId}.`
    );
    return;
  }

  admin.sendClientMessage(Color.info, `房屋 №${houseId} 已经空置.状态已更新.`);
}

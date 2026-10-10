import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName } from "../../shared/player";
import { trustPosition } from "../anticheat/trust";
import { registerCommand } from "../commands/registry";
import { hasAdminAccess } from "./session";

const MIN_LEVEL = 1;
const SLAP_HEIGHT = 5;
const SLAP_VELOCITY = 0.85;

function broadcastAdmins(text: string): void {
  omp.players.forEach((other) => {
    if (!isPlayerActive(other) || !hasAdminAccess(other, 1)) {
      return;
    }

    try {
      other.sendClientMessage(Color.gray, text);
    } catch {
      // 槽位为空.
    }
  });
}

function slapPlayer(target: Player): boolean {
  try {
    if (target.isInAnyVehicle()) {
      target.removeFromVehicle();
    }
  } catch {
    // 已经不在载具中.
  }

  try {
    const pos = target.getPos();
    target.setPos(pos.x, pos.y, pos.z + SLAP_HEIGHT);
    trustPosition(target, pos.x, pos.y, pos.z + SLAP_HEIGHT);
  } catch {
    return false;
  }

  try {
    target.setVelocity(0, 0, SLAP_VELOCITY);
  } catch {
    // 位置已向上移动.
  }

  return true;
}

export function bindAdminSlap(): void {
  registerCommand(
    "slap",
    "将玩家向上抛起",
    (player, args) => {
      if (!hasAdminAccess(player, MIN_LEVEL)) {
        return;
      }

      const idPart = args.trim();
      if (!idPart) {
        player.sendClientMessage(Color.error, "用法: /slap [id]");
        return;
      }

      const slot = Number(idPart);
      if (!Number.isInteger(slot) || slot < 0) {
        player.sendClientMessage(Color.error, "用法: /slap [id]");
        return;
      }

      const target = omp.players.at(slot);
      if (!target || !isPlayerActive(target)) {
        player.sendClientMessage(Color.error, "未找到玩家.");
        return;
      }

      try {
        if (target.isNPC()) {
          player.sendClientMessage(Color.error, "未找到玩家.");
          return;
        }
      } catch {
        player.sendClientMessage(Color.error, "未找到玩家.");
        return;
      }

      if (!slapPlayer(target)) {
        player.sendClientMessage(Color.error, "无法击飞玩家.");
        return;
      }

      broadcastAdmins(
        `管理员 ${playerChatName(player)} 将 ${playerChatName(target)} 抛向空中.`
      );
    },
    true
  );
}

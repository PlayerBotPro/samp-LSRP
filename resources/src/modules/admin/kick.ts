import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CHAT_MAX_LENGTH, sanitizeChatText } from "../../shared/nearby";
import { isPlayerActive, kickSamePlayer, playerChatName } from "../../shared/player";
import { registerCommand } from "../commands/registry";
import { hasAdminAccess } from "./session";

function canUseKick(player: Player): boolean {
  return hasAdminAccess(player, 2);
}

function broadcastAll(color: number, text: string): void {
  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      other.sendClientMessage(color, text);
    } catch {
      // 槽位为空。
    }
  });
}

function kickSoon(player: Player): void {
  kickSamePlayer(player);
}

export function bindAdminKick(): void {
  registerCommand(
    "kick",
    "踢出玩家",
    (player, args) => {
      if (!canUseKick(player)) {
        return;
      }

      const raw = args.trim();
      const space = raw.indexOf(" ");
      const idPart = (space === -1 ? raw : raw.slice(0, space)).trim();
      const reason = sanitizeChatText(space === -1 ? "" : raw.slice(space + 1).trim()).slice(
        0,
        CHAT_MAX_LENGTH
      );

      if (!idPart) {
        player.sendClientMessage(
          Color.error,
          "用法: /kick [id] [原因 (可选)]"
        );
        return;
      }

      const slot = Number(idPart);
      if (!Number.isInteger(slot) || slot < 0) {
        player.sendClientMessage(
          Color.error,
          "用法: /kick [id] [原因 (可选)]"
        );
        return;
      }

      const target = omp.players.at(slot);
      if (!target || !isPlayerActive(target)) {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      try {
        if (target.isNPC()) {
          player.sendClientMessage(Color.error, "未找到玩家。");
          return;
        }
      } catch {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      const adminTag = playerChatName(player);
      const targetTag = playerChatName(target);
      const line = reason
        ? `管理员 ${adminTag} 踢出了玩家 ${targetTag}。原因：${reason}。`
        : `管理员 ${adminTag} 踢出了玩家 ${targetTag}。`;
      broadcastAll(Color.error, line);
      kickSoon(target);
    },
    true
  );
}

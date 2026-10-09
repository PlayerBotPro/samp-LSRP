import { omp } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { MAX_HEALTH, applyHealth, getAccount, patchAccount } from "../auth/session";
import { queueSave } from "../persist";
import { registerCommand } from "../commands/registry";
import { hasAdminAccess, isAdminLoggedIn } from "./session";

const MIN_SET_HP = 0;

function broadcastAdmins(text: string): void {
  omp.players.forEach((other) => {
    if (!isPlayerActive(other) || !hasAdminAccess(other, 1)) {
      return;
    }

    try {
      other.sendClientMessage(Color.gray, text);
    } catch {
      // 槽位为空。
    }
  });
}

function parseSethpArgs(args: string): { slot: number; hp: number } | null {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return null;
  }

  const slot = Number(parts[0]);
  const hp = Number(parts[1]);
  if (!Number.isInteger(slot) || slot < 0 || !Number.isFinite(hp)) {
    return null;
  }

  if (hp < MIN_SET_HP || hp > MAX_HEALTH) {
    return null;
  }

  return { slot, hp };
}

export function bindAdminSethp(): void {
  registerCommand(
    "sethp",
    "设置玩家生命值",
    (player, args) => {
      if (!hasAdminAccess(player, 4)) {
        return;
      }

      const parsed = parseSethpArgs(args);
      if (!parsed) {
        player.sendClientMessage(
          Color.error,
          "用法: /sethp [id] [hp] (0-100)"
        );
        return;
      }

      const target = omp.players.at(parsed.slot);
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

      const samePlayer = playerId(target) === playerId(player);
      if (!samePlayer && isAdminLoggedIn(target)) {
        player.sendClientMessage(
          Color.error,
          "禁止管理员更改生命值。"
        );
        return;
      }

      applyHealth(target, parsed.hp);
      if (getAccount(target)) {
        patchAccount(target, { health: parsed.hp });
        queueSave(target);
      }

      player.sendClientMessage(
        Color.info,
        `玩家 ${playerChatName(target)} 的 HP 已设置为: ${parsed.hp}`
      );
      broadcastAdmins(
        `[A] 管理员 ${playerChatName(player)} 将玩家 ${playerChatName(target)} 的生命值设为：${parsed.hp}。`
      );
    },
    true
  );
}

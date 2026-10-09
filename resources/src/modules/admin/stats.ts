import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { showStatsDialog } from "../commands/stats";
import { registerCommand } from "../commands/registry";
import { hasAdminAccess } from "./session";

const MIN_LEVEL = 1;

export function bindAdminStats(): void {
  registerCommand(
    "stats",
    "玩家统计",
    (player, args) => {
      if (!hasAdminAccess(player, MIN_LEVEL)) {
        return;
      }

      const raw = args.trim();
      if (!raw || !/^\d+$/.test(raw)) {
        player.sendClientMessage(Color.error, "用法: /stats [id]");
        return;
      }

      const slot = Number(raw);
      if (!Number.isInteger(slot) || slot < 0) {
        player.sendClientMessage(Color.error, "用法: /stats [id]");
        return;
      }

      const target = findTarget(slot);
      if (!target) {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      const targetAccount = getAccount(target);
      if (!targetAccount) {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      if (targetAccount.adminLevel >= 1) {
        player.sendClientMessage(
          Color.error,
          "不能查看管理员的统计数据。"
        );
        return;
      }

      showStatsDialog(player, target);
    },
    true
  );
}

function findTarget(slot: number): Player | null {
  try {
    const target = omp.players.at(slot);
    if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
      return null;
    }

    if (target.isNPC()) {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}

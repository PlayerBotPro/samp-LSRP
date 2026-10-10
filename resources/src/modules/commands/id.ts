import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId, playerName } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { registerCommand } from "./registry";

const MAX_RESULTS = 10;

registerCommand(
  "id",
  "按 ID 或昵称片段搜索在线玩家",
  (player, args) => {
    if (!isAuthenticated(player)) {
      player.sendClientMessage(Color.error, "请先登录账号.");
      return;
    }

    const query = args.trim();
    if (!query) {
      player.sendClientMessage(
        Color.error,
        "用法: /id [ID 或昵称片段]"
      );
      return;
    }

    const searchId = /^\d+$/.test(query) ? Number(query) : null;
    const needle = query.toLowerCase();

    player.sendClientMessage(
      Color.white,
      "根据你的搜索找到的玩家:"
    );

    let count = 0;
    omp.players.forEach((other) => {
      if (count >= MAX_RESULTS) {
        return;
      }

      if (!isPlayerActive(other) || !isAuthenticated(other)) {
        return;
      }

      try {
        if (other.isNPC()) {
          return;
        }
      } catch {
        return;
      }

      const slot = playerId(other);
      if (slot === null) {
        return;
      }

      const name = playerName(other);
      const idMatch =
        searchId !== null && Number.isInteger(searchId) && slot === searchId;
      const nameMatch = name.toLowerCase().includes(needle);

      if (!idMatch && !nameMatch) {
        return;
      }

      const account = getAccount(other);
      const level = account
        ? Math.max(0, Math.floor(account.level))
        : readScore(other);
      const ping = readPing(other);

      player.sendClientMessage(
        Color.white,
        `昵称: ${name} | ID: ${slot} | 等级: ${level} | 延迟: ${ping}`
      );
      count += 1;
    });

    if (count === 0) {
      player.sendClientMessage(
        Color.error,
        "没有找到符合这些信息的玩家."
      );
    }
  }
);

function readPing(player: Player): number {
  try {
    const ping = Number(player.getPing());
    return Number.isFinite(ping) ? Math.max(0, Math.floor(ping)) : 0;
  } catch {
    return 0;
  }
}

function readScore(player: Player): number {
  try {
    const score = Number(player.getScore());
    return Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  } catch {
    return 0;
  }
}

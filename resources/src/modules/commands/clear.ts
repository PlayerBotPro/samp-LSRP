import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { setPlayerWantedLevel } from "../auth/wanted";
import { isLawOfficer, lawOfficerLabel, notifyLawStaff } from "../org/law";
import { registerCommand } from "./registry";

/**
 * 解除目标通缉(/clear 逻辑).
 * @returns 错误文本;成功时返回 `null`.
 */
export function clearWantedByOfficer(officer: Player, target: Player): string | null {
  if (!isAuthenticated(officer) || !isLawOfficer(officer)) {
    return "仅警察和 FBI 成员可使用此命令.";
  }

  if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
    return "未找到玩家.";
  }

  try {
    if (target.isNPC()) {
      return "未找到玩家.";
    }
  } catch {
    return "未找到玩家.";
  }

  if (playerId(target) === playerId(officer)) {
    return "不能解除自己的通缉.";
  }

  const targetAccount = getAccount(target);
  if (!targetAccount) {
    return "未找到玩家.";
  }

  if (targetAccount.wantedLevel <= 0) {
    return "该玩家未被通缉.";
  }

  setPlayerWantedLevel(target, 0);

  notifyLawStaff(
    `${lawOfficerLabel(officer)} ${playerChatName(officer)} 解除了玩家的通缉 ${playerChatName(target)}.`
  );

  try {
    target.sendClientMessage(Color.info, "你的通缉已被解除.");
  } catch {
    // 已离线.
  }

  return null;
}

registerCommand("clear", "解除玩家通缉(警察 / FBI)", (player, args) => {
  if (!isAuthenticated(player) || !isLawOfficer(player)) {
    player.sendClientMessage(
      Color.error,
      "此命令仅供警察和 FBI 员工使用."
    );
    return;
  }

  const raw = args.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    player.sendClientMessage(Color.error, "用法: /clear [id]");
    return;
  }

  const slot = Number(raw);
  if (!Number.isInteger(slot) || slot < 0) {
    player.sendClientMessage(Color.error, "用法: /clear [id]");
    return;
  }

  const target = omp.players.at(slot);
  if (!target) {
    player.sendClientMessage(Color.error, "未找到玩家.");
    return;
  }

  const error = clearWantedByOfficer(player, target);
  if (error) {
    player.sendClientMessage(Color.error, error);
  }
});

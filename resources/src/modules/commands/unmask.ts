import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CHAT_RADIUS, WHISPER_RADIUS, arePlayersNearby, sendNearby } from "../../shared/nearby";
import { isPlayerActive, playerId, playerName } from "../../shared/player";
import { byGender } from "../auth/gender";
import { getAccount, isAuthenticated } from "../auth/session";
import { clearMask, isMasked } from "../mask";
import { applyOrgVisuals } from "../org/appearance";
import { isLawOfficer } from "../org/law";
import { isJailed } from "../prison/sentence";
import { registerCommand } from "./registry";

const DENY = "Команда доступна сотрудникам полиции и FBI.";
const PLAYER_STATE_WASTED = 7;

registerCommand("unmask", "Сорвать маску с игрока (полиция / FBI)", (player, args) => {
  if (!isAuthenticated(player) || !isLawOfficer(player)) {
    player.sendClientMessage(Color.error, DENY);
    return;
  }

  if (isJailed(player)) {
    player.sendClientMessage(Color.error, "在监狱里不能摘面具。");
    return;
  }

  const raw = args.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    player.sendClientMessage(Color.error, "用法: /unmask [id]");
    return;
  }

  const slot = Number(raw);
  if (!Number.isInteger(slot) || slot < 0) {
    player.sendClientMessage(Color.error, "用法: /unmask [id]");
    return;
  }

  const officerId = playerId(player);
  if (officerId === null) {
    return;
  }

  if (slot === officerId) {
    player.sendClientMessage(Color.error, "不能摘掉自己的面具。");
    return;
  }

  const target = findPlayer(slot);
  if (!target) {
    player.sendClientMessage(Color.error, "未找到玩家。");
    return;
  }

  try {
    if (target.getState() === PLAYER_STATE_WASTED) {
      player.sendClientMessage(Color.error, "玩家不在线。");
      return;
    }
  } catch {
    player.sendClientMessage(Color.error, "未找到玩家。");
    return;
  }

  if (!arePlayersNearby(player, target, WHISPER_RADIUS)) {
    player.sendClientMessage(Color.error, "玩家距离太远。");
    return;
  }

  if (!isMasked(target)) {
    player.sendClientMessage(Color.error, "该玩家没有戴面具。");
    return;
  }

  if (!clearMask(target)) {
    player.sendClientMessage(Color.error, "无法摘下面具。");
    return;
  }

  applyOrgVisuals(target);

  const officerName = playerName(player);
  const targetName = playerName(target);
  const verb = byGender(
    getAccount(player)?.gender ?? null,
    "сорвал",
    "сорвала"
  );
  sendNearby(
    player,
    CHAT_RADIUS,
    Color.action,
    `${officerName} резко ${verb} маску с лица ${targetName}.`
  );

  try {
    target.sendClientMessage(Color.error, "你的面具被摘掉了。");
  } catch {
    // Уже вышел.
  }

  player.sendClientMessage(Color.info, `你摘掉了 ${targetName} 的面具。`);
});

function findPlayer(slot: number): Player | null {
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

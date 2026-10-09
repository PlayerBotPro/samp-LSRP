import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CHAT_MAX_LENGTH, sanitizeChatText } from "../../shared/nearby";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { getAccount, isAuthenticated, normalizeWantedLevel } from "../auth/session";
import { setPlayerWantedLevel } from "../auth/wanted";
import { getMembership, isLawOfficer, notifyLawStaff } from "../org";
import { isJailed } from "../prison/sentence";
import { registerCommand } from "./registry";

const USAGE = "用法： /su [id] [1-6] [原因]";
const DENY = "仅警察和 FBI 成员可使用此命令。";
const MAX_WANTED = 6;

registerCommand(
  "su",
  "通缉玩家（警察 / FBI）",
  (player, args) => {
    if (!isAuthenticated(player) || !isLawOfficer(player)) {
      player.sendClientMessage(Color.error, DENY);
      return;
    }

    const officerAccount = getAccount(player);
    const officerMembership = officerAccount
      ? getMembership(officerAccount)
      : null;
    if (!officerAccount || !officerMembership) {
      player.sendClientMessage(Color.error, DENY);
      return;
    }

    const parsed = parseSuArgs(args);
    if (!parsed) {
      player.sendClientMessage(Color.error, USAGE);
      return;
    }

    const target = resolveTarget(parsed.slot);
    if (!target) {
      player.sendClientMessage(Color.error, "未找到玩家。");
      return;
    }

    if (playerId(target) === playerId(player)) {
      player.sendClientMessage(Color.error, "不能通缉自己。");
      return;
    }

    if (isLawOfficer(target)) {
      player.sendClientMessage(
        Color.error,
        "不能通缉警察或 FBI 员工。"
      );
      return;
    }

    if (isJailed(target)) {
      player.sendClientMessage(
        Color.error,
        "不能通缉监狱里的玩家。"
      );
      return;
    }

    const targetAccount = getAccount(target);
    if (!targetAccount) {
      player.sendClientMessage(Color.error, "未找到玩家。");
      return;
    }

    if (targetAccount.wantedLevel >= MAX_WANTED) {
      player.sendClientMessage(
        Color.error,
        "该玩家的通缉等级已达上限。"
      );
      return;
    }

    const prev = targetAccount.wantedLevel;
    const next = normalizeWantedLevel(prev + parsed.level);
    const added = next - prev;
    setPlayerWantedLevel(target, next);

    const rankTitle = officerMembership.rank.title;
    notifyLawStaff(
      `调度：${rankTitle} ${playerChatName(player)} 通缉了 ${playerChatName(target)}（+${added}，合计 ${next}）。原因：${parsed.reason}`
    );

    try {
      target.sendClientMessage(
        Color.error,
        `你已被通缉 (+${added}, 共 ${next})。原因: ${parsed.reason}`
      );
    } catch {
      // 已离线。
    }

    player.sendClientMessage(
      Color.info,
      `已通缉玩家: ${playerChatName(target)} (+${added}, 共 ${next}).`
    );
  }
);

function parseSuArgs(
  args: string
): { slot: number; level: number; reason: string } | null {
  const raw = args.trim();
  const match = raw.match(/^(\d+)\s+([1-6])\s+(.+)$/);
  if (!match) {
    return null;
  }

  const slot = Number(match[1]);
  const level = Number(match[2]);
  const reason = sanitizeChatText(match[3].trim()).slice(0, CHAT_MAX_LENGTH);
  if (!Number.isInteger(slot) || slot < 0 || !reason) {
    return null;
  }

  return { slot, level, reason };
}

function resolveTarget(slot: number): Player | null {
  const target = omp.players.at(slot);
  if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
    return null;
  }

  try {
    if (target.isNPC()) {
      return null;
    }
  } catch {
    return null;
  }

  return target;
}

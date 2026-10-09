import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import {
  CHAT_MAX_LENGTH,
  WHISPER_RADIUS,
  arePlayersNearby,
  clipClientMessage,
  sanitizeChatText,
} from "../../shared/nearby";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { byGender } from "../auth/gender";
import { saveUserOrg } from "../auth/repository";
import { getAccount, isAuthenticated, patchAccount } from "../auth/session";
import {
  MIN_ORG_RANK,
  ORG_FBI_ID,
  ORG_NONE,
  applyOrgVisuals,
  getMembership,
} from "../org";
import { syncOrgVehicleAccess } from "../vehicles/access";
import { refreshCaptureView } from "../zones/capture";
import { registerCommand } from "./registry";

/** FBI 督察及以上等级。 */
const DEMOTE_MIN_RANK = 8;
/** 可开除等级 1 至 8 的成员（不能开除 9 级及以上）。 */
const DEMOTE_MAX_TARGET_RANK = 8;

const busy = new Set<number>();

registerCommand(
  "demote",
  "开除政府组织成员（FBI 等级 8+）",
  (player, args) => {
    const actorAccount = getAccount(player);
    const actorMembership = actorAccount ? getMembership(actorAccount) : null;
    if (
      !actorAccount ||
      !actorMembership ||
      actorMembership.org.id !== ORG_FBI_ID ||
      actorMembership.rank.id < DEMOTE_MIN_RANK
    ) {
      player.sendClientMessage(
        Color.error,
        "此命令仅供 8 级及以上的 FBI 员工使用。"
      );
      return;
    }

    const raw = args.trim();
    const space = raw.indexOf(" ");
    const idPart = (space === -1 ? raw : raw.slice(0, space)).trim();
    const reason = sanitizeChatText(
      space === -1 ? "" : raw.slice(space + 1).trim()
    ).slice(0, CHAT_MAX_LENGTH);

    if (!idPart || !/^\d+$/.test(idPart) || !reason) {
      player.sendClientMessage(
        Color.error,
        "用法: /demote [id] [原因]"
      );
      return;
    }

    const slot = Number(idPart);
    if (!Number.isInteger(slot) || slot < 0) {
      player.sendClientMessage(
        Color.error,
        "用法: /demote [id] [原因]"
      );
      return;
    }

    const actorId = playerId(player);
    if (actorId === null) {
      return;
    }

    if (slot === actorId) {
      player.sendClientMessage(Color.error, "不能解雇自己。");
      return;
    }

    const target = findTarget(slot);
    if (!target) {
      player.sendClientMessage(Color.error, "未找到玩家。");
      return;
    }

    const targetId = playerId(target);
    if (targetId === null) {
      player.sendClientMessage(Color.error, "未找到玩家。");
      return;
    }

    if (!arePlayersNearby(player, target, WHISPER_RADIUS)) {
      player.sendClientMessage(Color.error, "玩家距离太远。");
      return;
    }

    const targetAccount = getAccount(target);
    const targetMembership = targetAccount
      ? getMembership(targetAccount)
      : null;
    if (!targetAccount || !targetMembership) {
      player.sendClientMessage(
        Color.error,
        "该玩家不属于政府组织。"
      );
      return;
    }

    if (!targetMembership.org.gov) {
      player.sendClientMessage(
        Color.error,
        "只能解雇政府组织的员工。"
      );
      return;
    }

    if (targetMembership.org.id === ORG_FBI_ID) {
      player.sendClientMessage(
        Color.error,
        "不能解雇 FBI 员工。"
      );
      return;
    }

    const targetRank = targetMembership.rank.id;
    if (targetRank < MIN_ORG_RANK || targetRank > DEMOTE_MAX_TARGET_RANK) {
      player.sendClientMessage(
        Color.error,
        "只能解雇 1–8 级员工。"
      );
      return;
    }

    if (busy.has(actorId) || busy.has(targetId)) {
      player.sendClientMessage(
        Color.error,
        "请等待上一次解雇操作完成。"
      );
      return;
    }

    busy.add(actorId);
    busy.add(targetId);
    void (async () => {
      try {
        if (!isPlayerActive(player) || !isAuthenticated(player)) {
          return;
        }

        const liveActor = getAccount(player);
        const liveActorMembership = liveActor
          ? getMembership(liveActor)
          : null;
        if (
          !liveActor ||
          !liveActorMembership ||
          liveActorMembership.org.id !== ORG_FBI_ID ||
          liveActorMembership.rank.id < DEMOTE_MIN_RANK
        ) {
          tell(player, Color.error, "仅 FBI 8 级及以上成员可使用此命令。");
          return;
        }

        if (
          !isPlayerActive(target) ||
          !isAuthenticated(target) ||
          !arePlayersNearby(player, target, WHISPER_RADIUS)
        ) {
          tell(player, Color.error, "玩家距离太远。");
          return;
        }

        const liveTarget = getAccount(target);
        const liveTargetMembership = liveTarget
          ? getMembership(liveTarget)
          : null;
        if (
          !liveTarget ||
          !liveTargetMembership ||
          !liveTargetMembership.org.gov ||
          liveTargetMembership.org.id === ORG_FBI_ID ||
          liveTargetMembership.rank.id < MIN_ORG_RANK ||
          liveTargetMembership.rank.id > DEMOTE_MAX_TARGET_RANK
        ) {
          tell(player, Color.error, "无法继续开除操作。");
          return;
        }

        const orgName = liveTargetMembership.org.name;
        const actorTag = playerChatName(player);
        const targetTag = playerChatName(target);
        const verb = byGender(liveActor.gender, "开除了", "开除了");
        const rankTitle = liveActorMembership.rank.title;

        const ok = await clearOrg(target);
        if (!ok) {
          tell(player, Color.error, "无法保存到数据库。");
          return;
        }

        notifyGovStaff(
          clipClientMessage(
            `${rankTitle} ${actorTag} 将 ${targetTag} 从 ${orgName} 开除。原因：${reason}`
          )
        );

        tell(
          player,
          Color.info,
          clipClientMessage(
            `你已将 ${targetTag} 从 ${orgName} 开除。原因：${reason}`
          )
        );
        tell(
          target,
          Color.error,
          clipClientMessage(
            `你已被组织 ${orgName} 开除。原因：${reason}`
          )
        );
      } finally {
        busy.delete(actorId);
        busy.delete(targetId);
      }
    })();
  }
);

/**
 * 将 ORG_NONE 写入数据库。仅当玩家仍在线时更新会话和画面状态。
 * 数据库操作成功即返回 true（即使保存后目标断线也是如此）。
 */
async function clearOrg(player: Player): Promise<boolean> {
  const account = getAccount(player);
  if (!account) {
    return false;
  }

  const accountId = account.id;

  try {
    await saveUserOrg(accountId, ORG_NONE, 0);
  } catch {
    return false;
  }

  if (!isPlayerActive(player) || getAccount(player)?.id !== accountId) {
    return true;
  }

  patchAccount(player, { orgId: ORG_NONE, orgRank: 0 });
  applyOrgVisuals(player);
  syncOrgVehicleAccess(player);
  refreshCaptureView(player);
  return true;
}

function notifyGovStaff(line: string): void {
  omp.players.forEach((other) => {
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

    const account = getAccount(other);
    const membership = account ? getMembership(account) : null;
    if (!membership?.org.gov) {
      return;
    }

    tell(other, Color.dept, line);
  });
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

function tell(player: Player, color: number, text: string): void {
  try {
    if (!isPlayerActive(player)) {
      return;
    }
    player.sendClientMessage(color, text);
  } catch {
    // 槽位为空。
  }
}

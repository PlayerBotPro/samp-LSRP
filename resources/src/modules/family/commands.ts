import { Dialog, omp, type Player } from "@omp-node/core";
import { Color, chatColorTag } from "../../shared/colors";
import {
  CHAT_MAX_LENGTH,
  CHAT_RADIUS,
  arePlayersNearby,
  clipClientMessage,
  sanitizeChatText,
} from "../../shared/nearby";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import {
  claimYnOffer,
  getYnOfferKind,
  releaseYnOffer,
} from "../../shared/yn-offer";
import { byGender } from "../auth/gender";
import { saveUserFamily } from "../auth/repository";
import { getAccount, patchAccount } from "../auth/session";
import { registerCommand } from "../commands/registry";
import { memberStatusSuffix } from "../commands/status-tags";
import { getFamily } from "./catalog";
import { getFamilyMembership } from "./membership";
import { getFamilyRank } from "./ranks";
import { syncFamilyTag } from "./tags";
import {
  FAMILY_MANAGE_MAX_RANK,
  FAMILY_NONE,
  FAMILY_STAFF_MIN_RANK,
  MIN_FAMILY_RANK,
} from "./types";

/** @deprecated 此对话框已停用，邀请通过 Y/N 处理。 */
export const FAMILY_INVITE_DIALOG_ID = 112;
export const FAMILY_MEMBERS_DIALOG_ID = 123;

const DIALOG_STYLE_MSGBOX = 0;
const KEY_YES = 65536;
const KEY_NO = 131072;
const INVITE_TTL_MS = 60_000;
const INVITE_RADIUS = 10;
const BUBBLE_MS = 3000;

type PendingInvite = {
  inviterSlot: number;
  inviterAccountId: number;
  targetAccountId: number;
  familyId: number;
  familyRank: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

const pendingInvite = new Map<number, PendingInvite>();

function tell(player: Player, color: number, text: string): void {
  try {
    if (isPlayerActive(player)) {
      player.sendClientMessage(color, text);
    }
  } catch {
    // 槽位为空。
  }
}

function clearInvite(player: Player): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const pending = pendingInvite.get(id);
  if (pending) {
    clearTimeout(pending.timer);
    pendingInvite.delete(id);
    releaseYnOffer(id, "finvite");
  }
}

function expireInvite(slot: number, accountId: number): void {
  const pending = pendingInvite.get(slot);
  if (!pending || pending.targetAccountId !== accountId) {
    return;
  }

  clearTimeout(pending.timer);
  pendingInvite.delete(slot);
  releaseYnOffer(slot, "finvite");

  const target = findTarget(slot);
  if (target && getAccount(target)?.id === accountId) {
    tell(target, Color.error, "家族邀请已过期。");
  }

  const inviter = findTarget(pending.inviterSlot);
  if (inviter && getAccount(inviter)?.id === pending.inviterAccountId) {
    tell(inviter, Color.error, "家族邀请已过期。");
  }
}

function findTarget(slot: number): Player | null {
  const target = omp.players.at(slot);
  if (!target || !isPlayerActive(target)) {
    return null;
  }

  try {
    if (target.isNPC()) {
      return null;
    }
  } catch {
    return null;
  }

  return getAccount(target) ? target : null;
}

function parseSlot(raw: string): number | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }

  const slot = Number(text);
  if (!Number.isInteger(slot) || slot < 0) {
    return null;
  }
  return slot;
}

function samePlayer(a: Player, b: Player): boolean {
  const left = playerId(a);
  const right = playerId(b);
  return left !== null && left === right;
}

function staffOf(player: Player) {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || membership.rank.id < FAMILY_STAFF_MIN_RANK) {
    return null;
  }
  return { account, membership };
}

function requireStaff(player: Player) {
  const staff = staffOf(player);
  if (!staff) {
    tell(player, Color.error, "家族等级达到 9 级后可使用此命令。");
    return null;
  }
  return staff;
}

function requireOtherTarget(actor: Player, args: string, usage: string): Player | null {
  const slot = parseSlot(args.trim().split(/\s+/).filter(Boolean)[0] ?? "");
  if (slot === null) {
    tell(actor, Color.error, usage);
    return null;
  }

  const target = findTarget(slot);
  if (!target) {
    tell(actor, Color.error, "未找到该玩家。");
    return null;
  }

  if (samePlayer(actor, target)) {
    tell(actor, Color.error, "不能对自己使用。");
    return null;
  }

  return target;
}

function canManage(targetRank: number): boolean {
  return targetRank >= MIN_FAMILY_RANK && targetRank <= FAMILY_MANAGE_MAX_RANK;
}

async function setFamily(
  player: Player,
  familyId: number,
  familyRank: number
): Promise<boolean> {
  const account = getAccount(player);
  if (!account) {
    return false;
  }

  try {
    await saveUserFamily(account.id, familyId, familyRank);
  } catch {
    return false;
  }

  if (!isPlayerActive(player) || getAccount(player)?.id !== account.id) {
    return false;
  }

  patchAccount(player, { familyId, familyRank });
  syncFamilyTag(player);
  return true;
}

function parseRankDelta(args: string): { slot: number; delta: 1 | -1 } | null {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  const slot = parseSlot(parts[0]);
  if (slot === null) {
    return null;
  }

  if (parts[1] === "+") {
    return { slot, delta: 1 };
  }
  if (parts[1] === "-") {
    return { slot, delta: -1 };
  }
  return null;
}

/** 按 /fam 的格式通知所有在线家族成员。 */
function broadcastFamilyNotice(
  familyId: number,
  familyName: string,
  actor: Player,
  message: string
): void {
  const membership = getAccount(actor) ? getFamilyMembership(getAccount(actor)!) : null;
  const rankId = membership?.rank.id ?? 0;
  const rankTitle = membership?.rank.title ?? "—";

  const line = clipClientMessage(
    `[家族] [${familyName}] [${rankId}] ${rankTitle} ${playerChatName(actor)}${chatColorTag(Color.white)}: ${message}`
  );

  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      if (other.isNPC()) {
        return;
      }
    } catch {
      return;
    }

    const otherAccount = getAccount(other);
    if (!otherAccount || otherAccount.familyId !== familyId) {
      return;
    }

    try {
      other.sendClientMessage(Color.familyChat, line);
    } catch {
      // 槽位为空。
    }
  });
}

registerCommand("fmembers", "在线家族成员", (player) => {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    tell(player, Color.error, "你不属于任何家族。");
    return;
  }

  type MemberRow = {
    rankId: number;
    rankTitle: string;
    name: string;
    phone: string | null;
    status: string;
  };

  const rows: MemberRow[] = [];

  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      if (other.isNPC()) {
        return;
      }
    } catch {
      return;
    }

    const otherAccount = getAccount(other);
    const otherMembership = otherAccount ? getFamilyMembership(otherAccount) : null;
    if (
      !otherAccount ||
      !otherMembership ||
      otherMembership.family.id !== membership.family.id
    ) {
      return;
    }

    rows.push({
      rankId: otherMembership.rank.id,
      rankTitle: otherMembership.rank.title,
      name: playerChatName(other),
      phone: otherAccount.phone,
      status: memberStatusSuffix(other),
    });
  });

  rows.sort((a, b) => b.rankId - a.rankId || a.name.localeCompare(b.name));

  if (rows.length === 0) {
    tell(player, Color.error, "没有在线的家族成员。");
    return;
  }

  const lines = rows.map((row) => {
    const phone = row.phone ? ` | 电话： ${row.phone}` : "";
    return `[${row.rankId}] ${row.rankTitle} ${row.name}${phone}${row.status}`;
  });

  const body =
    `家族：${membership.family.name}\n` +
    `在线人数：${rows.length}\n\n` +
    lines.join("\n");

  try {
    Dialog.show(
      player,
      FAMILY_MEMBERS_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "在线家族成员",
      body,
      "OK",
      ""
    );
  } catch {
    for (const line of lines) {
      tell(player, Color.info, line);
    }
  }
});

registerCommand("fam", "家族频道", (player, args) => {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    tell(player, Color.error, "你不属于任何家族。");
    return;
  }

  const text = sanitizeChatText(args.trim()).slice(0, CHAT_MAX_LENGTH);
  if (!text) {
    tell(player, Color.error, "用法：/fam [内容]");
    return;
  }

  const line = clipClientMessage(
    `[家族] [${membership.family.name}] [${membership.rank.id}] ${membership.rank.title} ${playerChatName(player)}${chatColorTag(Color.white)}: ${text}`
  );
  const familyId = membership.family.id;

  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      if (other.isNPC()) {
        return;
      }
    } catch {
      return;
    }

    const otherAccount = getAccount(other);
    if (!otherAccount || otherAccount.familyId !== familyId) {
      return;
    }

    try {
      other.sendClientMessage(Color.familyChat, line);
    } catch {
      // 槽位为空。
    }
  });

  try {
    player.setChatBubble("家族频道消息。", Color.familyChat, CHAT_RADIUS, BUBBLE_MS);
  } catch {
    // 气泡提示不是必需的。
  }
});

registerCommand("finvite", "邀请加入家族", (player, args) => {
  const staff = requireStaff(player);
  if (!staff) {
    return;
  }

  const target = requireOtherTarget(player, args, "用法：/finvite [玩家 ID]");
  if (!target) {
    return;
  }

  const targetAccount = getAccount(target);
  if (!targetAccount) {
    tell(player, Color.error, "未找到该玩家。");
    return;
  }

  if (!targetAccount.passport) {
    tell(player, Color.error, "该玩家没有身份证。");
    return;
  }

  if (getFamilyMembership(targetAccount)) {
    tell(player, Color.error, "该玩家已经加入家族。");
    return;
  }

  if (!arePlayersNearby(player, target, INVITE_RADIUS)) {
    tell(player, Color.error, "该玩家距离太远。");
    return;
  }

  const targetId = playerId(target);
  const actorId = playerId(player);
  if (targetId === null || actorId === null) {
    return;
  }

  if (!claimYnOffer(targetId, "finvite")) {
    tell(player, Color.error, "该玩家已有待处理的邀请。");
    return;
  }

  const rank = getFamilyRank(MIN_FAMILY_RANK);
  if (!rank) {
    releaseYnOffer(targetId, "finvite");
    tell(player, Color.error, "无法发送邀请。");
    return;
  }

  pendingInvite.set(targetId, {
    inviterSlot: actorId,
    inviterAccountId: staff.account.id,
    targetAccountId: targetAccount.id,
    familyId: staff.membership.family.id,
    familyRank: rank.id,
    expiresAt: Date.now() + INVITE_TTL_MS,
    timer: setTimeout(() => {
      expireInvite(targetId, targetAccount.id);
    }, INVITE_TTL_MS),
  });

  tell(player, Color.info, `已向 ${playerChatName(target)} 发出邀请。`);
  tell(
    target,
    Color.white,
    `${playerChatName(player)} 邀请你加入家族“${staff.membership.family.name}”（${rank.title}）。`
  );
  tell(
    target,
    Color.white,
    "按 {00CC00}Y {FFFFFF}接受，或按 {FF6600}N {FFFFFF}拒绝"
  );
});

registerCommand("funinvite", "将玩家移出家族", (player, args) => {
  const staff = requireStaff(player);
  if (!staff) {
    return;
  }

  const raw = args.trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const idPart = parts[0] ?? "";
  const reason = sanitizeChatText(parts.slice(1).join(" ")).slice(0, CHAT_MAX_LENGTH);

  if (!idPart) {
    tell(player, Color.error, "用法：/funinvite [玩家 ID] [原因]");
    return;
  }

  const target = requireOtherTarget(player, idPart, "用法：/funinvite [玩家 ID] [原因]");
  if (!target) {
    return;
  }

  const targetAccount = getAccount(target);
  const targetFamily = targetAccount ? getFamilyMembership(targetAccount) : null;
  if (
    !targetAccount ||
    !targetFamily ||
    targetFamily.family.id !== staff.membership.family.id
  ) {
    tell(player, Color.error, "该玩家不属于你的家族。");
    return;
  }

  if (targetFamily.family.ownerId === targetAccount.id) {
    tell(player, Color.error, "不能将家族所有者移出家族。");
    return;
  }

  if (!canManage(targetFamily.rank.id)) {
    tell(player, Color.error, "不能将该玩家移出家族。");
    return;
  }

  void (async () => {
    const actor = staffOf(player);
    if (!actor || actor.membership.family.id !== staff.membership.family.id) {
      tell(player, Color.error, "家族等级达到 9 级后可使用此命令。");
      return;
    }

    const liveAccount = getAccount(target);
    const liveFamily = liveAccount ? getFamilyMembership(liveAccount) : null;
    if (
      !liveAccount ||
      !liveFamily ||
      liveFamily.family.id !== actor.membership.family.id
    ) {
      tell(player, Color.error, "该玩家不属于你的家族。");
      return;
    }

    if (liveFamily.family.ownerId === liveAccount.id || !canManage(liveFamily.rank.id)) {
      tell(player, Color.error, "不能将该玩家移出家族。");
      return;
    }

    const tag = playerChatName(target);
    const familyId = actor.membership.family.id;
    const familyName = actor.membership.family.name;

    const ok = await setFamily(target, FAMILY_NONE, 0);
    if (!ok) {
      tell(player, Color.error, "无法保存到数据库。");
      return;
    }

    const reasonText = reason ? `原因：${reason}` : "";
    tell(target, Color.info, clipClientMessage(`你已被移出家族“${familyName}”。${reasonText}`));

    broadcastFamilyNotice(
      familyId,
      familyName,
      player,
      `${tag} 已被移出家族。${reasonText}`
    );
  })();
});

registerCommand("frang", "更改家族等级", (player, args) => {
  const staff = requireStaff(player);
  if (!staff) {
    return;
  }

  const parsed = parseRankDelta(args);
  if (!parsed) {
    tell(player, Color.error, "用法：/frang [玩家 ID] [+/-]");
    return;
  }

  const target = findTarget(parsed.slot);
  if (!target) {
    tell(player, Color.error, "未找到该玩家。");
    return;
  }

  if (samePlayer(player, target)) {
    tell(player, Color.error, "不能对自己使用。");
    return;
  }

  const targetAccount = getAccount(target);
  const targetFamily = targetAccount ? getFamilyMembership(targetAccount) : null;
  if (
    !targetAccount ||
    !targetFamily ||
    targetFamily.family.id !== staff.membership.family.id
  ) {
    tell(player, Color.error, "该玩家不属于你的家族。");
    return;
  }

  if (targetFamily.family.ownerId === targetAccount.id) {
    tell(player, Color.error, "不能更改家族所有者的等级。");
    return;
  }

  if (!canManage(targetFamily.rank.id)) {
    tell(player, Color.error, "不能更改该玩家的等级。");
    return;
  }

  const next = targetFamily.rank.id + parsed.delta;
  if (next < MIN_FAMILY_RANK || next > FAMILY_MANAGE_MAX_RANK) {
    tell(player, Color.error, "玩家等级范围为 1–9。");
    return;
  }

  if (!getFamilyRank(next)) {
    tell(player, Color.error, "无法更改等级。");
    return;
  }

  void (async () => {
    const actor = staffOf(player);
    if (!actor || actor.membership.family.id !== staff.membership.family.id) {
      tell(player, Color.error, "家族等级达到 9 级后可使用此命令。");
      return;
    }

    const liveAccount = getAccount(target);
    const liveFamily = liveAccount ? getFamilyMembership(liveAccount) : null;
    if (
      !liveAccount ||
      !liveFamily ||
      liveFamily.family.id !== actor.membership.family.id
    ) {
      tell(player, Color.error, "该玩家不属于你的家族。");
      return;
    }

    if (
      liveFamily.family.ownerId === liveAccount.id ||
      !canManage(liveFamily.rank.id)
    ) {
      tell(player, Color.error, "不能更改该玩家的等级。");
      return;
    }

    const liveNext = liveFamily.rank.id + parsed.delta;
    if (liveNext < MIN_FAMILY_RANK || liveNext > FAMILY_MANAGE_MAX_RANK) {
      tell(player, Color.error, "玩家等级范围为 1–9。");
      return;
    }

    const liveNextRank = getFamilyRank(liveNext);
    if (!liveNextRank) {
      tell(player, Color.error, "无法更改等级。");
      return;
    }

    const ok = await setFamily(target, liveFamily.family.id, liveNextRank.id);
    if (!ok) {
      tell(player, Color.error, "无法保存到数据库。");
      return;
    }

    const tag = playerChatName(target);
    const verbUp = parsed.delta > 0;
    const action = verbUp
      ? `将 ${tag} 提升至 ${liveNextRank.title}（${liveNextRank.id}）`
      : `将 ${tag} 降至 ${liveNextRank.title}（${liveNextRank.id}）`;

    tell(
      target,
      Color.info,
      verbUp
        ? `你的家族等级已提升至：${liveNextRank.title}（${liveNextRank.id}）。`
        : `你的家族等级已降至：${liveNextRank.title}（${liveNextRank.id}）。`
    );

    broadcastFamilyNotice(
      actor.membership.family.id,
      actor.membership.family.name,
      player,
      action
    );
  })();
});

export function bindFamilyCommands(): void {
  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    const pressed = Number(newKeys) & ~Number(oldKeys);
    if ((pressed & KEY_YES) === 0 && (pressed & KEY_NO) === 0) {
      return;
    }

    const targetId = playerId(player);
    if (targetId === null || getYnOfferKind(targetId) !== "finvite") {
      return;
    }

    const pending = pendingInvite.get(targetId);
    if (!pending) {
      releaseYnOffer(targetId, "finvite");
      return;
    }

    if (Date.now() > pending.expiresAt) {
      expireInvite(targetId, pending.targetAccountId);
      return;
    }

    // 立即清除待处理状态（防止重复点击），并保留 Y/N 槽位直到处理完成。
    clearTimeout(pending.timer);
    pendingInvite.delete(targetId);

    if (!getAccount(player) || getAccount(player)?.id !== pending.targetAccountId) {
      releaseYnOffer(targetId, "finvite");
      return;
    }

    const inviter = findTarget(pending.inviterSlot);
    const inviterOk =
      !!inviter && getAccount(inviter)?.id === pending.inviterAccountId && isPlayerActive(inviter);
    const family = getFamily(pending.familyId);
    const rank = getFamilyRank(pending.familyRank);
    const targetTag = playerChatName(player);
    const accepted = (pressed & KEY_YES) !== 0;
    const verb = byGender(
      getAccount(player)?.gender ?? null,
      accepted ? "接受了" : "拒绝了",
      accepted ? "接受了" : "拒绝了"
    );

    if (!accepted) {
      releaseYnOffer(targetId, "finvite");
      tell(player, Color.info, "你拒绝了家族邀请。");
      if (inviterOk && inviter) {
        tell(inviter, Color.info, `${targetTag} ${verb} 家族邀请。`);
      }
      return;
    }

    const live = getAccount(player);
    if (!live || !family || !rank) {
      releaseYnOffer(targetId, "finvite");
      tell(player, Color.error, "家族邀请已失效。");
      return;
    }

    if (!live.passport) {
      releaseYnOffer(targetId, "finvite");
      tell(player, Color.error, "你没有身份证。");
      if (inviterOk && inviter) {
        tell(inviter, Color.error, `${targetTag} 无法加入：没有身份证。`);
      }
      return;
    }

    if (getFamilyMembership(live)) {
      releaseYnOffer(targetId, "finvite");
      tell(player, Color.error, "你已经加入家族。");
      if (inviterOk && inviter) {
        tell(inviter, Color.error, `${targetTag} 已经加入家族。`);
      }
      return;
    }

    if (!inviterOk || !inviter) {
      releaseYnOffer(targetId, "finvite");
      tell(player, Color.error, "家族邀请已失效。");
      return;
    }

    const inviterStaff = staffOf(inviter);
    if (
      !inviterStaff ||
      inviterStaff.membership.family.id !== pending.familyId
    ) {
      releaseYnOffer(targetId, "finvite");
      tell(player, Color.error, "家族邀请已失效。");
      return;
    }

    if (!arePlayersNearby(player, inviter, INVITE_RADIUS)) {
      releaseYnOffer(targetId, "finvite");
      tell(player, Color.error, "你距离邀请者太远。");
      tell(inviter, Color.error, `${targetTag} 无法接受邀请：距离太远。`);
      return;
    }

    void (async () => {
      try {
        if (!arePlayersNearby(player, inviter, INVITE_RADIUS)) {
          tell(player, Color.error, "你距离邀请者太远。");
          tell(inviter, Color.error, `${targetTag} 无法接受邀请：距离太远。`);
          return;
        }

        if (!getFamily(pending.familyId)) {
          tell(player, Color.error, "该家族已不存在。");
          return;
        }

        const liveInviterStaff = staffOf(inviter);
        if (
          !liveInviterStaff ||
          liveInviterStaff.membership.family.id !== pending.familyId
        ) {
          tell(player, Color.error, "家族邀请已失效。");
          return;
        }

        const liveAgain = getAccount(player);
        if (!liveAgain || liveAgain.id !== pending.targetAccountId) {
          return;
        }
        if (getFamilyMembership(liveAgain)) {
          tell(player, Color.error, "你已经加入家族。");
          return;
        }

        const ok = await setFamily(player, pending.familyId, pending.familyRank);
        if (!ok) {
          tell(player, Color.error, "无法保存到数据库。");
          if (inviterOk && inviter) {
            tell(inviter, Color.error, "无法接纳该玩家。");
          }
          return;
        }

        tell(
          player,
          Color.info,
          `你已加入家族 ${family.name}. 职位： ${rank.title}.`
        );

        if (isPlayerActive(inviter) && getAccount(inviter)?.id === pending.inviterAccountId) {
          broadcastFamilyNotice(
            pending.familyId,
            family.name,
            inviter,
            `邀请了 ${targetTag}加入家族`
          );
        }
      } finally {
        releaseYnOffer(targetId, "finvite");
      }
    })();
  });

  omp.on("playerConnect", (player) => {
    clearInvite(player);
  });

  omp.on("playerDisconnect", (player) => {
    const slot = playerId(player);
    clearInvite(player);
    if (slot === null) {
      return;
    }

    for (const [targetSlot, offer] of pendingInvite) {
      if (offer.inviterSlot === slot) {
        const target = findTarget(targetSlot);
        clearTimeout(offer.timer);
        pendingInvite.delete(targetSlot);
        releaseYnOffer(targetSlot, "finvite");
        if (target) {
          tell(target, Color.error, "家族邀请已取消。");
        }
      }
    }
  });
}

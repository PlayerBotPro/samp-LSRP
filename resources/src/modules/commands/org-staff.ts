import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import {
  CHAT_MAX_LENGTH,
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
import { saveUserOrg } from "../auth/repository";
import { byGender } from "../auth/gender";
import { getAccount, patchAccount } from "../auth/session";
import {
  MIN_ORG_RANK,
  ORG_NONE,
  applyOrgVisuals,
  getMembership,
  getOrgRank,
  getOrganization,
} from "../org";
import { syncOrgVehicleAccess } from "../vehicles/access";
import { refreshCaptureView } from "../zones/capture";
import { registerCommand } from "./registry";

/** @deprecated 此对话框已停用,现在通过 Y/N 邀请. */
export const ORG_INVITE_DIALOG_ID = 21;

const KEY_YES = 65536;
const KEY_NO = 131072;
const STAFF_MIN_RANK = 9;
const MANAGE_MAX_RANK = 9;
const INVITE_TTL_MS = 60_000;
const INVITE_RADIUS = 10;

type PendingInvite = {
  inviterSlot: number;
  inviterAccountId: number;
  targetAccountId: number;
  orgId: number;
  orgRank: number;
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
    // 槽位为空.
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
    releaseYnOffer(id, "invite");
  }
}

function expireInvite(slot: number, accountId: number): void {
  const pending = pendingInvite.get(slot);
  if (!pending || pending.targetAccountId !== accountId) {
    return;
  }

  clearTimeout(pending.timer);
  pendingInvite.delete(slot);
  releaseYnOffer(slot, "invite");

  const target = findTarget(slot);
  if (target && getAccount(target)?.id === accountId) {
    tell(target, Color.error, "邀请已过期.");
  }

  const inviter = findTarget(pending.inviterSlot);
  if (inviter && getAccount(inviter)?.id === pending.inviterAccountId) {
    tell(inviter, Color.error, "邀请已过期.");
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

function staffOf(player: Player) {
  const account = getAccount(player);
  const membership = account ? getMembership(account) : null;
  if (!account || !membership || membership.rank.id < STAFF_MIN_RANK) {
    return null;
  }
  return { account, membership };
}

function samePlayer(a: Player, b: Player): boolean {
  const left = playerId(a);
  const right = playerId(b);
  return left !== null && left === right;
}

function requireStaff(player: Player) {
  const staff = staffOf(player);
  if (!staff) {
    tell(player, Color.error, "组织等级达到 9 级后方可使用此命令.");
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
    tell(actor, Color.error, "未找到玩家.");
    return null;
  }

  if (samePlayer(actor, target)) {
    tell(actor, Color.error, "不能对自己使用.");
    return null;
  }

  return target;
}

function canManage(targetRank: number): boolean {
  return targetRank >= MIN_ORG_RANK && targetRank <= MANAGE_MAX_RANK;
}

async function setOrg(player: Player, orgId: number, orgRank: number): Promise<boolean> {
  const account = getAccount(player);
  if (!account) {
    return false;
  }

  try {
    await saveUserOrg(account.id, orgId, orgRank);
  } catch {
    return false;
  }

  if (!isPlayerActive(player) || getAccount(player)?.id !== account.id) {
    return false;
  }

  patchAccount(player, { orgId, orgRank });
  applyOrgVisuals(player);
  syncOrgVehicleAccess(player);
  refreshCaptureView(player);
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

registerCommand("invite", "邀请加入组织", (player, args) => {
  const staff = requireStaff(player);
  if (!staff) {
    return;
  }

  const target = requireOtherTarget(player, args, "用法: /invite [id]");
  if (!target) {
    return;
  }

  const targetAccount = getAccount(target);
  if (!targetAccount) {
    tell(player, Color.error, "未找到玩家.");
    return;
  }

  if (!targetAccount.passport) {
    tell(player, Color.error, "该玩家没有护照.");
    return;
  }

  if (targetAccount.orgId !== ORG_NONE || getMembership(targetAccount)) {
    tell(player, Color.error, "该玩家已加入组织.");
    return;
  }

  if (!arePlayersNearby(player, target, INVITE_RADIUS)) {
    tell(player, Color.error, "玩家距离太远.");
    return;
  }

  const targetId = playerId(target);
  const actorId = playerId(player);
  if (targetId === null || actorId === null) {
    return;
  }

  if (!claimYnOffer(targetId, "invite")) {
    tell(player, Color.error, "该玩家已有待处理的提议.");
    return;
  }

  const rank = getOrgRank(staff.membership.org, MIN_ORG_RANK);
  if (!rank) {
    releaseYnOffer(targetId, "invite");
    tell(player, Color.error, "无法发送邀请.");
    return;
  }

  pendingInvite.set(targetId, {
    inviterSlot: actorId,
    inviterAccountId: staff.account.id,
    targetAccountId: targetAccount.id,
    orgId: staff.membership.org.id,
    orgRank: rank.id,
    expiresAt: Date.now() + INVITE_TTL_MS,
    timer: setTimeout(() => {
      expireInvite(targetId, targetAccount.id);
    }, INVITE_TTL_MS),
  });

  tell(player, Color.info, `你已向 ${playerChatName(target)} 发送邀请.`);
  tell(
    target,
    Color.white,
    `${playerChatName(player)} 邀请你加入组织 ${staff.membership.org.name}(${rank.title}).`
  );
  tell(
    target,
    Color.white,
    "按 {00CC00}Y {FFFFFF}接受,或按 {FF6600}N {FFFFFF}拒绝"
  );
});

registerCommand("uninvite", "从组织开除", (player, args) => {
  const staff = requireStaff(player);
  if (!staff) {
    return;
  }

  const raw = args.trim();
  const space = raw.indexOf(" ");
  const idPart = (space === -1 ? raw : raw.slice(0, space)).trim();
  const reason = sanitizeChatText(space === -1 ? "" : raw.slice(space + 1).trim()).slice(
    0,
    CHAT_MAX_LENGTH
  );

  if (!idPart || !reason) {
    tell(player, Color.error, "用法:/uninvite [id] [原因]");
    return;
  }

  const target = requireOtherTarget(player, idPart, "用法:/uninvite [id] [原因]");
  if (!target) {
    return;
  }

  const targetAccount = getAccount(target);
  const targetOrg = targetAccount ? getMembership(targetAccount) : null;
  if (!targetAccount || !targetOrg || targetOrg.org.id !== staff.membership.org.id) {
    tell(player, Color.error, "该玩家不属于你的组织.");
    return;
  }

  if (!canManage(targetOrg.rank.id)) {
    tell(player, Color.error, "不能开除该玩家.");
    return;
  }

  void (async () => {
    const actor = staffOf(player);
    if (!actor || actor.membership.org.id !== staff.membership.org.id) {
      tell(player, Color.error, "组织等级达到 9 级后方可使用此命令.");
      return;
    }

    const liveAccount = getAccount(target);
    const liveOrg = liveAccount ? getMembership(liveAccount) : null;
    if (!liveAccount || !liveOrg || liveOrg.org.id !== actor.membership.org.id) {
      tell(player, Color.error, "该玩家不属于你的组织.");
      return;
    }

    if (!canManage(liveOrg.rank.id)) {
      tell(player, Color.error, "不能开除该玩家.");
      return;
    }

    const ok = await setOrg(target, ORG_NONE, 0);
    if (!ok) {
      tell(player, Color.error, "无法保存到数据库.");
      return;
    }

    const tag = playerChatName(target);
    const orgName = actor.membership.org.name;
    tell(
      player,
      Color.info,
      clipClientMessage(`你已将 ${tag} 从组织 ${orgName} 开除.原因:${reason}`)
    );
    tell(
      target,
      Color.info,
      clipClientMessage(`你已被组织 ${orgName} 开除.原因:${reason}`)
    );
  })();
});

registerCommand("rang", "更改组织等级", (player, args) => {
  const staff = requireStaff(player);
  if (!staff) {
    return;
  }

  const parsed = parseRankDelta(args);
  if (!parsed) {
    tell(player, Color.error, "用法: /rang [id] [+/-]");
    return;
  }

  const target = findTarget(parsed.slot);
  if (!target) {
    tell(player, Color.error, "未找到玩家.");
    return;
  }

  if (samePlayer(player, target)) {
    tell(player, Color.error, "不能对自己使用.");
    return;
  }

  const targetAccount = getAccount(target);
  const targetOrg = targetAccount ? getMembership(targetAccount) : null;
  if (!targetAccount || !targetOrg || targetOrg.org.id !== staff.membership.org.id) {
    tell(player, Color.error, "该玩家不属于你的组织.");
    return;
  }

  if (!canManage(targetOrg.rank.id)) {
    tell(player, Color.error, "不能更改该玩家的等级.");
    return;
  }

  const next = targetOrg.rank.id + parsed.delta;
  if (next < MIN_ORG_RANK || next > MANAGE_MAX_RANK) {
    tell(player, Color.error, "玩家等级必须在 1 到 9 之间.");
    return;
  }

  const nextRank = getOrgRank(targetOrg.org, next);
  if (!nextRank) {
    tell(player, Color.error, "无法更改等级.");
    return;
  }

  void (async () => {
    const actor = staffOf(player);
    if (!actor || actor.membership.org.id !== staff.membership.org.id) {
      tell(player, Color.error, "组织等级达到 9 级后方可使用此命令.");
      return;
    }

    const liveAccount = getAccount(target);
    const liveOrg = liveAccount ? getMembership(liveAccount) : null;
    if (!liveAccount || !liveOrg || liveOrg.org.id !== actor.membership.org.id) {
      tell(player, Color.error, "该玩家不属于你的组织.");
      return;
    }

    if (!canManage(liveOrg.rank.id)) {
      tell(player, Color.error, "不能更改该玩家的等级.");
      return;
    }

    const liveNext = liveOrg.rank.id + parsed.delta;
    if (liveNext < MIN_ORG_RANK || liveNext > MANAGE_MAX_RANK) {
      tell(player, Color.error, "玩家等级必须在 1 到 9 之间.");
      return;
    }

    const liveNextRank = getOrgRank(liveOrg.org, liveNext);
    if (!liveNextRank) {
      tell(player, Color.error, "无法更改等级.");
      return;
    }

    const ok = await setOrg(target, liveOrg.org.id, liveNextRank.id);
    if (!ok) {
      tell(player, Color.error, "无法保存到数据库.");
      return;
    }

    const tag = playerChatName(target);
    const verbUp = parsed.delta > 0;
    tell(
      player,
      Color.info,
      verbUp
        ? `你已提升 ${tag} 的等级:${liveNextRank.title}(${liveNextRank.id}).`
        : `你已降低 ${tag} 的等级:${liveNextRank.title}(${liveNextRank.id}).`
    );
    tell(
      target,
      Color.info,
      verbUp
        ? `你的等级已提升:${liveNextRank.title}(${liveNextRank.id}).`
        : `你的等级已降低:${liveNextRank.title}(${liveNextRank.id}).`
    );
  })();
});

export function bindOrgStaff(): void {
  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    const pressed = Number(newKeys) & ~Number(oldKeys);
    if ((pressed & KEY_YES) === 0 && (pressed & KEY_NO) === 0) {
      return;
    }

    const targetId = playerId(player);
    if (targetId === null || getYnOfferKind(targetId) !== "invite") {
      return;
    }

    const pending = pendingInvite.get(targetId);
    if (!pending) {
      releaseYnOffer(targetId, "invite");
      return;
    }

    if (Date.now() > pending.expiresAt) {
      expireInvite(targetId, pending.targetAccountId);
      return;
    }

    // 立即清除 pending(防止重复点击),并保留 Y/N 槽位直到处理完成.
    clearTimeout(pending.timer);
    pendingInvite.delete(targetId);

    if (!getAccount(player) || getAccount(player)?.id !== pending.targetAccountId) {
      releaseYnOffer(targetId, "invite");
      return;
    }

    const inviter = findTarget(pending.inviterSlot);
    const inviterOk =
      !!inviter && getAccount(inviter)?.id === pending.inviterAccountId && isPlayerActive(inviter);
    const org = getOrganization(pending.orgId);
    const rank = org ? getOrgRank(org, pending.orgRank) : null;
    const targetTag = playerChatName(player);
    const accepted = (pressed & KEY_YES) !== 0;
    const verb = byGender(
      getAccount(player)?.gender ?? null,
      accepted ? "接受了" : "拒绝了",
      accepted ? "接受了" : "拒绝了"
    );

    if (!accepted) {
      releaseYnOffer(targetId, "invite");
      tell(player, Color.info, "你拒绝了邀请.");
      if (inviterOk && inviter) {
        tell(inviter, Color.info, `${targetTag} ${verb} 邀请.`);
      }
      return;
    }

    const live = getAccount(player);
    if (!live || !org || !rank) {
      releaseYnOffer(targetId, "invite");
      tell(player, Color.error, "邀请已失效.");
      return;
    }

    if (!live.passport) {
      releaseYnOffer(targetId, "invite");
      tell(player, Color.error, "你没有护照.");
      if (inviterOk && inviter) {
        tell(inviter, Color.error, `${targetTag} 无法加入:没有护照.`);
      }
      return;
    }

    if (live.orgId !== ORG_NONE || getMembership(live)) {
      releaseYnOffer(targetId, "invite");
      tell(player, Color.error, "你已加入组织.");
      if (inviterOk && inviter) {
        tell(inviter, Color.error, `${targetTag} 已加入组织.`);
      }
      return;
    }

    if (!inviterOk || !inviter) {
      releaseYnOffer(targetId, "invite");
      tell(player, Color.error, "邀请已失效.");
      return;
    }

    const liveStaff = staffOf(inviter);
    if (!liveStaff || liveStaff.membership.org.id !== pending.orgId) {
      releaseYnOffer(targetId, "invite");
      tell(player, Color.error, "邀请已失效.");
      return;
    }

    if (!arePlayersNearby(player, inviter, INVITE_RADIUS)) {
      releaseYnOffer(targetId, "invite");
      tell(player, Color.error, "你离邀请者太远了.");
      tell(inviter, Color.error, `${targetTag} 无法接受邀请:距离太远.`);
      return;
    }

    void (async () => {
      try {
        if (!arePlayersNearby(player, inviter, INVITE_RADIUS)) {
          tell(player, Color.error, "你离邀请者太远了.");
          tell(inviter, Color.error, `${targetTag} 无法接受邀请:距离太远.`);
          return;
        }

        const again = getAccount(player);
        if (
          !again ||
          again.id !== pending.targetAccountId ||
          again.orgId !== ORG_NONE ||
          getMembership(again)
        ) {
          tell(player, Color.error, "你已加入组织.");
          return;
        }

        const stillStaff = staffOf(inviter);
        if (!stillStaff || stillStaff.membership.org.id !== pending.orgId) {
          tell(player, Color.error, "邀请已失效.");
          return;
        }

        const ok = await setOrg(player, pending.orgId, pending.orgRank);
        if (!ok) {
          tell(player, Color.error, "无法保存到数据库.");
          if (inviterOk && inviter) {
            tell(inviter, Color.error, "无法接纳该玩家.");
          }
          return;
        }

        tell(
          player,
          Color.info,
          `你已加入组织 ${org.name}.职位:${rank.title}.`
        );
        if (inviterOk && inviter) {
          tell(inviter, Color.info, `${targetTag} ${verb} 加入 ${org.name} 的邀请.`);
        }
      } finally {
        releaseYnOffer(targetId, "invite");
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
        releaseYnOffer(targetSlot, "invite");
        if (target) {
          tell(target, Color.error, "邀请已取消.");
        }
      }
    }
  });
}

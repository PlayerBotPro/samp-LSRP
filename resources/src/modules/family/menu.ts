import { Dialog, omp, type Player } from "@omp-node/core";
import { Color, chatColorTag } from "../../shared/colors";
import { clipClientMessage, sanitizeChatText } from "../../shared/nearby";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { saveUserFamily } from "../auth/repository";
import { getAccount, patchAccount } from "../auth/session";
import { registerCommand } from "../commands/registry";
import { normalizeFamilyName } from "./create-office";
import { getFamily } from "./catalog";
import { getFamilyMembership, isFamilyOwner } from "./membership";
import {
  countFamilyMembers,
  deleteFamily,
  findFamilyByName,
  findUserNameById,
  transferFamilyOwnershipWithRanks,
  tryDeleteFamilyIfSoleMember,
  updateFamilyDescription,
  updateFamilyName,
} from "./repository";
import { clearFamilyTag, refreshFamilyTags, syncFamilyTag } from "./tags";
import {
  FAMILY_DESC_MAX,
  FAMILY_MANAGE_MAX_RANK,
  FAMILY_NAME_MAX,
  FAMILY_NAME_MIN,
  FAMILY_NONE,
  FAMILY_STAFF_MIN_RANK,
  MAX_FAMILY_RANK,
} from "./types";

export const FAMILY_MENU_DIALOG_ID = 115;
export const FAMILY_INFO_DIALOG_ID = 116;
export const FAMILY_MANAGE_DIALOG_ID = 117;
export const FAMILY_LEAVE_CONFIRM_DIALOG_ID = 118;
export const FAMILY_RENAME_DIALOG_ID = 119;
export const FAMILY_REDESC_DIALOG_ID = 120;
export const FAMILY_DELETE_CONFIRM_DIALOG_ID = 121;
export const FAMILY_TRANSFER_DIALOG_ID = 122;

const DIALOG_STYLE_MSGBOX = 0;
const DIALOG_STYLE_INPUT = 1;
const DIALOG_STYLE_LIST = 2;

registerCommand("family", "家族菜单", (player) => {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    tell(player, Color.error, "你不属于任何家族。");
    return;
  }

  showMainMenu(player);
});

export function bindFamilyMenu(): void {
  omp.on("dialogResponse", (player, dialogId, response, listItem, inputText) => {
    const id = Number(dialogId);
    if (
      id !== FAMILY_MENU_DIALOG_ID &&
      id !== FAMILY_INFO_DIALOG_ID &&
      id !== FAMILY_MANAGE_DIALOG_ID &&
      id !== FAMILY_LEAVE_CONFIRM_DIALOG_ID &&
      id !== FAMILY_RENAME_DIALOG_ID &&
      id !== FAMILY_REDESC_DIALOG_ID &&
      id !== FAMILY_DELETE_CONFIRM_DIALOG_ID &&
      id !== FAMILY_TRANSFER_DIALOG_ID
    ) {
      return;
    }

    const accepted = Number(response) !== 0;

    if (id === FAMILY_MENU_DIALOG_ID) {
      if (!accepted) {
        return;
      }
      onMainPick(player, Number(listItem));
      return;
    }

    if (id === FAMILY_INFO_DIALOG_ID) {
      if (accepted) {
        showMainMenu(player);
      }
      return;
    }

    if (id === FAMILY_MANAGE_DIALOG_ID) {
      if (!accepted) {
        showMainMenu(player);
        return;
      }
      onManagePick(player, Number(listItem));
      return;
    }

    if (id === FAMILY_LEAVE_CONFIRM_DIALOG_ID) {
      if (!accepted) {
        showMainMenu(player);
        return;
      }
      void leaveFamily(player);
      return;
    }

    if (id === FAMILY_RENAME_DIALOG_ID) {
      if (!accepted) {
        showManageMenu(player);
        return;
      }
      void renameFamily(player, String(inputText ?? ""));
      return;
    }

    if (id === FAMILY_REDESC_DIALOG_ID) {
      if (!accepted) {
        showManageMenu(player);
        return;
      }
      void redesFamily(player, String(inputText ?? ""));
      return;
    }

    if (id === FAMILY_TRANSFER_DIALOG_ID) {
      if (!accepted) {
        showManageMenu(player);
        return;
      }
      void transferFamilyRights(player, String(inputText ?? ""));
      return;
    }

    if (id === FAMILY_DELETE_CONFIRM_DIALOG_ID) {
      if (!accepted) {
        showManageMenu(player);
        return;
      }
      void dissolveFamily(player);
    }
  });
}

function showMainMenu(player: Player): void {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    tell(player, Color.error, "你不属于任何家族。");
    return;
  }

  const lines = ["信息", "家族管理", "离开家族"];

  try {
    Dialog.show(
      player,
      FAMILY_MENU_DIALOG_ID,
      DIALOG_STYLE_LIST,
      `家族：${membership.family.name}`,
      lines.join("\n"),
      "选择",
      "关闭"
    );
  } catch {
    tell(player, Color.error, "无法打开菜单。");
  }
}

function onMainPick(player: Player, listItem: number): void {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    tell(player, Color.error, "你不属于任何家族。");
    return;
  }

  if (listItem === 0) {
    void showInfo(player);
    return;
  }

  if (listItem === 1) {
    if (membership.rank.id < FAMILY_STAFF_MIN_RANK) {
      tell(player, Color.error, "达到 9 级后可使用管理功能。");
      showMainMenu(player);
      return;
    }
    showManageMenu(player);
    return;
  }

  if (listItem === 2) {
    showLeaveConfirm(player);
  }
}

async function showInfo(player: Player): Promise<void> {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    tell(player, Color.error, "你不属于任何家族。");
    return;
  }

  const family = membership.family;
  const ownerName = (await findUserNameById(family.ownerId)) ?? "—";
  const members = await countFamilyMembers(family.id);
  const desc = family.description.trim() || "—";

  const body =
    `名称： ${family.name}\n` +
    `描述： ${desc}\n` +
    `等级： ${family.level}\n` +
    `经验： ${family.exp}\n` +
    `所有者： ${ownerName}\n` +
    `成员数： ${members}\n` +
    `你的等级： ${membership.rank.title} (${membership.rank.id})`;

  try {
    Dialog.show(
      player,
      FAMILY_INFO_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "家族信息",
      body,
      "返回",
      "关闭"
    );
  } catch {
    tell(player, Color.error, "无法打开家族信息。");
  }
}

function showManageMenu(player: Player): void {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || membership.rank.id < FAMILY_STAFF_MIN_RANK) {
    tell(player, Color.error, "达到 9 级后可使用管理功能。");
    return;
  }

  const lines = [
    "更改名称",
    "更改描述",
    "转让家族所有权",
    "删除家族",
  ];

  try {
    Dialog.show(
      player,
      FAMILY_MANAGE_DIALOG_ID,
      DIALOG_STYLE_LIST,
      "家族管理",
      lines.join("\n"),
      "选择",
      "返回"
    );
  } catch {
    tell(player, Color.error, "无法打开管理菜单。");
  }
}

function onManagePick(player: Player, listItem: number): void {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || membership.rank.id < FAMILY_STAFF_MIN_RANK) {
    tell(player, Color.error, "达到 9 级后可使用管理功能。");
    return;
  }

  if (listItem === 0) {
    showRenameDialog(player);
    return;
  }

  if (listItem === 1) {
    showRedescDialog(player);
    return;
  }

  if (listItem === 2) {
    if (!isFamilyOwner(account)) {
      tell(player, Color.error, "只有所有者才能转让所有权。");
      showManageMenu(player);
      return;
    }
    showTransferDialog(player);
    return;
  }

  if (listItem === 3) {
    if (!isFamilyOwner(account)) {
      tell(player, Color.error, "只有所有者才能删除家族。");
      showManageMenu(player);
      return;
    }
    showDeleteConfirm(player);
  }
}

function showLeaveConfirm(player: Player): void {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    return;
  }

  const isOwner = membership.family.ownerId === account.id;
  const body = isOwner
    ? `你是家族“${membership.family.name}”的所有者。\n` +
      `如果你是唯一成员，家族将被解散。\n` +
      `如果还有其他成员，请先转让所有权：\n` +
      `/family → 家族管理 → 转让家族所有权。\n\n` +
      `离开家族？`
    : `离开家族“${membership.family.name}”？`;

  try {
    Dialog.show(
      player,
      FAMILY_LEAVE_CONFIRM_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "离开家族",
      body,
      "是",
      "否"
    );
  } catch {
    tell(player, Color.error, "无法打开确认窗口。");
  }
}

function showRenameDialog(player: Player): void {
  const membership = getAccount(player)
    ? getFamilyMembership(getAccount(player)!)
    : null;
  if (!membership) {
    return;
  }

  try {
    Dialog.show(
      player,
      FAMILY_RENAME_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "家族名称",
      `当前： ${membership.family.name}\n` +
        `只能使用英文字母和空格。\n` +
        `长度：${FAMILY_NAME_MIN}-${FAMILY_NAME_MAX}。\n` +
        `示例：Woozie Family`,
      "保存",
      "返回"
    );
  } catch {
    tell(player, Color.error, "无法打开对话框。");
  }
}

function showRedescDialog(player: Player): void {
  const membership = getAccount(player)
    ? getFamilyMembership(getAccount(player)!)
    : null;
  if (!membership) {
    return;
  }

  const current = membership.family.description.trim() || "—";
  try {
    Dialog.show(
      player,
      FAMILY_REDESC_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "家族描述",
      `当前：${current}\n最多 ${FAMILY_DESC_MAX} 个字符。`,
      "保存",
      "返回"
    );
  } catch {
    tell(player, Color.error, "无法打开对话框。");
  }
}

function showTransferDialog(player: Player): void {
  const account = getAccount(player);
  if (!account || !isFamilyOwner(account)) {
    return;
  }

  try {
    Dialog.show(
      player,
      FAMILY_TRANSFER_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "转让家族所有权",
      "输入玩家 ID（该玩家必须在线且属于你的家族）。\n" +
        "你将成为副手（9 级）。",
      "转让",
      "返回"
    );
  } catch {
    tell(player, Color.error, "无法打开对话框。");
  }
}

function showDeleteConfirm(player: Player): void {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || !isFamilyOwner(account)) {
    return;
  }

  try {
    Dialog.show(
      player,
      FAMILY_DELETE_CONFIRM_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "删除家族",
      `家族「${membership.family.name}」将被删除。\n` +
        `所有成员都将被移出。\n\n` +
        `确认删除吗？`,
      "删除",
      "取消"
    );
  } catch {
    tell(player, Color.error, "无法打开确认窗口。");
  }
}

async function transferFamilyRights(player: Player, rawId: string): Promise<void> {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || !isFamilyOwner(account)) {
    tell(player, Color.error, "只有所有者才能转让所有权。");
    return;
  }

  const slot = Math.floor(Number(String(rawId).trim()));
  if (!Number.isInteger(slot) || slot < 0) {
    tell(player, Color.error, "请输入有效的玩家 ID。");
    showTransferDialog(player);
    return;
  }

  const target = omp.players.at(slot);
  if (!target || !isPlayerActive(target)) {
    tell(player, Color.error, "该玩家不在线。");
    showTransferDialog(player);
    return;
  }

  try {
    if (target.isNPC()) {
      tell(player, Color.error, "未找到该玩家。");
      showTransferDialog(player);
      return;
    }
  } catch {
    tell(player, Color.error, "未找到该玩家。");
    showTransferDialog(player);
    return;
  }

  const selfId = playerId(player);
  const targetId = playerId(target);
  if (selfId !== null && selfId === targetId) {
    tell(player, Color.error, "不能将所有权转让给自己。");
    showTransferDialog(player);
    return;
  }

  const targetAccount = getAccount(target);
  const targetFamily = targetAccount ? getFamilyMembership(targetAccount) : null;
  if (
    !targetAccount ||
    !targetFamily ||
    targetFamily.family.id !== membership.family.id
  ) {
    tell(player, Color.error, "该玩家必须在线且属于你的家族。");
    showTransferDialog(player);
    return;
  }

  const familyId = membership.family.id;

  const transferred = await transferFamilyOwnershipWithRanks(
    familyId,
    account.id,
    targetAccount.id,
    FAMILY_MANAGE_MAX_RANK,
    MAX_FAMILY_RANK
  );
  if (!transferred) {
    tell(player, Color.error, "无法转让所有权。");
    showManageMenu(player);
    return;
  }

  if (isPlayerActive(player) && getAccount(player)?.id === account.id) {
    patchAccount(player, { familyId, familyRank: FAMILY_MANAGE_MAX_RANK });
    syncFamilyTag(player);
  }

  if (isPlayerActive(target) && getAccount(target)?.id === targetAccount.id) {
    patchAccount(target, { familyId, familyRank: MAX_FAMILY_RANK });
    syncFamilyTag(target);
  }

  const familyName = getFamily(familyId)?.name ?? membership.family.name;
  const targetTag = playerChatName(target);

  tell(player, Color.info, `你已将家族“${familyName}”的所有权转让给玩家 ${targetTag}。`);
  tell(player, Color.info, "你的新等级：副手（9）。");
  tell(target, Color.info, `你已成为家族“${familyName}”的所有者。`);

  broadcastFamilyNotice(
    familyId,
    familyName,
    player,
    `转让了家族所有权 ${targetTag}`
  );
  showManageMenu(player);
}

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

async function renameFamily(player: Player, raw: string): Promise<void> {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || membership.rank.id < FAMILY_STAFF_MIN_RANK) {
    tell(player, Color.error, "达到 9 级后可使用管理功能。");
    return;
  }

  const name = normalizeFamilyName(raw);
  if (!name) {
    tell(
      player,
      Color.error,
      `名称无效。只能使用英文字母和空格（${FAMILY_NAME_MIN}-${FAMILY_NAME_MAX}）。`
    );
    showRenameDialog(player);
    return;
  }

  if (name.toLowerCase() === membership.family.name.toLowerCase()) {
    tell(player, Color.info, "名称未更改。");
    showManageMenu(player);
    return;
  }

  const exists = await findFamilyByName(name);
  if (exists && exists.id !== membership.family.id) {
    tell(player, Color.error, "该家族名称已被使用。");
    showRenameDialog(player);
    return;
  }

  const ok = await updateFamilyName(membership.family.id, name);
  if (!ok) {
    tell(player, Color.error, "无法保存名称。");
    showManageMenu(player);
    return;
  }

  refreshFamilyTags(membership.family.id);
  tell(player, Color.info, `家族名称已更改为“${name}”。`);
  showManageMenu(player);
}

async function redesFamily(player: Player, raw: string): Promise<void> {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || membership.rank.id < FAMILY_STAFF_MIN_RANK) {
    tell(player, Color.error, "达到 9 级后可使用管理功能。");
    return;
  }

  const description = sanitizeChatText(raw.trim()).slice(0, FAMILY_DESC_MAX);
  if (!description) {
    tell(player, Color.error, `请输入描述（最多 ${FAMILY_DESC_MAX} 个字符）。`);
    showRedescDialog(player);
    return;
  }

  const ok = await updateFamilyDescription(membership.family.id, description);
  if (!ok) {
    tell(player, Color.error, "无法保存描述。");
    showManageMenu(player);
    return;
  }

  tell(player, Color.info, "家族描述已更新。");
  showManageMenu(player);
}

async function leaveFamily(player: Player): Promise<void> {
  const live = getAccount(player);
  const liveMembership = live ? getFamilyMembership(live) : null;
  if (!live || !liveMembership) {
    tell(player, Color.error, "你不属于任何家族。");
    return;
  }

  const familyId = liveMembership.family.id;
  const isOwner = liveMembership.family.ownerId === live.id;

  if (isOwner) {
    const dissolved = await tryDeleteFamilyIfSoleMember(familyId, live.id);
    if (!dissolved) {
      tell(
        player,
        Color.error,
        "请先转让所有权：/family → 家族管理 → 转让家族所有权。"
      );
      return;
    }

    clearOnlineFamilyMembers(familyId);
    if (isPlayerActive(player) && getAccount(player)?.id === live.id) {
      patchAccount(player, { familyId: FAMILY_NONE, familyRank: 0 });
      clearFamilyTag(player);
      tell(player, Color.info, "家族已解散。");
    }
    return;
  }

  try {
    await saveUserFamily(live.id, FAMILY_NONE, 0);
  } catch {
    tell(player, Color.error, "无法保存到数据库。");
    return;
  }

  if (!isPlayerActive(player) || getAccount(player)?.id !== live.id) {
    return;
  }

  patchAccount(player, { familyId: FAMILY_NONE, familyRank: 0 });
  clearFamilyTag(player);
  tell(player, Color.info, `你已离开家族 ${liveMembership.family.name}。`);
}

async function dissolveFamily(player: Player): Promise<void> {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || !isFamilyOwner(account)) {
    tell(player, Color.error, "只有所有者才能删除家族。");
    return;
  }

  const familyId = membership.family.id;
  const familyName = membership.family.name;

  try {
    await deleteFamily(familyId);
  } catch {
    tell(player, Color.error, "无法删除家族。");
    return;
  }

  clearOnlineFamilyMembers(familyId);
  if (getAccount(player)?.id === account.id) {
    patchAccount(player, { familyId: FAMILY_NONE, familyRank: 0 });
    clearFamilyTag(player);
  }

  tell(player, Color.info, `家族“${familyName}”已删除。`);
}

function clearOnlineFamilyMembers(familyId: number): void {
  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    const account = getAccount(other);
    if (!account || account.familyId !== familyId) {
      return;
    }

    patchAccount(other, { familyId: FAMILY_NONE, familyRank: 0 });
    clearFamilyTag(other);
    tell(other, Color.info, "你的家族已解散。");
  });
}

function tell(player: Player, color: number, text: string): void {
  try {
    if (isPlayerActive(player)) {
      player.sendClientMessage(color, text);
    }
  } catch {
    // 槽位为空。
  }
}

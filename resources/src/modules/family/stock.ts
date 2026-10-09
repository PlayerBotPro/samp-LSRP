import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { clipClientMessage } from "../../shared/nearby";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { saveUserInventory, saveUserMoney } from "../auth/repository";
import {
  applyWallet,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../auth/session";
import { getFamily } from "./catalog";
import { getFamilyMembership } from "./membership";
import {
  addFamilyAmmo,
  addFamilyDrugs,
  addFamilyMetal,
  addFamilyMoneyAwaited,
  setFamilyLocked,
  takeFamilyAmmo,
  takeFamilyDrugs,
  takeFamilyMetal,
  takeFamilyMoneyAwaited,
} from "./repository";
import {
  findFamilyStockAtPlayer,
  isPlayerOnFamilyStockPickup,
  refreshFamilyWarehouseLabel,
} from "./stock-display";

export const FAMILY_WAREHOUSE_MENU_DIALOG_ID = 110;
export const FAMILY_WAREHOUSE_AMOUNT_DIALOG_ID = 111;

export {
  ensureFamilyStockDisplay,
  findFamilyStockAtPlayer,
  removeFamilyStockDisplay,
  startFamilyWarehouseDisplay,
} from "./stock-display";

const DIALOG_STYLE_LIST = 2;
const DIALOG_STYLE_INPUT = 1;
const PLAYER_STATE_ONFOOT = 1;
const LOCK_MIN_RANK = 7;
const MAX_TRANSFER = 10_000;
const MAX_MONEY_TRANSFER = 1_000_000;
const LIME = "{9ACD32}";

type StockItem = "ammo" | "metal" | "drugs" | "money";
type StockAction = "put" | "take";

type PendingTransfer = {
  familyId: number;
  action: StockAction;
  item: StockItem;
};

const ITEM_LABEL: Record<StockItem, string> = {
  ammo: "子弹",
  metal: "金属",
  drugs: "毒品",
  money: "钱",
};

const STANDING_TICK_MS = 200;

const pendingByPlayer = new Map<number, PendingTransfer>();
const dialogBusy = new Set<number>();
const standingOn = new Set<number>();

export function bindFamilyWarehouseInteract(): void {
  setInterval(tickFamilyStockStanding, STANDING_TICK_MS);

  omp.on("dialogResponse", (player, dialogId, response, listItem, inputText) => {
    const id = Number(dialogId);
    if (id === FAMILY_WAREHOUSE_MENU_DIALOG_ID) {
      setDialogBusy(player, false);
      onMenuResponse(player, Number(response) !== 0, Number(listItem));
      return;
    }

    if (id === FAMILY_WAREHOUSE_AMOUNT_DIALOG_ID) {
      void (async () => {
        try {
          await onAmountResponse(
            player,
            Number(response) !== 0,
            String(inputText ?? "")
          );
        } finally {
          const slot = playerId(player);
          // 如果再次打开金额输入界面，则继续保持 busy 状态。
          if (slot === null || !pendingByPlayer.has(slot)) {
            setDialogBusy(player, false);
          }
        }
      })();
    }
  });

  omp.on("playerDisconnect", (player) => {
    const id = playerId(player);
    if (id === null) {
      return;
    }

    pendingByPlayer.delete(id);
    dialogBusy.delete(id);
    standingOn.delete(id);
  });
}

/** 玩家踏上拾取点时仅打开一次菜单。 */
function tickFamilyStockStanding(): void {
  omp.players.forEach((player) => {
    const id = playerId(player);
    if (id === null || !isPlayerActive(player)) {
      return;
    }

    try {
      if (player.getState() !== PLAYER_STATE_ONFOOT) {
        standingOn.delete(id);
        return;
      }
    } catch {
      standingOn.delete(id);
      return;
    }

    if (!isPlayerOnFamilyStockPickup(player)) {
      standingOn.delete(id);
      return;
    }

    if (standingOn.has(id)) {
      return;
    }

    standingOn.add(id);
    tryOpenStockMenu(player);
  });
}

function tryOpenStockMenu(player: Player): void {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const pid = playerId(player);
  if (pid !== null && dialogBusy.has(pid)) {
    return;
  }

  if (!findFamilyStockAtPlayer(player)) {
    return;
  }

  try {
    if (player.getState() !== PLAYER_STATE_ONFOOT) {
      return;
    }
  } catch {
    return;
  }

  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    player.sendClientMessage(Color.error, "你不属于任何家族。");
    return;
  }

  showMenu(player, membership.family.id);
}

function showMenu(player: Player, familyId: number): void {
  const family = getFamily(familyId);
  if (!family) {
    return;
  }

  const lockLabel = family.isLocked ? "打开仓库" : "关闭仓库";
  const body = [
    "存入子弹",
    "存入金属",
    "存入毒品",
    "存入钱",
    `${LIME}取出子弹`,
    `${LIME}取出金属`,
    `${LIME}取出毒品`,
    `${LIME}取出钱`,
    lockLabel,
  ].join("\n");

  try {
    setDialogBusy(player, true);
    Dialog.show(
      player,
      FAMILY_WAREHOUSE_MENU_DIALOG_ID,
      DIALOG_STYLE_LIST,
      `仓库: ${family.name}`,
      body,
      "选择",
      "取消"
    );
  } catch {
    setDialogBusy(player, false);
  }
}

function onMenuResponse(player: Player, accepted: boolean, listItem: number): void {
  if (!accepted) {
    clearPending(player);
    return;
  }

  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || !findFamilyStockAtPlayer(player)) {
    player.sendClientMessage(Color.error, "请靠近仓库。");
    return;
  }

  const familyId = membership.family.id;
  if (listItem === 8) {
    toggleLock(player, familyId);
    showMenu(player, familyId);
    return;
  }

  const choice = menuItemToAction(listItem);
  if (!choice) {
    return;
  }

  const family = getFamily(familyId);
  if (choice.action === "take" && family?.isLocked) {
    player.sendClientMessage(Color.error, "仓库已关闭。");
    return;
  }

  showAmountDialog(player, choice.action, choice.item, familyId);
}

function menuItemToAction(
  listItem: number
): { action: StockAction; item: StockItem } | null {
  switch (listItem) {
    case 0:
      return { action: "put", item: "ammo" };
    case 1:
      return { action: "put", item: "metal" };
    case 2:
      return { action: "put", item: "drugs" };
    case 3:
      return { action: "put", item: "money" };
    case 4:
      return { action: "take", item: "ammo" };
    case 5:
      return { action: "take", item: "metal" };
    case 6:
      return { action: "take", item: "drugs" };
    case 7:
      return { action: "take", item: "money" };
    default:
      return null;
  }
}

function showAmountDialog(
  player: Player,
  action: StockAction,
  item: StockItem,
  familyId: number
): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const account = getAccount(player);
  const family = getFamily(familyId);
  if (!account || !family) {
    clearPending(player);
    return;
  }

  pendingByPlayer.set(id, { familyId, action, item });
  const verb = action === "put" ? "存入仓库" : "从仓库取出";
  const maxTransfer = item === "money" ? MAX_MONEY_TRANSFER : MAX_TRANSFER;

  let playerHaveText: string;
  let stockHaveText: string;
  if (item === "money") {
    playerHaveText = `你拥有: ${formatMoney(account.money)}`;
    stockHaveText = `仓库中: ${formatMoney(family.money)}`;
  } else {
    const playerHave =
      item === "ammo" ? account.ammo : item === "metal" ? account.metal : account.drugs;
    const stockHave =
      item === "ammo" ? family.ammo : item === "metal" ? family.metal : family.drugs;
    playerHaveText = `你拥有: ${playerHave} 件`;
    stockHaveText = `仓库中: ${stockHave} 件`;
  }

  try {
    setDialogBusy(player, true);
    Dialog.show(
      player,
      FAMILY_WAREHOUSE_AMOUNT_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "家族仓库",
      `${verb}多少${ITEM_LABEL[item]}?\n` +
        `${playerHaveText}\n${stockHaveText}\n` +
        `单次最多: ${item === "money" ? formatMoney(maxTransfer) : maxTransfer}`,
      "OK",
      "取消"
    );
  } catch {
    setDialogBusy(player, false);
    pendingByPlayer.delete(id);
  }
}

async function onAmountResponse(
  player: Player,
  accepted: boolean,
  rawInput: string
): Promise<void> {
  if (!accepted) {
    clearPending(player);
    return;
  }

  const id = playerId(player);
  const pending = id !== null ? pendingByPlayer.get(id) : undefined;
  if (!pending) {
    player.sendClientMessage(Color.error, "操作中断。请重新进入仓库。");
    return;
  }

  if (!findFamilyStockAtPlayer(player)) {
    player.sendClientMessage(Color.error, "请靠近仓库。");
    clearPending(player);
    return;
  }

  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || membership.family.id !== pending.familyId) {
    clearPending(player);
    return;
  }

  const family = getFamily(pending.familyId);
  if (pending.action === "take" && (!family || family.isLocked)) {
    player.sendClientMessage(Color.error, "仓库已关闭。");
    clearPending(player);
    return;
  }

  const amount = Math.floor(Number(rawInput.trim().replace(",", ".")));
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amount)) {
    player.sendClientMessage(Color.error, "请输入大于 0 的整数。");
    showAmountDialog(player, pending.action, pending.item, pending.familyId);
    return;
  }

  const maxTransfer =
    pending.item === "money" ? MAX_MONEY_TRANSFER : MAX_TRANSFER;
  if (amount > maxTransfer) {
    player.sendClientMessage(
      Color.error,
      pending.item === "money"
        ? `每次最多可存入 ${formatMoney(maxTransfer)}.`
        : `每次最多可存入 ${maxTransfer} 件。`
    );
    showAmountDialog(player, pending.action, pending.item, pending.familyId);
    return;
  }

  if (pending.action === "put") {
    await applyPut(player, pending.familyId, pending.item, amount);
  } else {
    await applyTake(player, pending.familyId, pending.item, amount);
  }
}

async function applyPut(
  player: Player,
  familyId: number,
  item: StockItem,
  amount: number
): Promise<void> {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    clearPending(player);
    return;
  }

  if (item === "money") {
    if (account.money < amount) {
      player.sendClientMessage(Color.error, "资金不足。");
      showAmountDialog(player, "put", item, familyId);
      return;
    }

    const nextMoney = account.money - amount;
    if (!Number.isSafeInteger(nextMoney) || nextMoney < 0) {
      player.sendClientMessage(Color.error, "资金不足。");
      showAmountDialog(player, "put", item, familyId);
      return;
    }

    try {
      await saveUserMoney(account.id, nextMoney, account.bank);
    } catch {
      player.sendClientMessage(Color.error, "无法保存到数据库。");
      clearPending(player);
      return;
    }

    const stockTotal = await addFamilyMoneyAwaited(familyId, amount);
    if (stockTotal === null) {
      await saveUserMoney(account.id, account.money, account.bank).catch(() => undefined);
      if (isPlayerActive(player) && getAccount(player)?.id === account.id) {
        patchAccount(player, { money: account.money });
        applyWallet(player, { ...getAccount(player)!, money: account.money });
      }
      player.sendClientMessage(Color.error, "无法将资金存入仓库。");
      clearPending(player);
      return;
    }

    if (isPlayerActive(player) && getAccount(player)?.id === account.id) {
      patchAccount(player, { money: nextMoney });
      applyWallet(player, { ...getAccount(player)!, money: nextMoney });
    }

    refreshFamilyWarehouseLabel(familyId);
    clearPending(player);
    if (isPlayerActive(player)) {
      player.sendClientMessage(
        Color.info,
        `你向家族仓库存入了 ${formatMoney(amount)}.`
      );
    }
    broadcastFamilyStock(
      familyId,
      `[家族] ${membership.rank.title} ${playerChatName(player)} 存入：${formatMoney(amount)}。`
    );
    return;
  }

  const have =
    item === "ammo" ? account.ammo : item === "metal" ? account.metal : account.drugs;
  if (have < amount) {
    player.sendClientMessage(Color.error, `数量不足: ${ITEM_LABEL[item]}.`);
    showAmountDialog(player, "put", item, familyId);
    return;
  }

  const nextDrugs = item === "drugs" ? account.drugs - amount : account.drugs;
  const nextAmmo = item === "ammo" ? account.ammo - amount : account.ammo;
  const nextMetal = item === "metal" ? account.metal - amount : account.metal;
  if (nextDrugs < 0 || nextAmmo < 0 || nextMetal < 0) {
    player.sendClientMessage(Color.error, `数量不足: ${ITEM_LABEL[item]}.`);
    showAmountDialog(player, "put", item, familyId);
    return;
  }

  try {
    await saveUserInventory(account.id, nextDrugs, nextAmmo, nextMetal);
  } catch {
    player.sendClientMessage(Color.error, "无法保存到数据库。");
    clearPending(player);
    return;
  }

  if (item === "ammo") {
    addFamilyAmmo(familyId, amount);
  } else if (item === "metal") {
    addFamilyMetal(familyId, amount);
  } else {
    addFamilyDrugs(familyId, amount);
  }

  if (isPlayerActive(player) && getAccount(player)?.id === account.id) {
    patchAccount(player, { drugs: nextDrugs, ammo: nextAmmo, metal: nextMetal });
  }

  refreshFamilyWarehouseLabel(familyId);
  clearPending(player);
  if (isPlayerActive(player)) {
    player.sendClientMessage(
      Color.info,
      `你向家族仓库存入了 ${ITEM_LABEL[item]} ${amount} 件。`
    );
  }
  broadcastFamilyStock(
    familyId,
    `[家族] ${membership.rank.title} ${playerChatName(player)} 存入： ${ITEM_LABEL[item]} ${amount} 件`
  );
}

async function applyTake(
  player: Player,
  familyId: number,
  item: StockItem,
  amount: number
): Promise<void> {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    clearPending(player);
    return;
  }

  if (item === "money") {
    const nextMoney = account.money + amount;
    if (!Number.isSafeInteger(nextMoney)) {
      player.sendClientMessage(Color.error, "数量过多。");
      clearPending(player);
      return;
    }

    if (!(await takeFamilyMoneyAwaited(familyId, amount))) {
      player.sendClientMessage(Color.error, "仓库资金不足。");
      showAmountDialog(player, "take", item, familyId);
      return;
    }

    try {
      await saveUserMoney(account.id, nextMoney, account.bank);
    } catch {
      await addFamilyMoneyAwaited(familyId, amount);
      player.sendClientMessage(Color.error, "无法保存到数据库。");
      clearPending(player);
      refreshFamilyWarehouseLabel(familyId);
      return;
    }

    if (isPlayerActive(player) && getAccount(player)?.id === account.id) {
      patchAccount(player, { money: nextMoney });
      applyWallet(player, { ...getAccount(player)!, money: nextMoney });
    }

    refreshFamilyWarehouseLabel(familyId);
    clearPending(player);
    if (isPlayerActive(player)) {
      player.sendClientMessage(
        Color.info,
        `你从家族仓库取出了 ${formatMoney(amount)}.`
      );
    }
    broadcastFamilyStock(
      familyId,
      `[家族] ${membership.rank.title} ${playerChatName(player)} 取出：${formatMoney(amount)}。`
    );
    return;
  }

  const taken =
    item === "ammo"
      ? takeFamilyAmmo(familyId, amount)
      : item === "metal"
        ? takeFamilyMetal(familyId, amount)
        : takeFamilyDrugs(familyId, amount);

  if (!taken) {
    player.sendClientMessage(Color.error, `仓库中数量不足: ${ITEM_LABEL[item]}.`);
    showAmountDialog(player, "take", item, familyId);
    return;
  }

  const nextDrugs = item === "drugs" ? account.drugs + amount : account.drugs;
  const nextAmmo = item === "ammo" ? account.ammo + amount : account.ammo;
  const nextMetal = item === "metal" ? account.metal + amount : account.metal;

  if (
    !Number.isSafeInteger(nextDrugs) ||
    !Number.isSafeInteger(nextAmmo) ||
    !Number.isSafeInteger(nextMetal)
  ) {
    if (item === "ammo") {
      addFamilyAmmo(familyId, amount);
    } else if (item === "metal") {
      addFamilyMetal(familyId, amount);
    } else {
      addFamilyDrugs(familyId, amount);
    }
    player.sendClientMessage(Color.error, "数量过多。");
    clearPending(player);
    return;
  }

  try {
    await saveUserInventory(account.id, nextDrugs, nextAmmo, nextMetal);
  } catch {
    if (item === "ammo") {
      addFamilyAmmo(familyId, amount);
    } else if (item === "metal") {
      addFamilyMetal(familyId, amount);
    } else {
      addFamilyDrugs(familyId, amount);
    }
    player.sendClientMessage(Color.error, "无法保存到数据库。");
    clearPending(player);
    refreshFamilyWarehouseLabel(familyId);
    return;
  }

  if (isPlayerActive(player) && getAccount(player)?.id === account.id) {
    patchAccount(player, { drugs: nextDrugs, ammo: nextAmmo, metal: nextMetal });
  }

  refreshFamilyWarehouseLabel(familyId);
  clearPending(player);
  if (isPlayerActive(player)) {
    player.sendClientMessage(
      Color.info,
      `你从家族仓库取出了 ${ITEM_LABEL[item]} ${amount} 件。`
    );
  }
  broadcastFamilyStock(
    familyId,
    `[家族] ${membership.rank.title} ${playerChatName(player)} 取出： ${ITEM_LABEL[item]} ${amount} 件`
  );
}

function toggleLock(player: Player, familyId: number): void {
  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership || membership.family.id !== familyId) {
    return;
  }

  if (membership.rank.id < LOCK_MIN_RANK) {
    player.sendClientMessage(Color.error, "只有 7 级及以上成员才能关闭仓库。");
    return;
  }

  const next = !membership.family.isLocked;
  if (!setFamilyLocked(familyId, next)) {
    player.sendClientMessage(Color.error, "无法更改仓库状态。");
    return;
  }

  refreshFamilyWarehouseLabel(familyId);
  const verb = next ? "关闭了" : "打开了";
  player.sendClientMessage(Color.info, next ? "家族仓库已关闭。" : "家族仓库已开启。");
  broadcastFamilyStock(
    familyId,
    `[家族] ${membership.rank.title} ${playerChatName(player)} ${verb}仓库。`
  );
}

function broadcastFamilyStock(familyId: number, text: string): void {
  const line = clipClientMessage(text);
  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    const otherAccount = getAccount(other);
    if (!otherAccount || otherAccount.familyId !== familyId) {
      return;
    }

    try {
      other.sendClientMessage(Color.info, line);
    } catch {
      // 槽位为空。
    }
  });
}

function clearPending(player: Player): void {
  const id = playerId(player);
  if (id !== null) {
    pendingByPlayer.delete(id);
  }
}

function setDialogBusy(player: Player, busy: boolean): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  if (busy) {
    dialogBusy.add(id);
  } else {
    dialogBusy.delete(id);
  }
}

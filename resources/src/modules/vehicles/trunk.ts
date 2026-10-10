import { Dialog, omp, TextLabel, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { byGender } from "../auth/gender";
import { saveUserInventory } from "../auth/repository";
import { getAccount, isAuthenticated, patchAccount } from "../auth/session";
import { registerCommand } from "../commands/registry";
import {
  adjustPersonalTrunk,
  findOwnedPersonalVehicleNear,
  getPersonalRuntime,
} from "./personal";
import {
  MAX_TRUNK_AMMO,
  MAX_TRUNK_DRUGS,
  MAX_TRUNK_METAL,
  addPlayerVehicleTrunk,
  takePlayerVehicleTrunk,
  type TrunkItem,
} from "./player-vehicles";

export const TRUNK_MENU_DIALOG_ID = 88;
export const TRUNK_AMOUNT_DIALOG_ID = 89;

const DIALOG_STYLE_LIST = 2;
const DIALOG_STYLE_INPUT = 1;
const LIME = "{9ACD32}";
const MAX_TRANSFER = 500;
const LABEL_MS = 3000;
const LABEL_OFFSET_Z = 0.7;
const LABEL_DRAW_DISTANCE = 20;

type TrunkAction = "put" | "take";

type PendingTrunk = {
  dbId: number;
  runtimeId: number;
  action: TrunkAction;
  item: TrunkItem;
};

type TrunkOpenLabel = {
  label: TextLabel;
  timer: ReturnType<typeof setTimeout>;
};

const ITEM_LABEL: Record<TrunkItem, string> = {
  ammo: "弹药",
  metal: "金属",
  drugs: "毒品",
};

const pendingByPlayer = new Map<number, PendingTrunk>();
const openLabels = new Map<number, TrunkOpenLabel>();

export function bindPersonalTrunk(): void {
  registerCommand(
    "trunk",
    "个人车辆后备箱(存入 / 取出)",
    (player) => {
      void openTrunkMenu(player);
    }
  );

  omp.on("dialogResponse", (player, dialogId, response, listItem, inputText) => {
    const id = Number(dialogId);
    if (id === TRUNK_MENU_DIALOG_ID) {
      onMenuResponse(player, Number(response) !== 0, Number(listItem));
      return;
    }

    if (id === TRUNK_AMOUNT_DIALOG_ID) {
      void onAmountResponse(player, Number(response) !== 0, String(inputText ?? ""));
    }
  });

  omp.on("playerDisconnect", (player) => {
    const slotId = playerId(player);
    if (slotId !== null) {
      pendingByPlayer.delete(slotId);
    }
    hideTrunkOpenLabel(player);
  });
}

async function openTrunkMenu(player: Player): Promise<void> {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  if (!account) {
    return;
  }

  const vehicle = findOwnedPersonalVehicleNear(player, account.id);
  if (!vehicle) {
    player.sendClientMessage(
      Color.error,
      "附近没有你的载具.请靠近或上车."
    );
    return;
  }

  let runtimeId: number | null = null;
  try {
    runtimeId = vehicle.getID();
  } catch {
    return;
  }
  if (runtimeId === null || runtimeId < 1) {
    return;
  }

  const personal = getPersonalRuntime(runtimeId);
  if (!personal || personal.ownerId !== account.id) {
    player.sendClientMessage(Color.error, "这不是你的载具.");
    return;
  }

  const body = [
    "存入弹药",
    "存入金属",
    "存入毒品",
    `${LIME}取出弹药`,
    `${LIME}取出金属`,
    `${LIME}取出毒品`,
  ].join("\n");

  try {
    Dialog.show(
      player,
      TRUNK_MENU_DIALOG_ID,
      DIALOG_STYLE_LIST,
      "后备箱",
      body,
      "选择",
      "取消"
    );
    showTrunkOpenLabel(player, account.gender);
  } catch {
    player.sendClientMessage(Color.error, "无法打开后备箱.");
  }
}

function onMenuResponse(player: Player, accepted: boolean, listItem: number): void {
  if (!accepted) {
    clearPending(player);
    return;
  }

  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  if (!account) {
    return;
  }

  const vehicle = findOwnedPersonalVehicleNear(player, account.id);
  if (!vehicle) {
    player.sendClientMessage(
      Color.error,
      "附近没有你的载具.请靠近或上车."
    );
    return;
  }

  let runtimeId: number | null = null;
  try {
    runtimeId = vehicle.getID();
  } catch {
    return;
  }
  if (runtimeId === null || runtimeId < 1) {
    return;
  }

  const personal = getPersonalRuntime(runtimeId);
  if (!personal || personal.ownerId !== account.id) {
    return;
  }

  const mapped = menuItemToAction(listItem);
  if (!mapped) {
    return;
  }

  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  pendingByPlayer.set(slotId, {
    dbId: personal.dbId,
    runtimeId,
    action: mapped.action,
    item: mapped.item,
  });
  showAmountDialog(player, mapped.action, mapped.item, personal);
}

function menuItemToAction(
  listItem: number
): { action: TrunkAction; item: TrunkItem } | null {
  switch (listItem) {
    case 0:
      return { action: "put", item: "ammo" };
    case 1:
      return { action: "put", item: "metal" };
    case 2:
      return { action: "put", item: "drugs" };
    case 3:
      return { action: "take", item: "ammo" };
    case 4:
      return { action: "take", item: "metal" };
    case 5:
      return { action: "take", item: "drugs" };
    default:
      return null;
  }
}

function showAmountDialog(
  player: Player,
  action: TrunkAction,
  item: TrunkItem,
  personal: NonNullable<ReturnType<typeof getPersonalRuntime>>
): void {
  const account = getAccount(player);
  if (!account) {
    clearPending(player);
    return;
  }

  const label = ITEM_LABEL[item];
  const playerHave = playerItemAmount(account, item);
  const trunkHave = trunkItemAmount(personal, item);
  const cap = trunkCap(item);
  const verb = action === "put" ? "存入后备箱" : "从后备箱取出";
  const available =
    action === "put"
      ? `你有:${playerHave} 件\n后备箱:${trunkHave} / ${cap} 件`
      : `后备箱:${trunkHave} / ${cap} 件\n你有:${playerHave} 件`;

  try {
    Dialog.show(
      player,
      TRUNK_AMOUNT_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "后备箱",
      `要${verb}多少${label}?\n${available}\n单次最多:${MAX_TRANSFER}`,
      "确定",
      "取消"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开对话框.");
    clearPending(player);
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

  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    clearPending(player);
    return;
  }

  const slotId = playerId(player);
  const pending = slotId !== null ? pendingByPlayer.get(slotId) : undefined;
  if (!pending) {
    player.sendClientMessage(Color.error, "操作中断.请重新打开后备箱.");
    return;
  }

  const account = getAccount(player);
  if (!account) {
    clearPending(player);
    return;
  }

  const vehicle = findOwnedPersonalVehicleNear(player, account.id);
  if (!vehicle) {
    player.sendClientMessage(
      Color.error,
      "附近没有你的载具.请靠近或上车."
    );
    clearPending(player);
    return;
  }

  let runtimeId: number | null = null;
  try {
    runtimeId = vehicle.getID();
  } catch {
    clearPending(player);
    return;
  }
  if (runtimeId === null || runtimeId < 1) {
    clearPending(player);
    return;
  }

  const personal = getPersonalRuntime(runtimeId);
  if (
    !personal ||
    personal.ownerId !== account.id ||
    personal.dbId !== pending.dbId ||
    runtimeId !== pending.runtimeId
  ) {
    player.sendClientMessage(Color.error, "操作中断.请重新打开后备箱.");
    clearPending(player);
    return;
  }

  const amount = Math.floor(Number(rawInput.trim().replace(",", ".")));
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amount)) {
    player.sendClientMessage(Color.error, "请输入大于 0 的整数.");
    showAmountDialog(player, pending.action, pending.item, personal);
    return;
  }

  if (amount > MAX_TRANSFER) {
    player.sendClientMessage(
      Color.error,
      `每次最多可存入 ${MAX_TRANSFER} 件.`
    );
    showAmountDialog(player, pending.action, pending.item, personal);
    return;
  }

  if (pending.action === "put") {
    await applyPut(player, pending, personal, amount);
  } else {
    await applyTake(player, pending, personal, amount);
  }
}

async function applyPut(
  player: Player,
  pending: PendingTrunk,
  personal: NonNullable<ReturnType<typeof getPersonalRuntime>>,
  amount: number
): Promise<void> {
  const account = getAccount(player);
  if (!account) {
    clearPending(player);
    return;
  }

  const have = playerItemAmount(account, pending.item);
  if (have < amount) {
    player.sendClientMessage(Color.error, `数量不足: ${ITEM_LABEL[pending.item]}.`);
    showAmountDialog(player, "put", pending.item, personal);
    return;
  }

  const trunkHave = trunkItemAmount(personal, pending.item);
  const cap = trunkCap(pending.item);
  if (trunkHave + amount > cap) {
    player.sendClientMessage(
      Color.error,
      `后备箱最多可装 ${cap} 件.剩余空间: ${Math.max(0, cap - trunkHave)}.`
    );
    showAmountDialog(player, "put", pending.item, personal);
    return;
  }

  const nextDrugs = pending.item === "drugs" ? account.drugs - amount : account.drugs;
  const nextAmmo = pending.item === "ammo" ? account.ammo - amount : account.ammo;
  const nextMetal = pending.item === "metal" ? account.metal - amount : account.metal;
  if (nextDrugs < 0 || nextAmmo < 0 || nextMetal < 0) {
    player.sendClientMessage(Color.error, `数量不足: ${ITEM_LABEL[pending.item]}.`);
    showAmountDialog(player, "put", pending.item, personal);
    return;
  }

  let ok = false;
  try {
    ok = await addPlayerVehicleTrunk(pending.dbId, pending.item, amount);
  } catch {
    ok = false;
  }

  if (!ok) {
    player.sendClientMessage(
      Color.error,
      `后备箱没有空间存放: ${ITEM_LABEL[pending.item]}.`
    );
    showAmountDialog(player, "put", pending.item, personal);
    return;
  }

  adjustPersonalTrunk(pending.runtimeId, pending.item, amount);
  patchAccount(player, { drugs: nextDrugs, ammo: nextAmmo, metal: nextMetal });
  void saveUserInventory(account.id, nextDrugs, nextAmmo, nextMetal).catch(() => {
    // 缓存已更新.
  });

  clearPending(player);
  player.sendClientMessage(
    Color.info,
    `你放入后备箱: ${ITEM_LABEL[pending.item]} ${amount} 件.`
  );
}

async function applyTake(
  player: Player,
  pending: PendingTrunk,
  personal: NonNullable<ReturnType<typeof getPersonalRuntime>>,
  amount: number
): Promise<void> {
  const account = getAccount(player);
  if (!account) {
    clearPending(player);
    return;
  }

  const trunkHave = trunkItemAmount(personal, pending.item);
  if (trunkHave < amount) {
    player.sendClientMessage(
      Color.error,
      `后备箱中数量不足: ${ITEM_LABEL[pending.item]}.`
    );
    showAmountDialog(player, "take", pending.item, personal);
    return;
  }

  const nextDrugs = pending.item === "drugs" ? account.drugs + amount : account.drugs;
  const nextAmmo = pending.item === "ammo" ? account.ammo + amount : account.ammo;
  const nextMetal = pending.item === "metal" ? account.metal + amount : account.metal;

  if (
    !Number.isSafeInteger(nextDrugs) ||
    !Number.isSafeInteger(nextAmmo) ||
    !Number.isSafeInteger(nextMetal)
  ) {
    player.sendClientMessage(Color.error, "数量过多.");
    clearPending(player);
    return;
  }

  let ok = false;
  try {
    ok = await takePlayerVehicleTrunk(pending.dbId, pending.item, amount);
  } catch {
    ok = false;
  }

  if (!ok) {
    player.sendClientMessage(
      Color.error,
      `后备箱中数量不足: ${ITEM_LABEL[pending.item]}.`
    );
    showAmountDialog(player, "take", pending.item, personal);
    return;
  }

  adjustPersonalTrunk(pending.runtimeId, pending.item, -amount);
  patchAccount(player, { drugs: nextDrugs, ammo: nextAmmo, metal: nextMetal });
  void saveUserInventory(account.id, nextDrugs, nextAmmo, nextMetal).catch(() => {
    // 缓存已更新.
  });

  clearPending(player);
  player.sendClientMessage(
    Color.info,
    `你从后备箱取出: ${ITEM_LABEL[pending.item]} ${amount} 件.`
  );
}

function playerItemAmount(
  account: NonNullable<ReturnType<typeof getAccount>>,
  item: TrunkItem
): number {
  if (item === "ammo") {
    return account.ammo;
  }
  if (item === "metal") {
    return account.metal;
  }
  return account.drugs;
}

function trunkItemAmount(
  personal: NonNullable<ReturnType<typeof getPersonalRuntime>>,
  item: TrunkItem
): number {
  if (item === "ammo") {
    return personal.trunkAmmo;
  }
  if (item === "metal") {
    return personal.trunkMetal;
  }
  return personal.trunkDrugs;
}

function trunkCap(item: TrunkItem): number {
  if (item === "ammo") {
    return MAX_TRUNK_AMMO;
  }
  if (item === "metal") {
    return MAX_TRUNK_METAL;
  }
  return MAX_TRUNK_DRUGS;
}

function clearPending(player: Player): void {
  const slotId = playerId(player);
  if (slotId !== null) {
    pendingByPlayer.delete(slotId);
  }
}

function showTrunkOpenLabel(
  player: Player,
  gender: NonNullable<ReturnType<typeof getAccount>>["gender"]
): void {
  hideTrunkOpenLabel(player);

  const id = playerId(player);
  if (id === null) {
    return;
  }

  const text = byGender(gender, "打开了后备箱", "打开了后备箱");

  try {
    const pos = player.getPos();
    const label = new TextLabel(
      text,
      Color.action,
      pos.x,
      pos.y,
      pos.z + LABEL_OFFSET_Z,
      LABEL_DRAW_DISTANCE,
      player.getVirtualWorld(),
      false
    );
    label.attachToPlayer(player, 0, 0, LABEL_OFFSET_Z);

    const timer = setTimeout(() => {
      hideTrunkOpenLabelById(id);
    }, LABEL_MS);

    openLabels.set(id, { label, timer });
  } catch {
    // 槽位已失效.
  }
}

function hideTrunkOpenLabel(player: Player): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }
  hideTrunkOpenLabelById(id);
}

function hideTrunkOpenLabelById(id: number): void {
  const current = openLabels.get(id);
  if (!current) {
    return;
  }

  openLabels.delete(id);
  clearTimeout(current.timer);
  try {
    current.label.destroy();
  } catch {
    // 已移除.
  }
}

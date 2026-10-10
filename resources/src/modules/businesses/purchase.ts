import { Dialog, omp, type Player } from "@omp-node/core";
import { SERVER_TAG } from "../../shared/brand";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerId } from "../../shared/player";
import { saveUserMoney } from "../auth/repository";
import { applyWallet, getAccount, isAuthenticated, patchAccount } from "../auth/session";
import { registerCommand } from "../commands/registry";
import { findNearbyForSaleBusiness, isNearBusinessEntrance } from "./access";
import { refreshBusinessLabel } from "./markers";
import {
  findOwnedBusiness,
  getBusiness,
  purchaseBusiness,
  setBusinessOwner,
  setBusinessTaxPaidUntil,
} from "./repository";
import { currentDateLocal } from "./tax-math";

export const BUYBIZ_CONFIRM_DIALOG_ID = 70;

const MIN_BUY_LEVEL = 3;
const DIALOG_STYLE_MSGBOX = 0;
const TITLE = "{33FF33}";
const LABEL = "{FFFFFF}";
const VALUE = "{FFFFFF}";

const pendingBuy = new Map<number, number>();
const buying = new Set<number>();

export function bindBusinessPurchase(): void {
  registerCommand("buybiz", "在拾取点购买企业", (player) => {
    void openBuyBusinessDialog(player);
  });

  omp.on("dialogResponse", (player, dialogId, response) => {
    if (Number(dialogId) !== BUYBIZ_CONFIRM_DIALOG_ID) {
      return;
    }

    const slotId = playerId(player);
    if (slotId === null) {
      return;
    }

    const businessId = pendingBuy.get(slotId);
    pendingBuy.delete(slotId);

    if (Number(response) === 0 || businessId === undefined) {
      return;
    }

    void tryPurchaseBusiness(player, businessId);
  });

  omp.on("playerDisconnect", (player) => {
    const slotId = playerId(player);
    if (slotId !== null) {
      pendingBuy.delete(slotId);
    }

    const account = getAccount(player);
    if (account) {
      buying.delete(account.id);
    }
  });
}

async function openBuyBusinessDialog(player: Player): Promise<void> {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  const business = findNearbyForSaleBusiness(player);
  if (!business) {
    player.sendClientMessage(Color.error, "请靠近空置企业的标记点.");
    return;
  }

  if (findOwnedBusiness(account.id)) {
    player.sendClientMessage(Color.error, "你已经拥有企业.");
    return;
  }

  if (account.level < MIN_BUY_LEVEL) {
    player.sendClientMessage(Color.error, "达到 3 级后才能购买企业.");
    return;
  }

  if (!account.passport) {
    player.sendClientMessage(Color.error, "需要护照.请在市政厅办理.");
    return;
  }

  const cash = Math.max(0, Math.floor(account.money));
  if (cash < business.price) {
    player.sendClientMessage(Color.error, "现金不足.");
    return;
  }

  pendingBuy.set(slotId, business.id);

  const body = [
    `${LABEL}确定要购买这家企业吗?`,
    "",
    `${LABEL}名称:\t\t${VALUE}${business.name}`,
    `${LABEL}编号:\t\t${VALUE}${business.id}`,
    `${LABEL}价格:\t\t${VALUE}${formatMoney(business.price)}`,
  ].join("\n");

  try {
    Dialog.show(
      player,
      BUYBIZ_CONFIRM_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}购买企业`,
      body,
      "购买",
      "取消"
    );
  } catch {
    pendingBuy.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开购买窗口.");
  }
}

async function tryPurchaseBusiness(player: Player, businessId: number): Promise<void> {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null || !isPlayerActive(player)) {
    return;
  }

  const business = getBusiness(businessId);
  if (!business || business.ownerId !== null) {
    player.sendClientMessage(Color.error, "该企业已被购买.");
    return;
  }

  if (!isNearBusinessEntrance(player, businessId)) {
    player.sendClientMessage(Color.error, "请靠近企业标记点.");
    return;
  }

  if (findOwnedBusiness(account.id)) {
    player.sendClientMessage(Color.error, "你已经拥有企业.");
    return;
  }

  if (account.level < MIN_BUY_LEVEL) {
    player.sendClientMessage(Color.error, "达到 3 级后才能购买企业.");
    return;
  }

  if (!account.passport) {
    player.sendClientMessage(Color.error, "需要护照.请在市政厅办理.");
    return;
  }

  const cash = Math.max(0, Math.floor(account.money));
  if (cash < business.price) {
    player.sendClientMessage(Color.error, "现金不足.");
    return;
  }

  if (buying.has(account.id)) {
    return;
  }

  buying.add(account.id);
  let result;
  try {
    result = await purchaseBusiness(businessId, account.id);
  } catch (error: unknown) {
    buying.delete(account.id);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] Purchase business ${businessId} (${account.name}): ${message}`);
    player.sendClientMessage(Color.error, "购买失败.请重试.");
    return;
  }
  buying.delete(account.id);

  if (!result.ok) {
    if (result.reason === "owned") {
      player.sendClientMessage(Color.error, "你已经拥有企业.");
      return;
    }
    if (result.reason === "funds") {
      player.sendClientMessage(Color.error, "现金不足.");
      return;
    }
    if (result.reason === "sold") {
      player.sendClientMessage(Color.error, "该企业已被购买.");
      return;
    }
    player.sendClientMessage(Color.error, "购买失败.请重试.");
    return;
  }

  if (
    !isPlayerActive(player) ||
    getAccount(player)?.id !== account.id
  ) {
    return;
  }

  const owned = setBusinessOwner(businessId, account.id, account.name);
  if (!owned) {
    player.sendClientMessage(Color.error, "购买失败.请重试.");
    return;
  }

  setBusinessTaxPaidUntil(businessId, currentDateLocal());

  patchAccount(player, { money: result.cashLeft });
  const live = getAccount(player);
  if (live) {
    applyWallet(player, live);
  }

  void saveUserMoney(account.id, result.cashLeft, account.bank).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] Failed to save funds for ${account.name}: ${message}`);
  });

  refreshBusinessLabel(businessId);

  player.sendClientMessage(
    Color.info,
    `恭喜你以 ${formatMoney(owned.price)} 的价格购买企业 "${owned.name}" (#${owned.id})!`
  );
}

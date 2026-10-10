import { Dialog, omp, type Player } from "@omp-node/core";
import { SERVER_TAG } from "../../shared/brand";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { WHISPER_RADIUS, arePlayersNearby } from "../../shared/nearby";
import { isPlayerActive, playerId, playerName } from "../../shared/player";
import {
  claimYnOffer,
  getYnOfferKind,
  releaseYnOffer,
} from "../../shared/yn-offer";
import { saveUserMoney } from "../auth/repository";
import { applyWallet, getAccount, isAuthenticated, patchAccount } from "../auth/session";
import { registerCommand } from "../commands/registry";
import { findNearbyOwnedBusiness, isNearBusinessEntrance } from "./access";
import { refreshBusinessLabel } from "./markers";
import {
  clearBusinessForSale,
  findOwnedBusiness,
  getBusiness,
  sellBusinessToState,
  setBusinessOwner,
  transferBusinessToPlayer,
  type BusinessRecord,
} from "./repository";
import { dailyBusinessTax, formatRentDate } from "./tax-math";
import { businessTypeLabel } from "./types";

export const BIZ_MENU_DIALOG_ID = 75;
export const BIZ_STATS_DIALOG_ID = 76;
export const BIZ_SELL_STATE_DIALOG_ID = 77;
export const BIZ_SELL_PLAYER_INPUT_DIALOG_ID = 78;
export const BIZ_SELL_PLAYER_CONFIRM_DIALOG_ID = 79;

const DIALOG_STYLE_MSGBOX = 0;
const DIALOG_STYLE_LIST = 2;
const DIALOG_STYLE_INPUT = 1;
const MIN_BUY_LEVEL = 3;
const KEY_YES = 65536;
const KEY_NO = 131072;
const OFFER_TTL_MS = 60_000;
const TITLE = "{FFCC00}";
const LABEL = "{FFFFFF}";
const VALUE = "{33CCFF}";

type PendingPlayerSale = {
  businessId: number;
  buyerSlot: number;
  buyerUserId: number;
  price: number;
};

type BizOffer = {
  sellerSlot: number;
  sellerUserId: number;
  businessId: number;
  price: number;
  expiresAt: number;
};

const pendingPlayerSale = new Map<number, PendingPlayerSale>();
const pendingOffers = new Map<number, BizOffer>();
const sellingState = new Set<number>();
const transferring = new Set<number>();

export function bindBusinessMenu(): void {
  registerCommand("biz", "在入口处打开自己的企业菜单", (player) => {
    showBusinessMenu(player);
  });

  omp.on("dialogResponse", (player, dialogId, response, listItem, inputText) => {
    handleBizDialog(
      player,
      Number(dialogId),
      Number(response) !== 0,
      Number(listItem),
      String(inputText ?? "")
    );
  });

  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    const pressed = Number(newKeys) & ~Number(oldKeys);
    if ((pressed & KEY_YES) === 0 && (pressed & KEY_NO) === 0) {
      return;
    }

    const slot = playerId(player);
    if (slot === null || getYnOfferKind(slot) !== "biz") {
      return;
    }

    const offer = pendingOffers.get(slot);
    if (!offer) {
      releaseYnOffer(slot, "biz");
      return;
    }

    if (Date.now() > offer.expiresAt) {
      pendingOffers.delete(slot);
      releaseYnOffer(slot, "biz");
      player.sendClientMessage(Color.error, "企业购买报价已过期.");
      return;
    }

    if ((pressed & KEY_NO) !== 0) {
      refuseBizOffer(player, slot, offer);
      return;
    }

    if ((pressed & KEY_YES) !== 0) {
      void acceptBizOffer(player, slot, offer);
    }
  });

  omp.on("playerDisconnect", (player) => {
    const slot = playerId(player);
    if (slot !== null) {
      pendingPlayerSale.delete(slot);
      if (pendingOffers.has(slot)) {
        pendingOffers.delete(slot);
        releaseYnOffer(slot, "biz");
      }
      for (const [buyerSlot, offer] of pendingOffers) {
        if (offer.sellerSlot === slot) {
          pendingOffers.delete(buyerSlot);
          releaseYnOffer(buyerSlot, "biz");
        }
      }
    }

    const account = getAccount(player);
    if (account) {
      sellingState.delete(account.id);
      transferring.delete(account.id);
    }
  });
}

function showBusinessMenu(player: Player): void {
  const account = getAccount(player);
  if (!account || !isAuthenticated(player)) {
    return;
  }

  const business = findNearbyOwnedBusiness(player, account.id);
  if (!business) {
    player.sendClientMessage(Color.error, "请靠近自己企业的标记点.");
    return;
  }

  try {
    Dialog.show(
      player,
      BIZ_MENU_DIALOG_ID,
      DIALOG_STYLE_LIST,
      `${TITLE}企业菜单`,
      ["统计", "出售企业", "将企业出售给玩家"].join("\n"),
      "选择",
      "关闭"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开企业菜单.");
  }
}

function handleBizDialog(
  player: Player,
  dialogId: number,
  ok: boolean,
  listItem: number,
  inputText: string
): void {
  if (
    dialogId !== BIZ_MENU_DIALOG_ID &&
    dialogId !== BIZ_STATS_DIALOG_ID &&
    dialogId !== BIZ_SELL_STATE_DIALOG_ID &&
    dialogId !== BIZ_SELL_PLAYER_INPUT_DIALOG_ID &&
    dialogId !== BIZ_SELL_PLAYER_CONFIRM_DIALOG_ID
  ) {
    return;
  }

  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null || !isAuthenticated(player)) {
    return;
  }

  if (dialogId === BIZ_MENU_DIALOG_ID) {
    if (!ok) {
      return;
    }

    const business = findNearbyOwnedBusiness(player, account.id);
    if (!business) {
      player.sendClientMessage(Color.error, "请靠近自己企业的标记点.");
      return;
    }

    if (listItem === 0) {
      showBusinessStats(player, business);
      return;
    }
    if (listItem === 1) {
      showSellStateConfirm(player, business);
      return;
    }
    if (listItem === 2) {
      showSellPlayerInput(player, business);
      return;
    }

    showBusinessMenu(player);
    return;
  }

  if (dialogId === BIZ_STATS_DIALOG_ID) {
    if (ok) {
      showBusinessMenu(player);
    }
    return;
  }

  if (dialogId === BIZ_SELL_STATE_DIALOG_ID) {
    if (!ok) {
      showBusinessMenu(player);
      return;
    }
    void confirmSellToState(player);
    return;
  }

  if (dialogId === BIZ_SELL_PLAYER_INPUT_DIALOG_ID) {
    if (!ok) {
      pendingPlayerSale.delete(slotId);
      showBusinessMenu(player);
      return;
    }
    prepareSellToPlayer(player, inputText);
    return;
  }

  if (dialogId === BIZ_SELL_PLAYER_CONFIRM_DIALOG_ID) {
    if (!ok) {
      pendingPlayerSale.delete(slotId);
      showBusinessMenu(player);
      return;
    }
    sendSellOfferToPlayer(player);
  }
}

function showBusinessStats(player: Player, business: BusinessRecord): void {
  const daily = dailyBusinessTax(business.price);
  const body = [
    `${LABEL}名称:\t\t${VALUE}${business.name}`,
    `${LABEL}编号:\t\t${VALUE}${business.id}`,
    `${LABEL}类型:\t\t${VALUE}${businessTypeLabel(business.typeId)}`,
    `${LABEL}价格:\t\t${VALUE}${formatMoney(business.price)}`,
    `${LABEL}余额:\t\t${VALUE}${formatMoney(business.balance)}`,
    `${LABEL}每日税款:\t\t${VALUE}${formatMoney(daily)}`,
    `${LABEL}已缴费至:\t\t${VALUE}${formatRentDate(business.taxPaidUntil)}`,
    `${LABEL}所有者:\t\t${VALUE}${business.ownerName ?? "-"}`,
  ].join("\n");

  try {
    Dialog.show(
      player,
      BIZ_STATS_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}企业统计`,
      body,
      "返回",
      "关闭"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开统计信息.");
  }
}

function showSellStateConfirm(player: Player, business: BusinessRecord): void {
  try {
    Dialog.show(
      player,
      BIZ_SELL_STATE_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}出售企业`,
      [
        `确定要将企业[${business.name}](#${business.id})出售给政府吗?`,
        "",
        `退款: ${formatMoney(business.price)}`,
        "企业利润不予退还.",
      ].join("\n"),
      "出售",
      "取消"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开出售窗口.");
  }
}

function showSellPlayerInput(player: Player, business: BusinessRecord): void {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  pendingPlayerSale.set(slotId, {
    businessId: business.id,
    buyerSlot: -1,
    buyerUserId: -1,
    price: 0,
  });

  try {
    Dialog.show(
      player,
      BIZ_SELL_PLAYER_INPUT_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      `${TITLE}出售给玩家`,
      [
        `企业: ${business.name} (#${business.id})`,
        "",
        "输入玩家 ID 和价格, 用逗号分隔.",
        "示例: 2,150000",
      ].join("\n"),
      "下一步",
      "返回"
    );
  } catch {
    pendingPlayerSale.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开出售金额输入页面.");
  }
}

function prepareSellToPlayer(player: Player, inputText: string): void {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  const business = findNearbyOwnedBusiness(player, account.id);
  if (!business) {
    pendingPlayerSale.delete(slotId);
    player.sendClientMessage(Color.error, "请靠近自己企业的标记点.");
    return;
  }

  const parsed = parseSellPlayerInput(inputText);
  if (!parsed) {
    player.sendClientMessage(Color.error, "格式: ID,价格 - 例如 2,150000");
    showSellPlayerInput(player, business);
    return;
  }

  if (parsed.slot === slotId) {
    player.sendClientMessage(Color.error, "不能把企业卖给自己.");
    showSellPlayerInput(player, business);
    return;
  }

  const buyer = omp.players.at(parsed.slot);
  const buyerAccount = buyer ? getAccount(buyer) : null;
  if (!buyer || !isPlayerActive(buyer) || !buyerAccount || !isAuthenticated(buyer)) {
    player.sendClientMessage(Color.error, "玩家不在线.");
    showSellPlayerInput(player, business);
    return;
  }

  if (!arePlayersNearby(player, buyer, WHISPER_RADIUS)) {
    player.sendClientMessage(Color.error, "玩家距离太远.");
    showSellPlayerInput(player, business);
    return;
  }

  if (buyerAccount.level < MIN_BUY_LEVEL) {
    player.sendClientMessage(Color.error, "买家需要达到 3 级.");
    showSellPlayerInput(player, business);
    return;
  }

  if (!buyerAccount.passport) {
    player.sendClientMessage(Color.error, "买家没有护照.");
    showSellPlayerInput(player, business);
    return;
  }

  if (findOwnedBusiness(buyerAccount.id)) {
    player.sendClientMessage(Color.error, "该玩家已经拥有企业.");
    showSellPlayerInput(player, business);
    return;
  }

  if (buyerAccount.money < parsed.price) {
    player.sendClientMessage(Color.error, "玩家现金不足.");
    showSellPlayerInput(player, business);
    return;
  }

  pendingPlayerSale.set(slotId, {
    businessId: business.id,
    buyerSlot: parsed.slot,
    buyerUserId: buyerAccount.id,
    price: parsed.price,
  });

  try {
    Dialog.show(
      player,
      BIZ_SELL_PLAYER_CONFIRM_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}确认`,
      [
        `企业: ${business.name} (#${business.id})`,
        `买家: ${playerName(buyer)}[${parsed.slot}]`,
        `价格: ${formatMoney(parsed.price)}`,
        "",
        "向玩家发送报价吗?",
      ].join("\n"),
      "发送",
      "取消"
    );
  } catch {
    pendingPlayerSale.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开确认对话框.");
  }
}

function sendSellOfferToPlayer(player: Player): void {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  const pending = pendingPlayerSale.get(slotId);
  pendingPlayerSale.delete(slotId);
  if (!pending || pending.buyerSlot < 0) {
    showBusinessMenu(player);
    return;
  }

  const business = findNearbyOwnedBusiness(player, account.id);
  if (!business || business.id !== pending.businessId) {
    player.sendClientMessage(Color.error, "请靠近自己企业的标记点.");
    return;
  }

  const buyer = omp.players.at(pending.buyerSlot);
  const buyerAccount = buyer ? getAccount(buyer) : null;
  if (
    !buyer ||
    !isPlayerActive(buyer) ||
    !buyerAccount ||
    buyerAccount.id !== pending.buyerUserId ||
    !isAuthenticated(buyer)
  ) {
    player.sendClientMessage(Color.error, "玩家不在线.");
    return;
  }

  if (!arePlayersNearby(player, buyer, WHISPER_RADIUS)) {
    player.sendClientMessage(Color.error, "玩家距离太远.");
    return;
  }

  const buyerSlot = playerId(buyer);
  if (buyerSlot === null) {
    return;
  }

  if (pendingOffers.has(buyerSlot) || !claimYnOffer(buyerSlot, "biz")) {
    player.sendClientMessage(Color.error, "该玩家已有有效报价.");
    return;
  }

  pendingOffers.set(buyerSlot, {
    sellerSlot: slotId,
    sellerUserId: account.id,
    businessId: business.id,
    price: pending.price,
    expiresAt: Date.now() + OFFER_TTL_MS,
  });

  player.sendClientMessage(
    Color.info,
    `你向玩家 ${playerName(buyer)} 提议以 ${formatMoney(pending.price)} 出售企业 "${business.name}".`
  );
  buyer.sendClientMessage(
    Color.white,
    `${playerName(player)} 提议以 ${formatMoney(pending.price)} 购买企业 "${business.name}" (#${business.id}).`
  );
  buyer.sendClientMessage(
    Color.white,
    "按 {00CC00}Y {FFFFFF}购买,或按 {FF6600}N {FFFFFF}拒绝"
  );
}

async function confirmSellToState(player: Player): Promise<void> {
  const account = getAccount(player);
  if (!account || !isPlayerActive(player)) {
    return;
  }

  const business = findNearbyOwnedBusiness(player, account.id);
  if (!business) {
    player.sendClientMessage(Color.error, "请靠近自己企业的标记点.");
    return;
  }

  if (sellingState.has(account.id)) {
    return;
  }

  sellingState.add(account.id);
  let result;
  try {
    result = await sellBusinessToState(business.id, account.id);
  } catch (error: unknown) {
    sellingState.delete(account.id);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`Sell business ${business.id} (${account.name}): ${message}`);
    player.sendClientMessage(Color.error, "出售失败.请重试.");
    return;
  }
  sellingState.delete(account.id);

  if (!result.ok) {
    if (result.reason === "owner") {
      player.sendClientMessage(Color.error, "你没有这家企业.");
      return;
    }
    player.sendClientMessage(Color.error, "出售失败.请重试.");
    return;
  }

  if (!isPlayerActive(player) || getAccount(player)?.id !== account.id) {
    return;
  }

  const cleared = clearBusinessForSale(business.id);
  if (!cleared) {
    player.sendClientMessage(Color.error, "出售失败.请重试.");
    return;
  }

  patchAccount(player, { money: result.cashLeft });
  const live = getAccount(player);
  if (live) {
    applyWallet(player, live);
  }

  void saveUserMoney(account.id, result.cashLeft, account.bank).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`Failed to save funds for ${account.name}: ${message}`);
  });

  refreshBusinessLabel(business.id);
  player.sendClientMessage(
    Color.info,
    `你已将企业 "${business.name}" (#${business.id}) 以 ${formatMoney(result.price)} 的价格卖给政府.`
  );
}

async function acceptBizOffer(
  buyer: Player,
  buyerSlot: number,
  offer: BizOffer
): Promise<void> {
  pendingOffers.delete(buyerSlot);
  releaseYnOffer(buyerSlot, "biz");

  const buyerAccount = getAccount(buyer);
  if (!buyerAccount || !isAuthenticated(buyer)) {
    return;
  }

  if (buyerAccount.level < MIN_BUY_LEVEL) {
    buyer.sendClientMessage(Color.error, "达到 3 级后才能购买企业.");
    return;
  }

  if (!buyerAccount.passport) {
    buyer.sendClientMessage(Color.error, "需要护照.请在市政厅办理.");
    return;
  }

  if (findOwnedBusiness(buyerAccount.id)) {
    buyer.sendClientMessage(Color.error, "你已经拥有企业.");
    return;
  }

  const seller = omp.players.at(offer.sellerSlot);
  const sellerAccount = seller ? getAccount(seller) : null;
  if (
    !seller ||
    !isPlayerActive(seller) ||
    !sellerAccount ||
    sellerAccount.id !== offer.sellerUserId ||
    !isAuthenticated(seller)
  ) {
    buyer.sendClientMessage(Color.error, "卖家已退出游戏.交易已取消.");
    return;
  }

  if (!arePlayersNearby(buyer, seller, WHISPER_RADIUS)) {
    buyer.sendClientMessage(Color.error, "卖家距离太远.交易已取消.");
    seller.sendClientMessage(Color.error, "买家距离太远.交易已取消.");
    return;
  }

  if (!isNearBusinessEntrance(seller, offer.businessId)) {
    buyer.sendClientMessage(Color.error, "卖家必须在企业附近.交易已取消.");
    seller.sendClientMessage(Color.error, "请靠近企业标记点.");
    return;
  }

  const business = getBusiness(offer.businessId);
  if (!business || business.ownerId !== sellerAccount.id) {
    buyer.sendClientMessage(Color.error, "该企业已不再属于卖家.");
    return;
  }

  if (buyerAccount.money < offer.price) {
    buyer.sendClientMessage(Color.error, "现金不足.");
    seller.sendClientMessage(
      Color.error,
      `${playerName(buyer)} 无法支付购买企业的费用 (${formatMoney(offer.price)}).`
    );
    return;
  }

  if (transferring.has(sellerAccount.id) || transferring.has(buyerAccount.id)) {
    return;
  }

  transferring.add(sellerAccount.id);
  transferring.add(buyerAccount.id);

  let result;
  try {
    result = await transferBusinessToPlayer(
      offer.businessId,
      sellerAccount.id,
      buyerAccount.id,
      offer.price
    );
  } catch (error: unknown) {
    transferring.delete(sellerAccount.id);
    transferring.delete(buyerAccount.id);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`Transfer business ${offer.businessId}: ${message}`);
    buyer.sendClientMessage(Color.error, "交易失败.请重试.");
    return;
  }

  transferring.delete(sellerAccount.id);
  transferring.delete(buyerAccount.id);

  if (!result.ok) {
    if (result.reason === "buyer_owned") {
      buyer.sendClientMessage(Color.error, "你已经拥有企业.");
      return;
    }
    if (result.reason === "buyer_funds") {
      buyer.sendClientMessage(Color.error, "现金不足.");
      return;
    }
    if (result.reason === "owner") {
      buyer.sendClientMessage(Color.error, "该企业已不再属于卖家.");
      return;
    }
    buyer.sendClientMessage(Color.error, "交易失败.请重试.");
    return;
  }

  const owned = setBusinessOwner(offer.businessId, buyerAccount.id, buyerAccount.name);
  if (!owned) {
    buyer.sendClientMessage(Color.error, "交易失败.请重试.");
    return;
  }

  if (isPlayerActive(buyer) && getAccount(buyer)?.id === buyerAccount.id) {
    patchAccount(buyer, { money: result.buyerCashLeft });
    const liveBuyer = getAccount(buyer);
    if (liveBuyer) {
      applyWallet(buyer, liveBuyer);
    }
    void saveUserMoney(buyerAccount.id, result.buyerCashLeft, buyerAccount.bank).catch(() => {
      // 缓存已更新.
    });
    buyer.sendClientMessage(
      Color.info,
      `你已购买企业 "${owned.name}" (#${owned.id}),花费 ${formatMoney(offer.price)}.`
    );
  }

  if (isPlayerActive(seller) && getAccount(seller)?.id === sellerAccount.id) {
    patchAccount(seller, { money: result.sellerCashLeft });
    const liveSeller = getAccount(seller);
    if (liveSeller) {
      applyWallet(seller, liveSeller);
    }
    void saveUserMoney(sellerAccount.id, result.sellerCashLeft, sellerAccount.bank).catch(() => {
      // 缓存已更新.
    });
    seller.sendClientMessage(
      Color.info,
      `玩家 ${playerName(buyer)} 已将你的企业 "${owned.name}" 购买,花费 ${formatMoney(offer.price)}.`
    );
  }

  refreshBusinessLabel(offer.businessId);
}

function refuseBizOffer(buyer: Player, buyerSlot: number, offer: BizOffer): void {
  pendingOffers.delete(buyerSlot);
  releaseYnOffer(buyerSlot, "biz");
  buyer.sendClientMessage(Color.gray, "你拒绝购买企业.");

  const seller = omp.players.at(offer.sellerSlot);
  if (seller && isPlayerActive(seller)) {
    seller.sendClientMessage(
      Color.gray,
      `${playerName(buyer)} 拒绝购买企业.`
    );
  }
}

function parseSellPlayerInput(input: string): { slot: number; price: number } | null {
  const match = input.trim().match(/^(\d+)\s*[, ]\s*(\d+)$/);
  if (!match) {
    return null;
  }

  const slot = Number(match[1]);
  const price = Number(match[2]);
  if (!Number.isInteger(slot) || slot < 0 || !Number.isInteger(price) || price < 1) {
    return null;
  }

  return { slot, price };
}

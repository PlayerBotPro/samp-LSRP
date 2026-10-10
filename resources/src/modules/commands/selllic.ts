import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { SERVER_TAG } from "../../shared/brand";
import { arePlayersNearby } from "../../shared/nearby";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import {
  claimYnOffer,
  getYnOfferKind,
  releaseYnOffer,
} from "../../shared/yn-offer";
import { byGender } from "../auth/gender";
import { saveLicenseSale } from "../auth/repository";
import {
  findLicense,
  missingLicenses,
  type LicenseDef,
  type LicenseKey,
} from "../auth/licenses";
import {
  applyWallet,
  getAccount,
  patchAccount,
} from "../auth/session";
import { AUTOSCHOOL_INTERIOR, ORG_AUTOSCHOOL_ID } from "../org/autoschool";
import { getMembership } from "../org";
import { STREET_WORLD } from "../spawn/point";
import { registerCommand } from "./registry";

export const SELL_LIC_LIST_DIALOG_ID = 29;
export const SELL_LIC_PRICE_DIALOG_ID = 30;
/** @deprecated 现在通过 Y/N 向买家发送提议. */
export const SELL_LIC_OFFER_DIALOG_ID = 31;

const DIALOG_STYLE_INPUT = 1;
const DIALOG_STYLE_LIST = 2;
const KEY_YES = 65536;
const KEY_NO = 131072;
const DESK = { x: -2031.8607, y: -116.9832, z: 1035.1719 };
const DESK_RADIUS = 8;
const BUYER_RADIUS = 10;
const OFFER_TTL_MS = 60_000;
const MAX_MONEY = 2_147_483_647;
const PLAYER_STATE_ONFOOT = 1;

type PendingSelect = {
  targetSlot: number;
  targetAccountId: number;
  options: LicenseKey[];
};

type PendingOffer = {
  sellerSlot: number;
  sellerAccountId: number;
  buyerSlot: number;
  buyerAccountId: number;
  license: LicenseKey;
  price: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

const pendingSelect = new Map<number, PendingSelect>();
const pendingOfferByBuyer = new Map<number, PendingOffer>();
const busy = new Set<number>();

function tell(player: Player, color: number, text: string): void {
  try {
    if (isPlayerActive(player)) {
      player.sendClientMessage(color, text);
    }
  } catch {
    // 槽位为空.
  }
}

function findPlayer(slot: number): Player | null {
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

function isAutoschoolStaff(player: Player): boolean {
  const account = getAccount(player);
  const membership = account ? getMembership(account) : null;
  return membership?.org.id === ORG_AUTOSCHOOL_ID;
}

function atLicenseDesk(player: Player): boolean {
  try {
    if (player.getState() !== PLAYER_STATE_ONFOOT) {
      return false;
    }

    if (player.getVirtualWorld() !== STREET_WORLD) {
      return false;
    }

    if (player.getInterior() !== AUTOSCHOOL_INTERIOR) {
      return false;
    }

    return player.getDistanceFromPoint(DESK.x, DESK.y, DESK.z) <= DESK_RADIUS;
  } catch {
    return false;
  }
}

function saleReady(seller: Player, buyer: Player): string | null {
  if (!isAutoschoolStaff(seller)) {
    return "仅驾校工作人员可使用此命令.";
  }

  if (!atLicenseDesk(seller)) {
    return "只能在驾校柜台出售许可证.";
  }

  if (!arePlayersNearby(seller, buyer, BUYER_RADIUS)) {
    return "玩家距离太远.";
  }

  const sellerAccount = getAccount(seller);
  const buyerAccount = getAccount(buyer);
  if (sellerAccount?.hospitalized) {
    return "你需要治疗,请使用病床:/hospital.";
  }

  if (buyerAccount?.hospitalized) {
    return "该玩家需要治疗.";
  }

  return null;
}

function clearSellerSelect(player: Player): void {
  const id = playerId(player);
  if (id !== null) {
    pendingSelect.delete(id);
  }
}

function clearBuyerOffer(player: Player, notify: boolean): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const offer = pendingOfferByBuyer.get(id);
  if (!offer) {
    return;
  }

  clearTimeout(offer.timer);
  pendingOfferByBuyer.delete(id);
  releaseYnOffer(id, "selllic");

  if (!notify) {
    return;
  }

  const buyer = findPlayer(offer.buyerSlot);
  if (buyer && getAccount(buyer)?.id === offer.buyerAccountId) {
    tell(buyer, Color.error, "许可证交易提议已取消.");
  }

  const seller = findPlayer(offer.sellerSlot);
  if (seller && getAccount(seller)?.id === offer.sellerAccountId) {
    tell(seller, Color.info, "许可证交易提议已取消.");
  }
}

function expireOffer(buyerSlot: number, buyerAccountId: number): void {
  const offer = pendingOfferByBuyer.get(buyerSlot);
  if (!offer || offer.buyerAccountId !== buyerAccountId) {
    return;
  }

  clearTimeout(offer.timer);
  pendingOfferByBuyer.delete(buyerSlot);
  releaseYnOffer(buyerSlot, "selllic");

  const buyer = findPlayer(buyerSlot);
  if (buyer && getAccount(buyer)?.id === buyerAccountId) {
    tell(buyer, Color.error, "许可证交易提议已过期.");
  }

  const seller = findPlayer(offer.sellerSlot);
  if (seller && getAccount(seller)?.id === offer.sellerAccountId) {
    tell(seller, Color.error, "许可证交易提议已过期.");
  }
}

function cancelOffersFromSeller(sellerSlot: number, sellerAccountId?: number): void {
  for (const [buyerSlot, offer] of pendingOfferByBuyer) {
    if (offer.sellerSlot !== sellerSlot) {
      continue;
    }

    if (sellerAccountId !== undefined && offer.sellerAccountId !== sellerAccountId) {
      continue;
    }

    clearTimeout(offer.timer);
    pendingOfferByBuyer.delete(buyerSlot);
    releaseYnOffer(buyerSlot, "selllic");

    const buyer = findPlayer(buyerSlot);
    if (buyer && getAccount(buyer)?.id === offer.buyerAccountId) {
      tell(buyer, Color.error, "许可证交易提议已取消.");
    }
  }
}

function showLicenseList(seller: Player, options: LicenseDef[]): boolean {
  try {
    Dialog.show(
      seller,
      SELL_LIC_LIST_DIALOG_ID,
      DIALOG_STYLE_LIST,
      "出售许可证",
      options.map((row) => row.label).join("\n"),
      "下一步",
      "取消"
    );
    return true;
  } catch {
    tell(seller, Color.error, "无法打开许可证列表.");
    return false;
  }
}

function showPriceDialog(seller: Player, license: LicenseDef): boolean {
  try {
    Dialog.show(
      seller,
      SELL_LIC_PRICE_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "许可证价格",
      `许可证: ${license.label}\n价格范围: $${license.min} - $${license.max}`,
      "提议",
      "取消"
    );
    return true;
  } catch {
    tell(seller, Color.error, "无法打开价格窗口.");
    return false;
  }
}

function parsePrice(raw: string, license: LicenseDef): number | null {
  const text = raw.trim().replace(/[$\s]/g, "");
  const amount = Number(text);
  if (!Number.isInteger(amount) || amount < license.min || amount > license.max) {
    return null;
  }

  return amount;
}

registerCommand("selllic", "向学员出售许可证", (player, args) => {
  if (!isAutoschoolStaff(player)) {
    tell(player, Color.error, "仅驾校工作人员可使用此命令.");
    return;
  }

  const rawId = args.trim();
  const slot = Number(rawId);
  if (!rawId || !Number.isInteger(slot) || slot < 0) {
    tell(player, Color.error, "用法: /selllic [id]");
    return;
  }

  const target = findPlayer(slot);
  if (!target) {
    tell(player, Color.error, "未找到玩家.");
    return;
  }

  if (playerId(target) === playerId(player)) {
    tell(player, Color.error, "不能向自己出售许可证.");
    return;
  }

  const blocked = saleReady(player, target);
  if (blocked) {
    tell(player, Color.error, blocked);
    return;
  }

  const targetAccount = getAccount(target);
  const sellerId = playerId(player);
  const buyerId = playerId(target);
  if (!targetAccount || sellerId === null || buyerId === null) {
    return;
  }

  if (pendingOfferByBuyer.has(buyerId) || getYnOfferKind(buyerId) !== undefined) {
    tell(player, Color.error, "该玩家已有待处理的提议.");
    return;
  }

  const options = missingLicenses(targetAccount.licenses);
  if (options.length === 0) {
    tell(player, Color.error, "该玩家已拥有所有许可证.");
    return;
  }

  const sellerAccount = getAccount(player);
  if (sellerAccount) {
    cancelOffersFromSeller(sellerId, sellerAccount.id);
  }

  pendingSelect.set(sellerId, {
    targetSlot: slot,
    targetAccountId: targetAccount.id,
    options: options.map((row) => row.key),
  });

  if (!showLicenseList(player, options)) {
    pendingSelect.delete(sellerId);
  }
});

export function bindSellLic(): void {
  omp.on("dialogResponse", (player, dialogId, response, listItem, inputText) => {
    const id = Number(dialogId);
    if (id === SELL_LIC_LIST_DIALOG_ID) {
      onLicensePicked(player, Number(response), Number(listItem), String(inputText ?? ""));
      return;
    }

    if (id === SELL_LIC_PRICE_DIALOG_ID) {
      onPriceEntered(player, Number(response), String(inputText ?? ""));
    }
  });

  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    const pressed = Number(newKeys) & ~Number(oldKeys);
    if ((pressed & KEY_YES) === 0 && (pressed & KEY_NO) === 0) {
      return;
    }

    const buyerId = playerId(player);
    if (buyerId === null || getYnOfferKind(buyerId) !== "selllic") {
      return;
    }

    const offer = pendingOfferByBuyer.get(buyerId);
    if (!offer) {
      releaseYnOffer(buyerId, "selllic");
      return;
    }

    if (Date.now() > offer.expiresAt) {
      expireOffer(buyerId, offer.buyerAccountId);
      return;
    }

    clearTimeout(offer.timer);
    pendingOfferByBuyer.delete(buyerId);

    if (!getAccount(player) || getAccount(player)?.id !== offer.buyerAccountId) {
      releaseYnOffer(buyerId, "selllic");
      return;
    }

    const seller = findPlayer(offer.sellerSlot);
    const sellerOk =
      !!seller && getAccount(seller)?.id === offer.sellerAccountId && isPlayerActive(seller);
    const license = findLicense(offer.license);
    const buyerTag = playerChatName(player);
    const accepted = (pressed & KEY_YES) !== 0;

    if (!accepted) {
      releaseYnOffer(buyerId, "selllic");
      tell(player, Color.info, "你拒绝了提议.");
      if (sellerOk && seller) {
        const verb = byGender(
          getAccount(player)?.gender ?? null,
          "拒绝了",
          "拒绝了"
        );
        tell(seller, Color.info, `${buyerTag} ${verb}许可证交易提议.`);
      }
      return;
    }

    if (!sellerOk || !seller || !license) {
      releaseYnOffer(buyerId, "selllic");
      tell(player, Color.error, "该提议已失效.");
      return;
    }

    const blocked = saleReady(seller, player);
    if (blocked) {
      releaseYnOffer(buyerId, "selllic");
      tell(player, Color.error, blocked);
      tell(seller, Color.error, blocked);
      return;
    }

    void (async () => {
      try {
        await completeSale(seller, player, license, offer.price);
      } finally {
        releaseYnOffer(buyerId, "selllic");
      }
    })();
  });

  omp.on("playerConnect", (player) => {
    clearSellerSelect(player);
    clearBuyerOffer(player, false);
  });

  omp.on("playerDisconnect", (player) => {
    const id = playerId(player);
    clearSellerSelect(player);
    clearBuyerOffer(player, true);

    if (id !== null) {
      cancelOffersFromSeller(id);
    }
  });
}

function onLicensePicked(
  seller: Player,
  response: number,
  listItem: number,
  inputText: string
): void {
  const sellerId = playerId(seller);
  const pending = sellerId === null ? undefined : pendingSelect.get(sellerId);

  if (response === 0) {
    if (sellerId !== null) {
      pendingSelect.delete(sellerId);
    }
    return;
  }

  if (sellerId === null || !pending) {
    return;
  }

  const target = findPlayer(pending.targetSlot);
  if (!target || getAccount(target)?.id !== pending.targetAccountId) {
    pendingSelect.delete(sellerId);
    tell(seller, Color.error, "未找到玩家.");
    return;
  }

  const blocked = saleReady(seller, target);
  if (blocked) {
    pendingSelect.delete(sellerId);
    tell(seller, Color.error, blocked);
    return;
  }

  const live = getAccount(target);
  if (!live) {
    pendingSelect.delete(sellerId);
    return;
  }

  let key = pending.options[listItem];
  const typed = inputText.trim().toLowerCase();
  if (typed) {
    const byLabel = missingLicenses(live.licenses).find(
      (row) => row.label.toLowerCase() === typed
    );
    if (byLabel) {
      key = byLabel.key;
    }
  }

  const license = key ? findLicense(key) : null;
  if (!license || live.licenses[license.key]) {
    pendingSelect.delete(sellerId);
    tell(seller, Color.error, "不能向该玩家出售此许可证.");
    return;
  }

  pendingSelect.set(sellerId, {
    ...pending,
    options: [license.key],
  });

  if (!showPriceDialog(seller, license)) {
    pendingSelect.delete(sellerId);
  }
}

function onPriceEntered(seller: Player, response: number, inputText: string): void {
  const sellerId = playerId(seller);
  const pending = sellerId === null ? undefined : pendingSelect.get(sellerId);
  if (sellerId !== null) {
    pendingSelect.delete(sellerId);
  }

  if (response === 0 || !pending) {
    return;
  }

  const key = pending.options[0];
  const license = key ? findLicense(key) : null;
  if (!license) {
    return;
  }

  const target = findPlayer(pending.targetSlot);
  if (!target || getAccount(target)?.id !== pending.targetAccountId) {
    tell(seller, Color.error, "未找到玩家.");
    return;
  }

  const blocked = saleReady(seller, target);
  if (blocked) {
    tell(seller, Color.error, blocked);
    return;
  }

  const live = getAccount(target);
  if (!live || live.licenses[license.key]) {
    tell(seller, Color.error, "该玩家已有此许可证.");
    return;
  }

  const price = parsePrice(inputText, license);
  if (price === null) {
    tell(
      seller,
      Color.error,
      `${license.label} 的价格:$${license.min} - $${license.max}.`
    );
    if (sellerId !== null) {
      pendingSelect.set(sellerId, pending);
      showPriceDialog(seller, license);
    }
    return;
  }

  const buyerId = playerId(target);
  const sellerAccount = getAccount(seller);
  if (sellerId === null || buyerId === null || !sellerAccount) {
    return;
  }

  cancelOffersFromSeller(sellerId, sellerAccount.id);

  if (!claimYnOffer(buyerId, "selllic")) {
    tell(seller, Color.error, "该玩家已有待处理的提议.");
    return;
  }

  const offer: PendingOffer = {
    sellerSlot: sellerId,
    sellerAccountId: sellerAccount.id,
    buyerSlot: buyerId,
    buyerAccountId: live.id,
    license: license.key,
    price,
    expiresAt: Date.now() + OFFER_TTL_MS,
    timer: setTimeout(() => {
      expireOffer(buyerId, live.id);
    }, OFFER_TTL_MS),
  };
  pendingOfferByBuyer.set(buyerId, offer);

  tell(
    seller,
    Color.info,
    `你向 ${playerChatName(target)} 提议以 $${price} 出售 ${license.label}.`
  );
  tell(
    target,
    Color.white,
    `${sellerAccount.name} 向你出售${license.offer}执照,价格 $${price}.`
  );
  tell(
    target,
    Color.white,
    "按 {00CC00}Y {FFFFFF}购买,或按 {FF6600}N {FFFFFF}拒绝"
  );
}

async function completeSale(
  seller: Player,
  buyer: Player,
  license: LicenseDef,
  price: number
): Promise<void> {
  const sellerAccount = getAccount(seller);
  const buyerAccount = getAccount(buyer);
  if (!sellerAccount || !buyerAccount) {
    return;
  }

  if (busy.has(sellerAccount.id) || busy.has(buyerAccount.id)) {
    tell(seller, Color.error, "请等待其他操作完成.");
    tell(buyer, Color.error, "请等待其他操作完成.");
    return;
  }

  if (buyerAccount.licenses[license.key]) {
    tell(seller, Color.error, "该玩家已有此许可证.");
    tell(buyer, Color.error, "你已有此许可证.");
    return;
  }

  const sellerCash = Math.max(0, Math.floor(sellerAccount.money));
  const buyerCash = Math.max(0, Math.floor(buyerAccount.money));
  if (buyerCash < price) {
    tell(buyer, Color.error, "现金不足.");
    tell(seller, Color.error, "该玩家现金不足.");
    return;
  }

  if (sellerCash > MAX_MONEY - price) {
    tell(seller, Color.error, "你无法收取这么多现金.");
    tell(buyer, Color.error, "工作人员无法收取这笔款项.");
    return;
  }

  const nextSellerCash = sellerCash + price;
  const nextBuyerCash = buyerCash - price;
  const nextLicenses = { ...buyerAccount.licenses, [license.key]: true };

  busy.add(sellerAccount.id);
  busy.add(buyerAccount.id);
  try {
    await saveLicenseSale({
      sellerId: sellerAccount.id,
      sellerCash: nextSellerCash,
      sellerBank: sellerAccount.bank,
      buyerId: buyerAccount.id,
      buyerCash: nextBuyerCash,
      buyerBank: buyerAccount.bank,
      buyerLicenses: nextLicenses,
    });
  } catch (error: unknown) {
    busy.delete(sellerAccount.id);
    busy.delete(buyerAccount.id);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] selllic ${sellerAccount.name}: ${message}`);
    tell(seller, Color.error, "交易未能完成,请重试.");
    tell(buyer, Color.error, "交易未能完成,请重试.");
    return;
  }

  busy.delete(sellerAccount.id);
  busy.delete(buyerAccount.id);

  if (isPlayerActive(seller) && getAccount(seller)?.id === sellerAccount.id) {
    patchAccount(seller, { money: nextSellerCash });
    const liveSeller = getAccount(seller);
    if (liveSeller) {
      applyWallet(seller, liveSeller);
    }
    tell(
      seller,
      Color.info,
      `你以 $${price} 向 ${playerChatName(buyer)} 出售了 ${license.label}.`
    );
  }

  if (isPlayerActive(buyer) && getAccount(buyer)?.id === buyerAccount.id) {
    patchAccount(buyer, { money: nextBuyerCash, licenses: nextLicenses });
    const liveBuyer = getAccount(buyer);
    if (liveBuyer) {
      applyWallet(buyer, liveBuyer);
    }
    tell(buyer, Color.info, `你以 $${price} 购买了${license.offer}执照.`);
  }
}

import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerChatName, playerId, playerName } from "../../shared/player";
import {
  claimYnOffer,
  getYnOfferKind,
  releaseYnOffer,
} from "../../shared/yn-offer";
import { byGender } from "../auth/gender";
import { saveUserInventory, transferUserCash } from "../auth/repository";
import { getAccount, patchAccount } from "../auth/session";
import {
  GANG_DEAL_KEY_NO,
  GANG_DEAL_KEY_YES,
  GANG_DEAL_MAX_CASH,
  GANG_DEAL_MAX_PRICE,
  GANG_DEAL_MIN_PRICE,
  GANG_DEAL_OFFER_TTL_MS,
  applyDealCashDelta,
  claimDealBusy,
  dealPairReady,
  findDealPlayer,
  gangSellerGate,
  isDealBusy,
  parseDealOfferArgs,
  releaseDealBusy,
  tellDeal,
} from "./gang-deal";
import { registerCommand } from "./registry";

const USAGE =
  `用法:/selldrug [id] [数量] [价格 ${GANG_DEAL_MIN_PRICE}-${GANG_DEAL_MAX_PRICE}]`;

const MAX_DRUG_AMOUNT = 1000;

type PendingDrugOffer = {
  sellerSlot: number;
  sellerAccountId: number;
  buyerSlot: number;
  buyerAccountId: number;
  amount: number;
  price: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

const pendingByBuyer = new Map<number, PendingDrugOffer>();

registerCommand(
  "selldrug",
  "在帮派地盘出售毒品",
  (player, args) => {
    const sellerBlock = gangSellerGate(player);
    if (sellerBlock) {
      tellDeal(player, Color.error, sellerBlock);
      return;
    }

    const parsed = parseDealOfferArgs(args);
    if (!parsed || parsed.amount > MAX_DRUG_AMOUNT) {
      tellDeal(player, Color.error, USAGE);
      return;
    }

    const sellerId = playerId(player);
    if (sellerId === null) {
      return;
    }

    if (parsed.slot === sellerId) {
      tellDeal(player, Color.error, "不能向自己出售毒品.");
      return;
    }

    const buyer = findDealPlayer(parsed.slot);
    if (!buyer) {
      tellDeal(player, Color.error, "未找到玩家.");
      return;
    }

    const pairBlock = dealPairReady(player, buyer);
    if (pairBlock) {
      tellDeal(player, Color.error, pairBlock);
      return;
    }

    const sellerAccount = getAccount(player);
    const buyerAccount = getAccount(buyer);
    const buyerId = playerId(buyer);
    if (!sellerAccount || !buyerAccount || buyerId === null) {
      return;
    }

    if (sellerAccount.drugs < parsed.amount) {
      tellDeal(
        player,
        Color.error,
        `毒品不足.你当前有:${sellerAccount.drugs} 件`
      );
      return;
    }

    const nextBuyerDrugs = buyerAccount.drugs + parsed.amount;
    if (!Number.isSafeInteger(nextBuyerDrugs) || nextBuyerDrugs < buyerAccount.drugs) {
      tellDeal(player, Color.error, "该玩家的毒品数量已达上限.");
      return;
    }

    if (buyerAccount.money < parsed.price) {
      tellDeal(
        player,
        Color.error,
        `该玩家现金不足.需要 ${formatMoney(parsed.price)}.`
      );
      return;
    }

    if (isDealBusy(sellerId, buyerId)) {
      tellDeal(player, Color.error, "请等待上一笔交易完成.");
      return;
    }

    if (pendingByBuyer.has(buyerId) || getYnOfferKind(buyerId) !== undefined) {
      tellDeal(player, Color.error, "该玩家已有待处理的提议.");
      return;
    }

    cancelOffersFromSeller(sellerId, sellerAccount.id);

    if (!claimYnOffer(buyerId, "selldrug")) {
      tellDeal(player, Color.error, "该玩家已有待处理的提议.");
      return;
    }

    pendingByBuyer.set(buyerId, {
      sellerSlot: sellerId,
      sellerAccountId: sellerAccount.id,
      buyerSlot: buyerId,
      buyerAccountId: buyerAccount.id,
      amount: parsed.amount,
      price: parsed.price,
      expiresAt: Date.now() + GANG_DEAL_OFFER_TTL_MS,
      timer: setTimeout(() => {
        expireOffer(buyerId, buyerAccount.id);
      }, GANG_DEAL_OFFER_TTL_MS),
    });

    const pretty = formatMoney(parsed.price);
    tellDeal(
      player,
      Color.info,
      `你向 ${playerName(buyer)} 提议以 ${pretty} 出售毒品(${parsed.amount} 件).`
    );
    tellDeal(
      buyer,
      Color.white,
      `${playerName(player)} 提议以 ${pretty} 出售毒品(${parsed.amount} 件).`
    );
    tellDeal(
      buyer,
      Color.white,
      "按 {00CC00}Y {FFFFFF}购买,或按 {FF6600}N {FFFFFF}拒绝"
    );
  }
);

export function bindSellDrugOffers(): void {
  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    const pressed = Number(newKeys) & ~Number(oldKeys);
    if ((pressed & GANG_DEAL_KEY_YES) === 0 && (pressed & GANG_DEAL_KEY_NO) === 0) {
      return;
    }

    const buyerId = playerId(player);
    if (buyerId === null || getYnOfferKind(buyerId) !== "selldrug") {
      return;
    }

    const offer = pendingByBuyer.get(buyerId);
    if (!offer) {
      releaseYnOffer(buyerId, "selldrug");
      return;
    }

    if (Date.now() > offer.expiresAt) {
      expireOffer(buyerId, offer.buyerAccountId);
      return;
    }

    if (!getAccount(player) || getAccount(player)?.id !== offer.buyerAccountId) {
      clearTimeout(offer.timer);
      pendingByBuyer.delete(buyerId);
      releaseYnOffer(buyerId, "selldrug");
      return;
    }

    const seller = findDealPlayer(offer.sellerSlot);
    const sellerOk =
      !!seller &&
      getAccount(seller)?.id === offer.sellerAccountId &&
      isPlayerActive(seller);
    const accepted = (pressed & GANG_DEAL_KEY_YES) !== 0;

    if (!accepted) {
      clearTimeout(offer.timer);
      pendingByBuyer.delete(buyerId);
      releaseYnOffer(buyerId, "selldrug");
      tellDeal(player, Color.info, "你拒绝了提议.");
      if (sellerOk && seller) {
        const verb = byGender(
          getAccount(player)?.gender ?? null,
          "拒绝了",
          "拒绝了"
        );
        tellDeal(
          seller,
          Color.info,
          `${playerChatName(player)} ${verb} 毒品交易提议.`
        );
      }
      return;
    }

    if (!sellerOk || !seller) {
      clearTimeout(offer.timer);
      pendingByBuyer.delete(buyerId);
      releaseYnOffer(buyerId, "selldrug");
      tellDeal(player, Color.error, "该提议已失效.");
      return;
    }

    if (isDealBusy(buyerId, offer.sellerSlot)) {
      tellDeal(player, Color.error, "请等待上一笔交易完成.");
      return;
    }

    if (!claimDealBusy(buyerId, offer.sellerSlot)) {
      tellDeal(player, Color.error, "请等待上一笔交易完成.");
      return;
    }

    clearTimeout(offer.timer);
    pendingByBuyer.delete(buyerId);

    void completeDrugSale(seller, player, offer).finally(() => {
      releaseDealBusy(buyerId, offer.sellerSlot);
      releaseYnOffer(buyerId, "selldrug");
    });
  });

  omp.on("playerDisconnect", (player) => {
    const id = playerId(player);
    if (id === null) {
      return;
    }

    releaseDealBusy(id);
    clearBuyerOffer(id, true);
    cancelOffersFromSeller(id);
  });
}

async function completeDrugSale(
  seller: Player,
  buyer: Player,
  offer: PendingDrugOffer
): Promise<void> {
  const blocked = dealPairReady(seller, buyer);
  if (blocked) {
    tellDeal(buyer, Color.error, blocked);
    tellDeal(seller, Color.error, blocked);
    return;
  }

  const sellerAccount = getAccount(seller);
  const buyerAccount = getAccount(buyer);
  if (
    !sellerAccount ||
    !buyerAccount ||
    sellerAccount.id !== offer.sellerAccountId ||
    buyerAccount.id !== offer.buyerAccountId
  ) {
    tellDeal(buyer, Color.error, "该提议已失效.");
    return;
  }

  if (sellerAccount.drugs < offer.amount) {
    tellDeal(buyer, Color.error, "卖家的毒品不足.");
    tellDeal(seller, Color.error, "交易所需毒品不足.");
    return;
  }

  const nextSellerDrugs = sellerAccount.drugs - offer.amount;
  const nextBuyerDrugs = buyerAccount.drugs + offer.amount;
  if (!Number.isSafeInteger(nextBuyerDrugs) || nextBuyerDrugs < buyerAccount.drugs) {
    tellDeal(buyer, Color.error, "你的毒品数量已达上限.");
    tellDeal(seller, Color.error, "买家的毒品数量已达上限.");
    return;
  }

  if (buyerAccount.money < offer.price) {
    tellDeal(
      buyer,
      Color.error,
      `现金不足.需要 ${formatMoney(offer.price)}.`
    );
    tellDeal(seller, Color.error, "买家现金不足.");
    return;
  }

  if (sellerAccount.money > GANG_DEAL_MAX_CASH - offer.price) {
    tellDeal(buyer, Color.error, "无法交易:卖家持有的现金过多.");
    tellDeal(seller, Color.error, "你的现金过多,无法进行此交易.");
    return;
  }

  // 先在数据库中原子处理现金,再处理毒品,这样更容易回滚物品栏.
  let paid = false;
  try {
    paid = await transferUserCash(buyerAccount.id, sellerAccount.id, offer.price);
  } catch {
    tellDeal(buyer, Color.error, "付款失败.");
    tellDeal(seller, Color.error, "付款失败.");
    return;
  }

  if (!paid) {
    tellDeal(buyer, Color.error, "现金不足.");
    tellDeal(seller, Color.error, "买家现金不足.");
    return;
  }

  applyDealCashDelta(buyer, -offer.price);
  applyDealCashDelta(seller, offer.price);

  const prevSellerDrugs = sellerAccount.drugs;
  const prevBuyerDrugs = buyerAccount.drugs;
  patchAccount(seller, { drugs: nextSellerDrugs });
  patchAccount(buyer, { drugs: nextBuyerDrugs });

  try {
    const liveSeller = getAccount(seller);
    const liveBuyer = getAccount(buyer);
    if (
      !liveSeller ||
      !liveBuyer ||
      liveSeller.id !== offer.sellerAccountId ||
      liveBuyer.id !== offer.buyerAccountId
    ) {
      throw new Error("accounts gone");
    }

    await saveUserInventory(
      liveSeller.id,
      liveSeller.drugs,
      liveSeller.ammo,
      liveSeller.metal
    );
    await saveUserInventory(
      liveBuyer.id,
      liveBuyer.drugs,
      liveBuyer.ammo,
      liveBuyer.metal
    );
  } catch {
    patchAccount(seller, { drugs: prevSellerDrugs });
    patchAccount(buyer, { drugs: prevBuyerDrugs });
    await persistDrugCounts(seller, buyer, prevSellerDrugs, prevBuyerDrugs);
    await refundCash(seller, buyer, offer.price);
    tellDeal(buyer, Color.error, "无法保存交易,现金已退回.");
    tellDeal(seller, Color.error, "无法保存交易,现金已退回.");
    return;
  }

  const pretty = formatMoney(offer.price);
  tellDeal(
    buyer,
    Color.info,
    `你以 ${pretty} 购买了毒品(${offer.amount} 件).`
  );
  tellDeal(
    seller,
    Color.info,
    `你以 ${pretty} 向 ${playerName(buyer)} 出售了毒品(${offer.amount} 件).`
  );
}

async function persistDrugCounts(
  seller: Player,
  buyer: Player,
  sellerDrugs: number,
  buyerDrugs: number
): Promise<void> {
  const liveSeller = getAccount(seller);
  const liveBuyer = getAccount(buyer);
  try {
    if (liveSeller) {
      await saveUserInventory(
        liveSeller.id,
        sellerDrugs,
        liveSeller.ammo,
        liveSeller.metal
      );
    }
    if (liveBuyer) {
      await saveUserInventory(
        liveBuyer.id,
        buyerDrugs,
        liveBuyer.ammo,
        liveBuyer.metal
      );
    }
  } catch {
    // 调用方已设置内存状态.
  }
}

async function refundCash(
  seller: Player,
  buyer: Player,
  price: number
): Promise<void> {
  const sellerAccount = getAccount(seller);
  const buyerAccount = getAccount(buyer);
  if (!sellerAccount || !buyerAccount) {
    return;
  }

  try {
    const ok = await transferUserCash(sellerAccount.id, buyerAccount.id, price);
    if (ok) {
      applyDealCashDelta(seller, -price);
      applyDealCashDelta(buyer, price);
    }
  } catch {
    // 款项可能仍在卖家处;这比不尝试就静默失败更好.
  }
}

function expireOffer(buyerSlot: number, buyerAccountId: number): void {
  const offer = pendingByBuyer.get(buyerSlot);
  if (!offer || offer.buyerAccountId !== buyerAccountId) {
    return;
  }

  clearTimeout(offer.timer);
  pendingByBuyer.delete(buyerSlot);
  releaseYnOffer(buyerSlot, "selldrug");

  const buyer = findDealPlayer(buyerSlot);
  if (buyer && getAccount(buyer)?.id === buyerAccountId) {
    tellDeal(buyer, Color.error, "毒品交易提议已过期.");
  }

  const seller = findDealPlayer(offer.sellerSlot);
  if (seller && getAccount(seller)?.id === offer.sellerAccountId) {
    tellDeal(seller, Color.error, "毒品交易提议已过期.");
  }
}

function clearBuyerOffer(buyerSlot: number, notify: boolean): void {
  const offer = pendingByBuyer.get(buyerSlot);
  if (!offer) {
    return;
  }

  clearTimeout(offer.timer);
  pendingByBuyer.delete(buyerSlot);
  releaseYnOffer(buyerSlot, "selldrug");

  if (!notify) {
    return;
  }

  const buyer = findDealPlayer(offer.buyerSlot);
  if (buyer && getAccount(buyer)?.id === offer.buyerAccountId) {
    tellDeal(buyer, Color.error, "毒品交易提议已取消.");
  }

  const seller = findDealPlayer(offer.sellerSlot);
  if (seller && getAccount(seller)?.id === offer.sellerAccountId) {
    tellDeal(seller, Color.info, "毒品交易提议已取消.");
  }
}

function cancelOffersFromSeller(sellerSlot: number, sellerAccountId?: number): void {
  for (const [buyerSlot, offer] of pendingByBuyer) {
    if (offer.sellerSlot !== sellerSlot) {
      continue;
    }

    if (
      sellerAccountId !== undefined &&
      offer.sellerAccountId !== sellerAccountId
    ) {
      continue;
    }

    clearTimeout(offer.timer);
    pendingByBuyer.delete(buyerSlot);
    releaseYnOffer(buyerSlot, "selldrug");

    const buyer = findDealPlayer(buyerSlot);
    if (buyer && getAccount(buyer)?.id === offer.buyerAccountId) {
      tellDeal(buyer, Color.error, "毒品交易提议已取消.");
    }
  }
}

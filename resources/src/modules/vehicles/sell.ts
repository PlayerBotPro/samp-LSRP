import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { WHISPER_RADIUS, arePlayersNearby } from "../../shared/nearby";
import { isPlayerActive, playerId, playerName } from "../../shared/player";
import {
  claimYnOffer,
  getYnOfferKind,
  releaseYnOffer,
} from "../../shared/yn-offer";
import {
  applyWallet,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../auth/session";
import { findOwnedHouse } from "../houses/repository";
import { requiredDriveLicense } from "./drive-license";
import {
  destroyPersonalVehicleByDbId,
  findOwnedPersonalVehicleNear,
  findRuntimeIdByDbId,
  getPersonalRuntime,
  isPlayerNearPersonalVehicle,
  setPersonalOwner,
} from "./personal";
import {
  STATE_SELL_REFUND_RATE,
  findOwnedPlayerVehicle,
  sellPlayerVehicleToState,
  stateSellRefund,
  transferPlayerVehicleSale,
  type PlayerVehicleRecord,
} from "./player-vehicles";

export const CAR_SELL_STATE_DIALOG_ID = 90;
export const CAR_SELL_PLAYER_INPUT_DIALOG_ID = 91;
export const CAR_SELL_PLAYER_CONFIRM_DIALOG_ID = 92;

const DIALOG_STYLE_MSGBOX = 0;
const DIALOG_STYLE_INPUT = 1;
const KEY_YES = 65536;
const KEY_NO = 131072;
const OFFER_TTL_MS = 60_000;
const TITLE = "{FFCC00}";

type PendingPlayerSale = {
  vehicleId: number;
  runtimeId: number;
  buyerSlot: number;
  buyerUserId: number;
  price: number;
};

type CarOffer = {
  sellerSlot: number;
  sellerUserId: number;
  vehicleId: number;
  runtimeId: number;
  price: number;
  expiresAt: number;
};

const pendingPlayerSale = new Map<number, PendingPlayerSale>();
const pendingOffers = new Map<number, CarOffer>();
const sellingState = new Set<number>();
/** vehicleId → 正在转让给玩家. */
const transferring = new Set<number>();

export function bindPersonalVehicleSell(): void {
  omp.on("dialogResponse", (player, dialogId, response, _listItem, inputText) => {
    handleSellDialog(
      player,
      Number(dialogId),
      Number(response) !== 0,
      String(inputText ?? "")
    );
  });

  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    const pressed = Number(newKeys) & ~Number(oldKeys);
    if ((pressed & KEY_YES) === 0 && (pressed & KEY_NO) === 0) {
      return;
    }

    const slot = playerId(player);
    if (slot === null || getYnOfferKind(slot) !== "car") {
      return;
    }

    const offer = pendingOffers.get(slot);
    if (!offer) {
      releaseYnOffer(slot, "car");
      return;
    }

    if (Date.now() > offer.expiresAt) {
      pendingOffers.delete(slot);
      releaseYnOffer(slot, "car");
      player.sendClientMessage(Color.error, "载具购买报价已过期.");
      return;
    }

    if ((pressed & KEY_NO) !== 0) {
      refuseCarOffer(player, slot, offer);
      return;
    }

    if ((pressed & KEY_YES) !== 0) {
      void acceptCarOffer(player, slot, offer);
    }
  });

  omp.on("playerDisconnect", (player) => {
    const slot = playerId(player);
    if (slot !== null) {
      pendingPlayerSale.delete(slot);
      if (pendingOffers.has(slot)) {
        pendingOffers.delete(slot);
        releaseYnOffer(slot, "car");
      }
      for (const [buyerSlot, offer] of pendingOffers) {
        if (offer.sellerSlot === slot) {
          pendingOffers.delete(buyerSlot);
          releaseYnOffer(buyerSlot, "car");
          transferring.delete(offer.vehicleId);
        }
      }
    }

    const account = getAccount(player);
    if (account) {
      sellingState.delete(account.id);
    }
  });
}

export function showSellStateConfirm(
  player: Player,
  vehicle: PlayerVehicleRecord
): void {
  const refund = stateSellRefund(vehicle.purchasePrice);
  const refundPct = Math.round(STATE_SELL_REFUND_RATE * 100);
  try {
    Dialog.show(
      player,
      CAR_SELL_STATE_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}出售车辆`,
      [
        `确定要出售车辆 #${vehicle.id} (型号 ${vehicle.modelId})吗?`,
        "",
        `购买价格: ${formatMoney(vehicle.purchasePrice)}`,
        `退款: ${formatMoney(refund)} (${refundPct}%)`,
        "",
        "车辆将被永久删除.",
      ].join("\n"),
      "出售",
      "取消"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开出售窗口.");
  }
}

export function showSellPlayerInput(
  player: Player,
  vehicle: PlayerVehicleRecord
): void {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  const near = findOwnedPersonalVehicleNear(player, account.id);
  if (!near) {
    player.sendClientMessage(
      Color.error,
      "要把载具卖给玩家,请靠近自己的载具或坐进车内."
    );
    return;
  }

  let runtimeId: number | null = null;
  try {
    runtimeId = near.getID();
  } catch {
    return;
  }
  if (runtimeId === null || runtimeId < 1) {
    return;
  }

  const personal = getPersonalRuntime(runtimeId);
  if (!personal || personal.dbId !== vehicle.id) {
    player.sendClientMessage(
      Color.error,
      "要把载具卖给玩家,请靠近自己的载具或坐进车内."
    );
    return;
  }

  pendingPlayerSale.set(slotId, {
    vehicleId: vehicle.id,
    runtimeId,
    buyerSlot: -1,
    buyerUserId: -1,
    price: 0,
  });

  try {
    Dialog.show(
      player,
      CAR_SELL_PLAYER_INPUT_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      `${TITLE}出售给玩家`,
      [
        `车辆 #${vehicle.id} (型号 ${vehicle.modelId})`,
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

function handleSellDialog(
  player: Player,
  dialogId: number,
  ok: boolean,
  inputText: string
): void {
  if (
    dialogId !== CAR_SELL_STATE_DIALOG_ID &&
    dialogId !== CAR_SELL_PLAYER_INPUT_DIALOG_ID &&
    dialogId !== CAR_SELL_PLAYER_CONFIRM_DIALOG_ID
  ) {
    return;
  }

  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null || !isAuthenticated(player)) {
    return;
  }

  if (dialogId === CAR_SELL_STATE_DIALOG_ID) {
    if (!ok) {
      return;
    }
    void confirmSellToState(player);
    return;
  }

  if (dialogId === CAR_SELL_PLAYER_INPUT_DIALOG_ID) {
    if (!ok) {
      pendingPlayerSale.delete(slotId);
      return;
    }
    void prepareSellToPlayer(player, inputText);
    return;
  }

  if (dialogId === CAR_SELL_PLAYER_CONFIRM_DIALOG_ID) {
    if (!ok) {
      pendingPlayerSale.delete(slotId);
      return;
    }
    sendSellOfferToPlayer(player);
  }
}

async function confirmSellToState(player: Player): Promise<void> {
  const account = getAccount(player);
  if (!account || !isPlayerActive(player)) {
    return;
  }

  if (sellingState.has(account.id)) {
    return;
  }

  const vehicle = await findOwnedPlayerVehicle(account.id);
  if (!vehicle) {
    player.sendClientMessage(Color.error, "你没有私人载具.");
    return;
  }

  sellingState.add(account.id);
  let result;
  try {
    result = await sellPlayerVehicleToState(vehicle.id, account.id);
  } catch (error: unknown) {
    sellingState.delete(account.id);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`Sell vehicle ${vehicle.id} (${account.name}): ${message}`);
    player.sendClientMessage(Color.error, "出售失败.请重试.");
    return;
  }
  sellingState.delete(account.id);

  if (!result.ok) {
    player.sendClientMessage(Color.error, "出售失败.请重试.");
    return;
  }

  destroyPersonalVehicleByDbId(vehicle.id, false);

  if (!isPlayerActive(player) || getAccount(player)?.id !== account.id) {
    return;
  }

  patchAccount(player, { money: result.cashLeft });
  const live = getAccount(player);
  if (live) {
    applyWallet(player, live);
  }

  player.sendClientMessage(
    Color.info,
    `你以 ${formatMoney(result.refund)} 卖出了载具 #${vehicle.id}.`
  );
}

async function prepareSellToPlayer(player: Player, inputText: string): Promise<void> {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  const vehicle = await findOwnedPlayerVehicle(account.id);
  if (!vehicle) {
    pendingPlayerSale.delete(slotId);
    player.sendClientMessage(Color.error, "你没有私人载具.");
    return;
  }

  const near = findOwnedPersonalVehicleNear(player, account.id);
  if (!near) {
    pendingPlayerSale.delete(slotId);
    player.sendClientMessage(
      Color.error,
      "要把载具卖给玩家,请靠近自己的载具或坐进车内."
    );
    return;
  }

  let runtimeId: number | null = null;
  try {
    runtimeId = near.getID();
  } catch {
    pendingPlayerSale.delete(slotId);
    return;
  }
  if (runtimeId === null || runtimeId < 1) {
    pendingPlayerSale.delete(slotId);
    return;
  }

  const personal = getPersonalRuntime(runtimeId);
  if (!personal || personal.dbId !== vehicle.id) {
    pendingPlayerSale.delete(slotId);
    player.sendClientMessage(
      Color.error,
      "要把载具卖给玩家,请靠近自己的载具或坐进车内."
    );
    return;
  }

  const parsed = parseSellPlayerInput(inputText);
  if (!parsed) {
    player.sendClientMessage(Color.error, "格式: ID,价格 - 例如 2,150000");
    showSellPlayerInput(player, vehicle);
    return;
  }

  if (parsed.slot === slotId) {
    player.sendClientMessage(Color.error, "不能把载具卖给自己.");
    showSellPlayerInput(player, vehicle);
    return;
  }

  const buyer = omp.players.at(parsed.slot);
  const buyerAccount = buyer ? getAccount(buyer) : null;
  if (!buyer || !isPlayerActive(buyer) || !buyerAccount || !isAuthenticated(buyer)) {
    player.sendClientMessage(Color.error, "玩家不在线.");
    showSellPlayerInput(player, vehicle);
    return;
  }

  if (!arePlayersNearby(player, buyer, WHISPER_RADIUS)) {
    player.sendClientMessage(Color.error, "玩家距离太远.");
    showSellPlayerInput(player, vehicle);
    return;
  }

  if (!isPlayerNearPersonalVehicle(buyer, runtimeId)) {
    player.sendClientMessage(
      Color.error,
      "买家必须在车内或靠近车辆."
    );
    showSellPlayerInput(player, vehicle);
    return;
  }

  const buyerCheck = await buyerCanPurchaseVehicle(buyer, vehicle.modelId);
  if (buyerCheck) {
    player.sendClientMessage(Color.error, buyerCheck);
    showSellPlayerInput(player, vehicle);
    return;
  }

  if (buyerAccount.money < parsed.price) {
    player.sendClientMessage(Color.error, "玩家现金不足.");
    showSellPlayerInput(player, vehicle);
    return;
  }

  pendingPlayerSale.set(slotId, {
    vehicleId: vehicle.id,
    runtimeId,
    buyerSlot: parsed.slot,
    buyerUserId: buyerAccount.id,
    price: parsed.price,
  });

  try {
    Dialog.show(
      player,
      CAR_SELL_PLAYER_CONFIRM_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}确认`,
      [
        `车辆 #${vehicle.id} (型号 ${vehicle.modelId})`,
        `买家: ${playerName(buyer)}[${parsed.slot}]`,
        `价格: ${formatMoney(parsed.price)}`,
        "",
        "确定要将此车辆出售给该玩家吗?",
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
    return;
  }

  if (!isPlayerNearPersonalVehicle(player, pending.runtimeId)) {
    player.sendClientMessage(
      Color.error,
      "请靠近自己的载具或坐进车内."
    );
    return;
  }

  const personal = getPersonalRuntime(pending.runtimeId);
  if (!personal || personal.dbId !== pending.vehicleId || personal.ownerId !== account.id) {
    player.sendClientMessage(Color.error, "这已经不是你的载具了.");
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

  if (!isPlayerNearPersonalVehicle(buyer, pending.runtimeId)) {
    player.sendClientMessage(
      Color.error,
      "买家必须在车内或靠近车辆."
    );
    return;
  }

  const buyerSlot = playerId(buyer);
  if (buyerSlot === null) {
    return;
  }

  if (pendingOffers.has(buyerSlot) || !claimYnOffer(buyerSlot, "car")) {
    player.sendClientMessage(Color.error, "该玩家已有有效报价.");
    return;
  }

  pendingOffers.set(buyerSlot, {
    sellerSlot: slotId,
    sellerUserId: account.id,
    vehicleId: pending.vehicleId,
    runtimeId: pending.runtimeId,
    price: pending.price,
    expiresAt: Date.now() + OFFER_TTL_MS,
  });

  player.sendClientMessage(
    Color.info,
    `你向玩家 ${playerName(buyer)} 提议以 ${formatMoney(pending.price)} 出售载具 #${pending.vehicleId}.`
  );
  buyer.sendClientMessage(
    Color.white,
    `${playerName(player)} 提议以 ${formatMoney(pending.price)} 购买载具 #${pending.vehicleId}.`
  );
  buyer.sendClientMessage(
    Color.white,
    "按 {00CC00}Y {FFFFFF}购买,或按 {FF6600}N {FFFFFF}拒绝"
  );
}

async function acceptCarOffer(
  buyer: Player,
  buyerSlot: number,
  offer: CarOffer
): Promise<void> {
  pendingOffers.delete(buyerSlot);
  releaseYnOffer(buyerSlot, "car");

  const buyerAccount = getAccount(buyer);
  if (!buyerAccount || !isAuthenticated(buyer)) {
    return;
  }

  const vehicle = await findOwnedPlayerVehicle(offer.sellerUserId);
  if (!vehicle || vehicle.id !== offer.vehicleId) {
    buyer.sendClientMessage(Color.error, "该载具已售出或不可用.");
    return;
  }

  const licenseErr = await buyerCanPurchaseVehicle(buyer, vehicle.modelId);
  if (licenseErr) {
    buyer.sendClientMessage(Color.error, licenseErr);
    const sellerEarly = omp.players.at(offer.sellerSlot);
    if (sellerEarly && isPlayerActive(sellerEarly)) {
      sellerEarly.sendClientMessage(
        Color.error,
        `${playerName(buyer)} 无法购买载具: ${licenseErr}`
      );
    }
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

  if (
    !isPlayerNearPersonalVehicle(seller, offer.runtimeId) ||
    !isPlayerNearPersonalVehicle(buyer, offer.runtimeId)
  ) {
    buyer.sendClientMessage(
      Color.error,
      "双方都必须在车内或靠近车辆.交易已取消."
    );
    seller.sendClientMessage(
      Color.error,
      "双方都必须在车内或靠近车辆.交易已取消."
    );
    return;
  }

  const personal = getPersonalRuntime(offer.runtimeId);
  if (
    !personal ||
    personal.dbId !== offer.vehicleId ||
    personal.ownerId !== offer.sellerUserId
  ) {
    buyer.sendClientMessage(Color.error, "载具不可用.交易已取消.");
    return;
  }

  if (buyerAccount.money < offer.price) {
    buyer.sendClientMessage(
      Color.error,
      `现金不足 (${formatMoney(offer.price)}).`
    );
    seller.sendClientMessage(
      Color.error,
      `${playerName(buyer)} 无法支付载具费用 (${formatMoney(offer.price)}).`
    );
    return;
  }

  if (transferring.has(offer.vehicleId)) {
    buyer.sendClientMessage(Color.error, "交易正在处理中.");
    return;
  }

  transferring.add(offer.vehicleId);
  let result;
  try {
    result = await transferPlayerVehicleSale({
      vehicleId: offer.vehicleId,
      sellerId: offer.sellerUserId,
      buyerId: buyerAccount.id,
      price: offer.price,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`Transfer vehicle ${offer.vehicleId}: ${message}`);
    buyer.sendClientMessage(Color.error, "交易失败.请重试.");
    return;
  } finally {
    transferring.delete(offer.vehicleId);
  }

  if (!result.ok) {
    if (result.reason === "owned") {
      buyer.sendClientMessage(Color.error, "你已经有私人载具.");
      return;
    }
    if (result.reason === "funds") {
      buyer.sendClientMessage(Color.error, "现金不足.");
      return;
    }
    if (result.reason === "vehicle") {
      buyer.sendClientMessage(Color.error, "该载具已售出或不可用.");
      return;
    }
    buyer.sendClientMessage(Color.error, "交易失败.请重试.");
    return;
  }

  setPersonalOwner(offer.runtimeId, buyerAccount.id);

  const liveRuntime = findRuntimeIdByDbId(offer.vehicleId);
  if (liveRuntime !== undefined && liveRuntime !== offer.runtimeId) {
    setPersonalOwner(liveRuntime, buyerAccount.id);
  }

  patchAccount(buyer, { money: result.buyerCash });
  const liveBuyer = getAccount(buyer);
  if (liveBuyer) {
    applyWallet(buyer, liveBuyer);
  }

  if (isPlayerActive(seller) && getAccount(seller)?.id === offer.sellerUserId) {
    patchAccount(seller, { money: result.sellerCash });
    const liveSeller = getAccount(seller);
    if (liveSeller) {
      applyWallet(seller, liveSeller);
    }
    seller.sendClientMessage(
      Color.info,
      `玩家 ${playerName(buyer)} 以 ${formatMoney(offer.price)} 购买了你的载具 #${offer.vehicleId}.`
    );
  }

  buyer.sendClientMessage(
    Color.info,
    `你以 ${formatMoney(offer.price)} 购买了载具 #${offer.vehicleId}.`
  );
}

function refuseCarOffer(buyer: Player, buyerSlot: number, offer: CarOffer): void {
  pendingOffers.delete(buyerSlot);
  releaseYnOffer(buyerSlot, "car");
  buyer.sendClientMessage(Color.info, "你拒绝了购买载具.");

  const seller = omp.players.at(offer.sellerSlot);
  if (seller && isPlayerActive(seller)) {
    seller.sendClientMessage(
      Color.error,
      `${playerName(buyer)} 拒绝购买载具.`
    );
  }
}

/** 返回 null 表示可以购买;否则返回给卖家或买家的错误信息. */
async function buyerCanPurchaseVehicle(
  buyer: Player,
  modelId: number
): Promise<string | null> {
  const account = getAccount(buyer);
  if (!account) {
    return "玩家不在线.";
  }

  if (await findOwnedPlayerVehicle(account.id)) {
    return "该玩家已经拥有个人车辆.";
  }

  if (!findOwnedHouse(account.id)) {
    return "买家没有房屋.";
  }

  const need = requiredDriveLicense(modelId);
  if (need === "moto" && !account.licenses.moto) {
    return "买家没有摩托车驾照.";
  }
  if (need === "car" && !account.licenses.car) {
    return "买家没有汽车驾照.";
  }
  if (need === "fly" && !account.licenses.fly) {
    return "买家没有飞行执照.";
  }

  return null;
}

function parseSellPlayerInput(raw: string): { slot: number; price: number } | null {
  const match = raw.trim().match(/^(\d+)\s*[,;]\s*(\d+)$/);
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

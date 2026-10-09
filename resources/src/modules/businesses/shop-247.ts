import { Dialog, omp, type Player } from "@omp-node/core";
import { SERVER_TAG } from "../../shared/brand";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerId } from "../../shared/player";
import { grantWeapon } from "../anticheat/trust";
import {
  applyWallet,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../auth/session";
import { addOwnedMasks } from "../mask";
import {
  getBusiness,
  listBusinesses,
  payBusinessCashShare,
  payBusinessPhonePurchase,
  setBusinessBalance,
  type BusinessRecord,
} from "./repository";
import { getInsideBusiness } from "./session";
import { isShop247Type } from "./types";
import { businessIdFromVirtualWorld, businessVirtualWorld } from "./world";

export const SHOP_247_MENU_DIALOG_ID = 95;

const PICKUP_RADIUS = 1.6;
const TICK_MS = 200;
const PLAYER_STATE_ONFOOT = 1;
const DIALOG_STYLE_TABLIST_HEADERS = 5;
const BIZ_SHARE = 0.8;
const WEAPON_CAMERA = 43;
const CAMERA_AMMO = 36;

type ShopItem =
  | { kind: "phone"; name: string; price: number }
  | { kind: "weapon"; name: string; price: number; weaponId: number; ammo: number }
  | { kind: "mask"; name: string; price: number };

const MENU: readonly ShopItem[] = [
  { kind: "phone", name: "手机", price: 2_000 },
  { kind: "weapon", name: "相机", price: 1_000, weaponId: WEAPON_CAMERA, ammo: CAMERA_AMMO },
  { kind: "mask", name: "面具", price: 500 },
];

const standingOn = new Map<number, number>();
const pendingMenu = new Map<number, number>();
const buying = new Set<number>();

export function startShop247(): void {
  setInterval(tickShop247, TICK_MS);

  omp.on("dialogResponse", (player, dialogId, response, listItem) => {
    if (Number(dialogId) !== SHOP_247_MENU_DIALOG_ID) {
      return;
    }
    void onMenuResponse(player, Number(response) !== 0, Number(listItem));
  });

  omp.on("playerDisconnect", (player) => {
    const slotId = playerId(player);
    if (slotId !== null) {
      standingOn.delete(slotId);
      pendingMenu.delete(slotId);
    }
    const account = getAccount(player);
    if (account) {
      buying.delete(account.id);
    }
  });

  const count = listBusinesses().filter(
    (b) => isShop247Type(b.typeId) && hasBuyPickup(b)
  ).length;
  omp.log(`[${SERVER_TAG}] 24/7：销售点数量 ${count}`);
}

function hasBuyPickup(business: BusinessRecord): boolean {
  return (
    business.buyPickupX !== null &&
    business.buyPickupY !== null &&
    business.buyPickupZ !== null
  );
}

function tickShop247(): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    const slotId = playerId(player);
    if (slotId === null) {
      return;
    }

    try {
      if (player.getState() !== PLAYER_STATE_ONFOOT) {
        standingOn.delete(slotId);
        return;
      }

      const pos = player.getPos();
      const shop = findShopBuyPickupAt(
        pos.x,
        pos.y,
        pos.z,
        player.getInterior(),
        player.getVirtualWorld(),
        slotId
      );
      if (!shop) {
        standingOn.delete(slotId);
        return;
      }

      if (standingOn.get(slotId) === shop.id) {
        return;
      }

      standingOn.set(slotId, shop.id);
      openShopMenu(player, shop);
    } catch {
      standingOn.delete(slotId);
    }
  });
}

function findShopBuyPickupAt(
  x: number,
  y: number,
  z: number,
  interior: number,
  world: number,
  slotId: number
): BusinessRecord | null {
  const businessId = businessIdFromVirtualWorld(world);
  if (businessId === null) {
    return null;
  }

  const sessionId = getInsideBusiness(slotId);
  if (sessionId !== null && sessionId !== businessId) {
    return null;
  }

  const business = getBusiness(businessId);
  if (
    !business ||
    !isShop247Type(business.typeId) ||
    !hasBuyPickup(business) ||
    interior !== business.interiorId ||
    world !== businessVirtualWorld(business.id)
  ) {
    return null;
  }

  const dist = Math.hypot(
    x - (business.buyPickupX as number),
    y - (business.buyPickupY as number),
    z - (business.buyPickupZ as number)
  );
  if (dist > PICKUP_RADIUS) {
    return null;
  }

  return business;
}

function openShopMenu(player: Player, shop: BusinessRecord): void {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  if (shop.isLocked && shop.ownerId !== account.id) {
    player.sendClientMessage(Color.error, "商店已关闭。");
    return;
  }

  pendingMenu.set(slotId, shop.id);

  const lines = [
    "商品\t价格",
    ...MENU.map((item) => `${item.name}\t${formatMoney(item.price)}`),
  ];

  try {
    Dialog.show(
      player,
      SHOP_247_MENU_DIALOG_ID,
      DIALOG_STYLE_TABLIST_HEADERS,
      shop.name,
      lines.join("\n"),
      "购买",
      "取消"
    );
  } catch {
    pendingMenu.delete(slotId);
    standingOn.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开商品展示柜。");
  }
}

async function onMenuResponse(
  player: Player,
  ok: boolean,
  listItem: number
): Promise<void> {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  const businessId = pendingMenu.get(slotId);
  pendingMenu.delete(slotId);
  if (!ok || businessId === undefined) {
    return;
  }

  const item = MENU[listItem];
  if (!item) {
    return;
  }

  await buyShopItem(player, businessId, item);
  // 保留 standingOn 状态以便离开；再次购买前需离开拾取点再回来。
}

async function buyShopItem(
  player: Player,
  businessId: number,
  item: ShopItem
): Promise<void> {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  const business = getBusiness(businessId);
  if (!business || !isShop247Type(business.typeId)) {
    player.sendClientMessage(Color.error, "商店暂不可用。");
    return;
  }

  if (business.isLocked && business.ownerId !== account.id) {
    player.sendClientMessage(Color.error, "商店已关闭。");
    return;
  }

  try {
    if (player.getState() !== PLAYER_STATE_ONFOOT) {
      return;
    }
    const pos = player.getPos();
    const near = findShopBuyPickupAt(
      pos.x,
      pos.y,
      pos.z,
      player.getInterior(),
      player.getVirtualWorld(),
      slotId
    );
    if (!near || near.id !== businessId) {
      player.sendClientMessage(Color.error, "请靠近商店展示柜。");
      return;
    }
  } catch {
    return;
  }

  if (item.kind === "phone" && account.phone) {
    player.sendClientMessage(
      Color.error,
      `你已经有手机了。号码: ${account.phone}.`
    );
    return;
  }

  if (account.money < item.price) {
    player.sendClientMessage(
      Color.error,
      `现金不足。需要 ${formatMoney(item.price)}.`
    );
    return;
  }

  if (buying.has(account.id)) {
    return;
  }

  buying.add(account.id);
  try {
    if (item.kind === "phone") {
      await buyPhone(player, account.id, account.name, businessId, item.price);
    } else if (item.kind === "weapon") {
      await buyCamera(player, account.id, account.name, businessId, item);
    } else {
      await buyMask(player, account.id, account.name, businessId, item.price);
    }
  } finally {
    buying.delete(account.id);
  }
}

async function buyPhone(
  player: Player,
  userId: number,
  userName: string,
  businessId: number,
  price: number
): Promise<void> {
  let result;
  try {
    result = await payBusinessPhonePurchase(businessId, userId, price, BIZ_SHARE);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] 24/7 手机 企业=${businessId}（${userName}）：${message}`);
    player.sendClientMessage(Color.error, "购买失败。请重试。");
    return;
  }

  if (!result.ok) {
    if (result.reason === "owned") {
      player.sendClientMessage(Color.error, "你已经有手机了。");
      return;
    }
    if (result.reason === "funds") {
      player.sendClientMessage(
        Color.error,
        `现金不足。需要 ${formatMoney(price)}.`
      );
      return;
    }
    player.sendClientMessage(Color.error, "购买失败。请重试。");
    return;
  }

  setBusinessBalance(businessId, result.balance);

  if (!isPlayerActive(player) || getAccount(player)?.id !== userId) {
    return;
  }

  patchAccount(player, { money: result.cashLeft, phone: result.phone });
  const live = getAccount(player);
  if (live) {
    applyWallet(player, live);
  }

  player.sendClientMessage(
    Color.tryOk,
    `你已购买手机，花费 ${formatMoney(price)}. 你的号码: ${result.phone}.`
  );
}

async function buyCamera(
  player: Player,
  userId: number,
  userName: string,
  businessId: number,
  item: Extract<ShopItem, { kind: "weapon" }>
): Promise<void> {
  let result;
  try {
    result = await payBusinessCashShare(businessId, userId, item.price, BIZ_SHARE);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] 24/7 相机 企业=${businessId}（${userName}）：${message}`);
    player.sendClientMessage(Color.error, "购买失败。请重试。");
    return;
  }

  if (!result.ok) {
    if (result.reason === "funds") {
      player.sendClientMessage(
        Color.error,
        `现金不足。需要 ${formatMoney(item.price)}.`
      );
      return;
    }
    player.sendClientMessage(Color.error, "购买失败。请重试。");
    return;
  }

  setBusinessBalance(businessId, result.balance);

  if (!isPlayerActive(player) || getAccount(player)?.id !== userId) {
    return;
  }

  patchAccount(player, { money: result.cashLeft });
  const live = getAccount(player);
  if (live) {
    applyWallet(player, live);
  }

  grantWeapon(player, item.weaponId, item.ammo);
  player.sendClientMessage(
    Color.tryOk,
    `你已购买相机 (${item.ammo} 张照片)，花费 ${formatMoney(item.price)}.`
  );
}

async function buyMask(
  player: Player,
  userId: number,
  userName: string,
  businessId: number,
  price: number
): Promise<void> {
  let result;
  try {
    result = await payBusinessCashShare(businessId, userId, price, BIZ_SHARE);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] 24/7 面具 企业=${businessId}（${userName}）：${message}`);
    player.sendClientMessage(Color.error, "购买失败。请重试。");
    return;
  }

  if (!result.ok) {
    if (result.reason === "funds") {
      player.sendClientMessage(
        Color.error,
        `现金不足。需要 ${formatMoney(price)}.`
      );
      return;
    }
    player.sendClientMessage(Color.error, "购买失败。请重试。");
    return;
  }

  setBusinessBalance(businessId, result.balance);

  if (!isPlayerActive(player) || getAccount(player)?.id !== userId) {
    return;
  }

  const live = getAccount(player);
  if (!live) {
    return;
  }

  patchAccount(player, { money: result.cashLeft });
  applyWallet(player, getAccount(player) ?? live);
  const nextMasks = addOwnedMasks(player, 1);

  player.sendClientMessage(
    Color.tryOk,
    `你已购买面具，花费 ${formatMoney(price)}. 使用: /mask. 面具总数: ${nextMasks}.`
  );
}

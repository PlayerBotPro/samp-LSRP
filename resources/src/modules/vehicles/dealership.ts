import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { SERVER_TAG } from "../../shared/brand";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerId } from "../../shared/player";
import {
  applyWallet,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../auth/session";
import { findOwnedHouse } from "../houses/repository";
import {
  listBusinesses,
  setBusinessBalance,
  type BusinessRecord,
} from "../businesses/repository";
import { BusinessType } from "../businesses/types";
import { STREET_WORLD } from "../spawn/point";
import { DEFAULT_BUY_COLOR, purchasePlayerVehicle } from "./player-vehicles";
import { spawnPersonalVehicle } from "./personal";

export const DEALERSHIP_LIST_DIALOG_ID = 84;
export const DEALERSHIP_CONFIRM_DIALOG_ID = 85;

const PICKUP_RADIUS = 1.6;
const TICK_MS = 200;
const PLAYER_STATE_ONFOOT = 1;
const DIALOG_STYLE_TABLIST_HEADERS = 5;
const DIALOG_STYLE_MSGBOX = 0;

type CatalogItem = {
  modelId: number;
  name: string;
  price: number;
};

type PendingList = {
  businessId: number;
  typeId: number;
  items: CatalogItem[];
};

type PendingBuy = {
  businessId: number;
  item: CatalogItem;
};

const ELITE_CATALOG: readonly CatalogItem[] = [
  { modelId: 402, name: "Buffalo", price: 95_000 },
  { modelId: 411, name: "Infernus", price: 350_000 },
];

const ECONOMY_CATALOG: readonly CatalogItem[] = [
  { modelId: 400, name: "Landstalker", price: 28_000 },
  { modelId: 401, name: "Bravura", price: 18_000 },
];

const MOTO_CATALOG: readonly CatalogItem[] = [
  { modelId: 461, name: "PCJ-600", price: 35_000 },
  { modelId: 462, name: "Faggio", price: 5_000 },
  { modelId: 463, name: "Freeway", price: 22_000 },
  { modelId: 468, name: "Sanchez", price: 28_000 },
  { modelId: 471, name: "Quad", price: 30_000 },
  { modelId: 521, name: "FCR-900", price: 55_000 },
  { modelId: 522, name: "NRG-500", price: 120_000 },
  { modelId: 581, name: "BF-400", price: 32_000 },
  { modelId: 586, name: "Wayfarer", price: 15_000 },
];

const DEALERSHIP_TYPES = new Set<number>([
  BusinessType.CAR_ELITE,
  BusinessType.CAR_ECONOMY,
  BusinessType.MOTO,
]);

const standingOn = new Map<number, number>();
const pendingList = new Map<number, PendingList>();
const pendingBuy = new Map<number, PendingBuy>();
const buying = new Set<number>();

export function startDealerships(): void {
  setInterval(tickDealerships, TICK_MS);

  omp.on("dialogResponse", (player, dialogId, response, listItem) => {
    const id = Number(dialogId);
    if (id !== DEALERSHIP_LIST_DIALOG_ID && id !== DEALERSHIP_CONFIRM_DIALOG_ID) {
      return;
    }

    if (id === DEALERSHIP_LIST_DIALOG_ID) {
      handleListResponse(player, Number(response) !== 0, Number(listItem));
      return;
    }

    void handleConfirmResponse(player, Number(response) !== 0);
  });

  omp.on("playerDisconnect", (player) => {
    const slotId = playerId(player);
    if (slotId !== null) {
      standingOn.delete(slotId);
      pendingList.delete(slotId);
      pendingBuy.delete(slotId);
    }
    const account = getAccount(player);
    if (account) {
      buying.delete(account.id);
    }
  });

  const count = listBusinesses().filter((b) => DEALERSHIP_TYPES.has(b.typeId)).length;
  omp.log(`[${SERVER_TAG}] 汽车经销店:${count} 个地点`);
}

function catalogForType(typeId: number): readonly CatalogItem[] | null {
  if (typeId === BusinessType.CAR_ELITE) {
    return ELITE_CATALOG;
  }
  if (typeId === BusinessType.CAR_ECONOMY) {
    return ECONOMY_CATALOG;
  }
  if (typeId === BusinessType.MOTO) {
    return MOTO_CATALOG;
  }
  return null;
}

function licenseForType(typeId: number): "car" | "moto" {
  return typeId === BusinessType.MOTO ? "moto" : "car";
}

function shopTitle(typeId: number): string {
  if (typeId === BusinessType.CAR_ELITE) {
    return "高级汽车经销店";
  }
  if (typeId === BusinessType.CAR_ECONOMY) {
    return "经济型汽车经销店";
  }
  return "汽车市场";
}

function tickDealerships(): void {
  const shops = listBusinesses().filter((b) => DEALERSHIP_TYPES.has(b.typeId));
  if (shops.length === 0) {
    return;
  }

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
      if (player.getVirtualWorld() !== STREET_WORLD || player.getInterior() !== 0) {
        standingOn.delete(slotId);
        return;
      }

      const pos = player.getPos();
      const near = findNearestShop(shops, pos.x, pos.y, pos.z);
      if (!near) {
        standingOn.delete(slotId);
        return;
      }

      if (standingOn.get(slotId) === near.id) {
        return;
      }

      standingOn.set(slotId, near.id);
      openDealership(player, near);
    } catch {
      standingOn.delete(slotId);
    }
  });
}

function findNearestShop(
  shops: readonly BusinessRecord[],
  x: number,
  y: number,
  z: number
): BusinessRecord | null {
  let best: BusinessRecord | null = null;
  let bestDist = PICKUP_RADIUS;
  for (const shop of shops) {
    const dist = Math.hypot(x - shop.entranceX, y - shop.entranceY, z - shop.entranceZ);
    if (dist <= bestDist) {
      bestDist = dist;
      best = shop;
    }
  }
  return best;
}

function openDealership(player: Player, shop: BusinessRecord): void {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  if (!account.passport) {
    player.sendClientMessage(Color.error, "需要护照.请在市政厅办理.");
    return;
  }

  const need = licenseForType(shop.typeId);
  if (!account.licenses[need]) {
    player.sendClientMessage(
      Color.error,
      need === "moto"
        ? "你没有摩托车执照."
        : "你没有汽车执照."
    );
    return;
  }

  if (!findOwnedHouse(account.id)) {
    player.sendClientMessage(
      Color.error,
      "购买载具需要房屋 - 车辆会出现在房屋旁的停车位."
    );
    return;
  }

  const catalog = catalogForType(shop.typeId);
  if (!catalog || catalog.length === 0) {
    return;
  }

  pendingList.set(slotId, {
    businessId: shop.id,
    typeId: shop.typeId,
    items: [...catalog],
  });
  pendingBuy.delete(slotId);

  const lines = [
    "车型\t价格",
    ...catalog.map((item) => `${item.name}\t${formatMoney(item.price)}`),
  ];

  try {
    Dialog.show(
      player,
      DEALERSHIP_LIST_DIALOG_ID,
      DIALOG_STYLE_TABLIST_HEADERS,
      shopTitle(shop.typeId),
      lines.join("\n"),
      "选择",
      "关闭"
    );
  } catch {
    pendingList.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开目录.");
  }
}

function handleListResponse(player: Player, ok: boolean, listItem: number): void {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  const pending = pendingList.get(slotId);
  pendingList.delete(slotId);
  if (!pending || !ok) {
    return;
  }

  const item = pending.items[listItem];
  if (!item) {
    return;
  }

  pendingBuy.set(slotId, { businessId: pending.businessId, item });

  try {
    Dialog.show(
      player,
      DEALERSHIP_CONFIRM_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "购买车辆",
      [
        `要购买 ${item.name} 吗?`,
        "",
        `价格:${formatMoney(item.price)}`,
        "现金支付.",
        "颜色:白色.",
        "车辆将出现在你家附近的停车场.",
      ].join("\n"),
      "购买",
      "取消"
    );
  } catch {
    pendingBuy.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开确认对话框.");
  }
}

async function handleConfirmResponse(player: Player, ok: boolean): Promise<void> {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  const pending = pendingBuy.get(slotId);
  pendingBuy.delete(slotId);
  if (!pending || !ok) {
    return;
  }

  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  if (!account) {
    return;
  }

  if (!account.passport) {
    player.sendClientMessage(Color.error, "需要护照.请在市政厅办理.");
    return;
  }

  const shop = listBusinesses().find((b) => b.id === pending.businessId);
  if (!shop || !DEALERSHIP_TYPES.has(shop.typeId)) {
    player.sendClientMessage(Color.error, "汽车经销店暂不可用.");
    return;
  }

  const need = licenseForType(shop.typeId);
  if (!account.licenses[need]) {
    player.sendClientMessage(
      Color.error,
      need === "moto"
        ? "你没有摩托车执照."
        : "你没有汽车执照."
    );
    return;
  }

  const house = findOwnedHouse(account.id);
  if (!house) {
    player.sendClientMessage(
      Color.error,
      "购买载具需要房屋 - 车辆会出现在房屋旁的停车位."
    );
    return;
  }

  if (Math.max(0, Math.floor(account.money)) < pending.item.price) {
    player.sendClientMessage(
      Color.error,
      `现金不足.需要 ${formatMoney(pending.item.price)}.`
    );
    return;
  }

  if (buying.has(account.id)) {
    return;
  }

  buying.add(account.id);
  let result;
  try {
    result = await purchasePlayerVehicle({
      ownerId: account.id,
      businessId: pending.businessId,
      modelId: pending.item.modelId,
      price: pending.item.price,
      color1: DEFAULT_BUY_COLOR,
      color2: DEFAULT_BUY_COLOR,
    });
  } catch (error: unknown) {
    buying.delete(account.id);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] 购买车辆 ${pending.item.modelId} (${account.name}):${message}`);
    player.sendClientMessage(Color.error, "购买失败.请重试.");
    return;
  }
  buying.delete(account.id);

  if (!result.ok) {
    if (result.reason === "owned") {
      player.sendClientMessage(
        Color.error,
        "你已经有载具.一次只能拥有一辆车."
      );
      return;
    }
    if (result.reason === "funds") {
      player.sendClientMessage(
        Color.error,
        `现金不足.需要 ${formatMoney(pending.item.price)}.`
      );
      return;
    }
    player.sendClientMessage(Color.error, "购买失败.请重试.");
    return;
  }

  setBusinessBalance(pending.businessId, result.balance);

  if (!isPlayerActive(player) || getAccount(player)?.id !== account.id) {
    spawnPersonalVehicle(
      result.vehicle,
      house.vehicleX,
      house.vehicleY,
      house.vehicleZ,
      house.vehicleAngle
    );
    return;
  }

  patchAccount(player, { money: result.cashLeft });
  const live = getAccount(player);
  if (live) {
    applyWallet(player, live);
  }

  const spawned = spawnPersonalVehicle(
    result.vehicle,
    house.vehicleX,
    house.vehicleY,
    house.vehicleZ,
    house.vehicleAngle
  );

  player.sendClientMessage(
    Color.tryOk,
    `你以 ${formatMoney(result.amount)} 购买了 ${pending.item.name}.`
  );
  if (spawned) {
    player.sendClientMessage(Color.info, "载具停在你的房屋旁.");
  } else {
    player.sendClientMessage(
      Color.error,
      "购买已保存,但无法将车辆停在房屋旁.请联系管理员."
    );
  }
}

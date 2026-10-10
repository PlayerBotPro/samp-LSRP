import { Dialog, omp, type Player, type Vehicle } from "@omp-node/core";
import { SERVER_TAG } from "../../shared/brand";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerId } from "../../shared/player";
import {
  applyWallet,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../auth/session";
import {
  getVehicleFuel,
  MAX_VEHICLE_FUEL,
  setVehicleFuel,
  vehicleUsesFuel,
} from "../vehicles/fuel";
import {
  findOwnedPersonalVehicle,
  getPersonalRuntime,
} from "../vehicles/personal";
import {
  updatePlayerVehicleColors,
  updatePlayerVehicleFuel,
  updatePlayerVehicleHealth,
  updatePlayerVehicleNitro,
} from "../vehicles/player-vehicles";
import {
  getBusiness,
  listBusinesses,
  payBusinessCashShare,
  setBusinessBalance,
  type BusinessRecord,
} from "./repository";
import { getInsideBusiness } from "./session";
import { isWorkshopType } from "./types";
import { businessIdFromVirtualWorld, businessVirtualWorld } from "./world";

/** 不要与 family 115-123 重叠. */
export const WORKSHOP_MENU_DIALOG_ID = 144;
export const WORKSHOP_COLOR1_DIALOG_ID = 145;
export const WORKSHOP_COLOR2_DIALOG_ID = 146;

const PICKUP_RADIUS = 1.5;
const TICK_MS = 200;
const PLAYER_STATE_ONFOOT = 1;
const DIALOG_STYLE_TABLIST_HEADERS = 5;
const BIZ_SHARE = 0.8;
const NITRO_COMPONENT = 1010;

const PRICE_REPAIR = 800;
const PRICE_COLOR = 1_500;
const PRICE_NITRO = 5_000;
/** 每缺少一升燃油的价格(与加油站相同). */
const PRICE_FUEL_UNIT = 10;

type PaintColor = { id: number; name: string };

/** GTA SA 喷漆使用的常见颜色. */
const PAINT_COLORS: readonly PaintColor[] = [
  { id: 0, name: "黑色" },
  { id: 1, name: "白色" },
  { id: 3, name: "灰色" },
  { id: 6, name: "黄色" },
  { id: 79, name: "红色" },
  { id: 86, name: "蓝色" },
  { id: 152, name: "绿色" },
  { id: 158, name: "橙色" },
  { id: 166, name: "紫色" },
  { id: 175, name: "粉色" },
  { id: 181, name: "浅蓝色" },
  { id: 189, name: "棕色" },
];

type PendingPaint = {
  businessId: number;
  vehicleRuntimeId: number;
  color1: number;
};

type MenuKind = "repair" | "fuel" | "color" | "nitro";

const standingOn = new Map<number, number>();
const pendingMenu = new Map<number, number>();
const pendingPaint = new Map<number, PendingPaint>();
const busy = new Set<number>();

export function startWorkshopShops(): void {
  setInterval(tickWorkshopShops, TICK_MS);

  omp.on("dialogResponse", (player, dialogId, response, listItem) => {
    const id = Number(dialogId);
    if (id === WORKSHOP_MENU_DIALOG_ID) {
      void onMainMenuResponse(player, Number(response) !== 0, Number(listItem));
      return;
    }
    if (id === WORKSHOP_COLOR1_DIALOG_ID) {
      onColor1Response(player, Number(response) !== 0, Number(listItem));
      return;
    }
    if (id === WORKSHOP_COLOR2_DIALOG_ID) {
      void onColor2Response(player, Number(response) !== 0, Number(listItem));
    }
  });

  omp.on("playerDisconnect", (player) => {
    clearPlayerWorkshop(player);
  });

  const count = listBusinesses().filter(
    (b) => isWorkshopType(b.typeId) && hasBuyPickup(b)
  ).length;
  omp.log(`[${SERVER_TAG}] Auto repair shops: ${count} service points`);
}

function clearPlayerWorkshop(player: Player): void {
  const slotId = playerId(player);
  if (slotId !== null) {
    standingOn.delete(slotId);
    pendingMenu.delete(slotId);
    pendingPaint.delete(slotId);
  }
  const account = getAccount(player);
  if (account) {
    busy.delete(account.id);
  }
}

function hasBuyPickup(business: BusinessRecord): boolean {
  return (
    business.buyPickupX !== null &&
    business.buyPickupY !== null &&
    business.buyPickupZ !== null
  );
}

function tickWorkshopShops(): void {
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
      const shop = findWorkshopBuyPickupAt(
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
      openWorkshopMenu(player, shop);
    } catch {
      standingOn.delete(slotId);
    }
  });
}

function findWorkshopBuyPickupAt(
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
    !isWorkshopType(business.typeId) ||
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

function openWorkshopMenu(player: Player, business: BusinessRecord): void {
  const slotId = playerId(player);
  const account = getAccount(player);
  if (slotId === null || !account) {
    return;
  }

  if (business.isLocked && business.ownerId !== account.id) {
    standingOn.delete(slotId);
    player.sendClientMessage(Color.error, "修理厂已关闭.");
    return;
  }

  const ctx = resolveServiceVehicle(player);
  if (!ctx) {
    standingOn.delete(slotId);
    return;
  }

  const { vehicle } = ctx;
  let health = 1000;
  let fuel = MAX_VEHICLE_FUEL;
  let model = 0;
  let hasNitro = false;
  try {
    health = vehicle.getHealth();
    model = vehicle.getModel();
    fuel = getVehicleFuel(vehicle);
    hasNitro = vehicle.getComponentInSlot(5) === NITRO_COMPONENT;
  } catch {
    // fallback
  }

  const fuelOk = vehicleUsesFuel(model);
  const repairNeed = health < 999.5;
  const fuelNeed = fuelOk && fuel < MAX_VEHICLE_FUEL - 0.05;
  const fuelPrice = fuelNeed
    ? Math.max(1, Math.ceil(MAX_VEHICLE_FUEL - fuel)) * PRICE_FUEL_UNIT
    : 0;

  const rows = [
    "服务\t价格\t状态",
    `喷漆\t${formatMoney(PRICE_COLOR)}\t可用`,
    repairNeed
      ? `维修\t${formatMoney(PRICE_REPAIR)}\tHP ${Math.round(health)}`
      : `维修\t-\t车辆状况良好`,
    fuelOk
      ? fuelNeed
        ? `加油\t${formatMoney(fuelPrice)}\t${Math.round(fuel)}%`
        : `加油\t-\t油箱已满`
      : `加油\t-\t无需加油`,
    hasNitro
      ? `氮气\t-\t已安装`
      : `氮气\t${formatMoney(PRICE_NITRO)}\t未安装`,
  ];

  pendingMenu.set(slotId, business.id);
  pendingPaint.delete(slotId);

  try {
    Dialog.show(
      player,
      WORKSHOP_MENU_DIALOG_ID,
      DIALOG_STYLE_TABLIST_HEADERS,
      `${business.name} - 维修服务`,
      rows.join("\n"),
      "选择",
      "关闭"
    );
  } catch {
    pendingMenu.delete(slotId);
    standingOn.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开维修菜单.");
  }
}

function resolveServiceVehicle(
  player: Player
): { vehicle: Vehicle; personal: NonNullable<ReturnType<typeof getPersonalRuntime>> } | null {
  const account = getAccount(player);
  if (!account) {
    return null;
  }

  const vehicle = findOwnedPersonalVehicle(account.id);
  if (!vehicle) {
    player.sendClientMessage(
      Color.error,
      "请先呼叫你的私人车辆 (/car),然后进入维修站."
    );
    return null;
  }

  try {
    const runtimeId = Number(vehicle.getID());
    if (!Number.isInteger(runtimeId) || runtimeId < 0) {
      return null;
    }

    const personal = getPersonalRuntime(runtimeId);
    if (!personal || personal.ownerId !== account.id) {
      player.sendClientMessage(
        Color.error,
        "维修服务仅适用于你的私人车辆."
      );
      return null;
    }

    return { vehicle, personal };
  } catch {
    return null;
  }
}

async function onMainMenuResponse(
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

  const kinds: MenuKind[] = ["color", "repair", "fuel", "nitro"];
  const kind = kinds[listItem];
  if (!kind) {
    return;
  }

  const business = getBusiness(businessId);
  if (!business || !isWorkshopType(business.typeId)) {
    return;
  }

  if (kind === "color") {
    showColorPicker(player, businessId, 1);
    return;
  }

  await runWorkshopService(player, business, kind);
  // 保留 standingOn 状态以便离开;再次使用服务前需离开拾取点再回来.
}

function showColorPicker(player: Player, businessId: number, step: 1 | 2): void {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  const rows = [
    "颜色\tID",
    ...PAINT_COLORS.map((c) => `${c.name}\t${c.id}`),
  ];

  try {
    Dialog.show(
      player,
      step === 1 ? WORKSHOP_COLOR1_DIALOG_ID : WORKSHOP_COLOR2_DIALOG_ID,
      DIALOG_STYLE_TABLIST_HEADERS,
      step === 1 ? "喷漆 - 主颜色" : "喷漆 - 副颜色",
      rows.join("\n"),
      step === 1 ? "下一步" : "完成",
      "取消"
    );
    if (step === 1) {
      pendingMenu.set(slotId, businessId);
    }
  } catch {
    pendingMenu.delete(slotId);
    pendingPaint.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开颜色选择页面.");
  }
}

function onColor1Response(player: Player, ok: boolean, listItem: number): void {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  const businessId = pendingMenu.get(slotId);
  pendingMenu.delete(slotId);
  if (!ok || businessId === undefined) {
    pendingPaint.delete(slotId);
    return;
  }

  const paint = PAINT_COLORS[listItem];
  if (!paint) {
    return;
  }

  const ctx = resolveServiceVehicle(player);
  if (!ctx) {
    return;
  }

  pendingPaint.set(slotId, {
    businessId,
    vehicleRuntimeId: Number(ctx.vehicle.getID()),
    color1: paint.id,
  });
  showColorPicker(player, businessId, 2);
}

async function onColor2Response(
  player: Player,
  ok: boolean,
  listItem: number
): Promise<void> {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  const pending = pendingPaint.get(slotId);
  pendingPaint.delete(slotId);
  if (!ok || !pending) {
    return;
  }

  const paint = PAINT_COLORS[listItem];
  if (!paint) {
    return;
  }

  const business = getBusiness(pending.businessId);
  if (!business) {
    return;
  }

  await runWorkshopService(player, business, "color", {
    color1: pending.color1,
    color2: paint.id,
    expectedRuntimeId: pending.vehicleRuntimeId,
  });
  // sticky 状态会保留;再次使用服务前需离开拾取点再回来.
}

async function runWorkshopService(
  player: Player,
  business: BusinessRecord,
  kind: MenuKind,
  paint?: { color1: number; color2: number; expectedRuntimeId: number }
): Promise<void> {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  if (busy.has(account.id)) {
    player.sendClientMessage(Color.error, "请等待操作完成.");
    return;
  }

  if (business.isLocked && business.ownerId !== account.id) {
    player.sendClientMessage(Color.error, "修理厂已关闭.");
    return;
  }

  const ctx = resolveServiceVehicle(player);
  if (!ctx) {
    return;
  }

  const { vehicle, personal } = ctx;
  const runtimeId = Number(vehicle.getID());
  if (
    paint &&
    paint.expectedRuntimeId !== runtimeId
  ) {
    player.sendClientMessage(Color.error, "车辆信息已变更.请重新打开维修站.");
    return;
  }

  try {
    const slotId = playerId(player);
    if (slotId === null) {
      return;
    }
    const pos = player.getPos();
    const near = findWorkshopBuyPickupAt(
      pos.x,
      pos.y,
      pos.z,
      player.getInterior(),
      player.getVirtualWorld(),
      slotId
    );
    if (!near || near.id !== business.id) {
      player.sendClientMessage(Color.error, "请靠近维修站.");
      return;
    }
  } catch {
    return;
  }

  let price = 0;
  let model = 0;
  let health = 1000;
  let fuel = MAX_VEHICLE_FUEL;
  let hasNitro = false;
  try {
    model = vehicle.getModel();
    health = vehicle.getHealth();
    fuel = getVehicleFuel(vehicle);
    hasNitro = vehicle.getComponentInSlot(5) === NITRO_COMPONENT;
  } catch {
    player.sendClientMessage(Color.error, "车辆不可用.");
    return;
  }

  if (kind === "repair") {
    if (health >= 999.5) {
      player.sendClientMessage(Color.error, "车辆已经修好.");
      return;
    }
    price = PRICE_REPAIR;
  } else if (kind === "fuel") {
    if (!vehicleUsesFuel(model)) {
      player.sendClientMessage(Color.error, "这辆车无需加油.");
      return;
    }
    if (fuel >= MAX_VEHICLE_FUEL - 0.05) {
      player.sendClientMessage(Color.error, "油箱已经加满.");
      return;
    }
    price = Math.max(1, Math.ceil(MAX_VEHICLE_FUEL - fuel)) * PRICE_FUEL_UNIT;
  } else if (kind === "nitro") {
    if (hasNitro) {
      player.sendClientMessage(Color.error, "已经安装了氮气.");
      return;
    }
    price = PRICE_NITRO;
  } else if (kind === "color") {
    if (!paint) {
      return;
    }
    price = PRICE_COLOR;
  } else {
    return;
  }

  if (account.money < price) {
    player.sendClientMessage(
      Color.error,
      `现金不足.需要 ${formatMoney(price)}.`
    );
    return;
  }

  busy.add(account.id);
  try {
    const result = await payBusinessCashShare(
      business.id,
      account.id,
      price,
      BIZ_SHARE
    );
    if (!result.ok) {
      if (result.reason === "funds") {
        player.sendClientMessage(Color.error, "现金不足.");
      } else {
        player.sendClientMessage(Color.error, "付款失败.");
      }
      return;
    }

    const stillHere =
      isPlayerActive(player) && getAccount(player)?.id === account.id;

    if (stillHere) {
      // await 期间玩家可能已离开拾取点;服务仍然生效(费用已支付).
      patchAccount(player, { money: result.cashLeft });
      setBusinessBalance(business.id, result.balance);
      const live = getAccount(player);
      if (live) {
        applyWallet(player, live);
      }
    } else {
      setBusinessBalance(business.id, result.balance);
    }

    const liveVehicle = omp.vehicles.at(runtimeId) ?? null;
    if (!liveVehicle) {
      await persistWorkshopUpgrade(kind, personal.dbId, paint);
      if (stillHere) {
        player.sendClientMessage(
          Color.info,
          "付款已完成并保存.请通过 /car 更新车辆."
        );
      }
      return;
    }

    try {
      if (kind === "repair") {
        liveVehicle.repair();
        liveVehicle.setHealth(1000);
        await updatePlayerVehicleHealth(personal.dbId, 1000);
      } else if (kind === "fuel") {
        setVehicleFuel(liveVehicle, MAX_VEHICLE_FUEL);
        await updatePlayerVehicleFuel(personal.dbId, MAX_VEHICLE_FUEL);
      } else if (kind === "nitro") {
        liveVehicle.addComponent(NITRO_COMPONENT);
        await updatePlayerVehicleNitro(personal.dbId, true);
      } else if (kind === "color" && paint) {
        liveVehicle.changeColor(paint.color1, paint.color2);
        await updatePlayerVehicleColors(personal.dbId, paint.color1, paint.color2);
      }
    } catch {
      await persistWorkshopUpgrade(kind, personal.dbId, paint);
      if (stillHere) {
        player.sendClientMessage(
          Color.info,
          "付款已完成并保存.请通过 /car 更新车辆."
        );
      }
      return;
    }

    if (!stillHere) {
      return;
    }

    const labels: Record<MenuKind, string> = {
      repair: "维修完成",
      fuel: "加油完成",
      nitro: "氮气已安装",
      color: "颜色已更新",
    };
    player.sendClientMessage(
      Color.info,
      `${labels[kind]},花费 ${formatMoney(price)}. 已保存至车库.`
    );
  } finally {
    busy.delete(account.id);
  }
}

async function persistWorkshopUpgrade(
  kind: MenuKind,
  dbId: number,
  paint?: { color1: number; color2: number }
): Promise<void> {
  try {
    if (kind === "repair") {
      await updatePlayerVehicleHealth(dbId, 1000);
    } else if (kind === "fuel") {
      await updatePlayerVehicleFuel(dbId, MAX_VEHICLE_FUEL);
    } else if (kind === "nitro") {
      await updatePlayerVehicleNitro(dbId, true);
    } else if (kind === "color" && paint) {
      await updatePlayerVehicleColors(dbId, paint.color1, paint.color2);
    }
  } catch {
    // 下次使用 /car 时会加载数据;玩家已支付费用.
  }
}

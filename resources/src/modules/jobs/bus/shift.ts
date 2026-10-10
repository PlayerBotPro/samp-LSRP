import {
  Checkpoint,
  Dialog,
  INVALID_VEHICLE_ID,
  RaceCheckpoint,
  omp,
  TextLabel,
  type Player,
  type Vehicle,
} from "@omp-node/core";
import { Color } from "../../../shared/colors";
import { formatMoney } from "../../../shared/money";
import { sendNearby } from "../../../shared/nearby";
import { isPlayerActive, playerId } from "../../../shared/player";
import { saveUserMoney, transferUserCash } from "../../auth/repository";
import {
  applyWallet,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../../auth/session";
import { STREET_WORLD } from "../../spawn/point";
import { setVehicleEngine } from "../../vehicles/spawn";
import { JOB_BUS_DRIVER } from "../catalog";
import { isBusDriverOnShift, setBusDriverShiftActive } from "./active";
import { BUS_ROUTES, type BusRoute } from "./route";
import { busSpawnSpot, isBusJobVehicle } from "./vehicles";

export { isBusDriverOnShift } from "./active";

export const BUS_CONFIRM_DIALOG_ID = 151;
export const BUS_FARE_DIALOG_ID = 152;
export const BUS_ROUTE_DIALOG_ID = 153;

const DIALOG_STYLE_MSGBOX = 0;
const DIALOG_STYLE_INPUT = 1;
const DIALOG_STYLE_LIST = 2;
const PLAYER_STATE_DRIVER = 2;
const PLAYER_STATE_PASSENGER = 3;
const RACE_CP_RADIUS = 8;
const RACE_CP_NORMAL = 0;
const RACE_CP_FINISH = 1;
const CP_VERIFY_RANGE = 16;
const STOP_SEC = 15;
const STOP_ANNOUNCE_RADIUS = 15;
/** 用于站点提示的深绿色. */
const BUS_STOP_CHAT = 0x2e8b57ff;
const RETURN_SEC = 30;
/** 到达终点后先让乘客下车,再重生公交车. */
const FINISH_RESPAWN_DELAY_MS = 2000;
const PAY_PER_CHECKPOINT = 80;
const MIN_FARE = 1;
const MAX_FARE = 2000;
const MAX_CASH = 2_147_483_647;
const LABEL_OFFSET_Z = 2.6;
const LABEL_DRAW_DISTANCE = 45;
const ANIM_SYNC_ALL = 1;

type PendingSetup = {
  vehicleId: number;
  accountId: number;
  fare?: number;
};

type BusShift = {
  playerSlot: number;
  accountId: number;
  vehicleId: number;
  spawn: { x: number; y: number; z: number; angle: number };
  fare: number;
  route: BusRoute;
  pointIndex: number;
  earned: number;
  label: TextLabel;
  phase: "drive" | "stop" | "away";
  stopTimer: ReturnType<typeof setTimeout> | null;
  awayTimer: ReturnType<typeof setTimeout> | null;
  frozen: boolean;
};

const pendingSetup = new Map<number, PendingSetup>();
const shiftsByPlayer = new Map<number, BusShift>();
const shiftsByVehicle = new Map<number, number>();
const fareBusy = new Set<number>();

export function bindBusShifts(): void {
  omp.on("playerStateChange", (player, newState, oldState) => {
    if (newState === PLAYER_STATE_DRIVER) {
      onBecameDriver(player);
      return;
    }

    if (oldState === PLAYER_STATE_DRIVER && newState !== PLAYER_STATE_DRIVER) {
      clearPending(player);
      if (isBusDriverOnShift(player)) {
        onLeftBusDuringShift(player);
      }
      return;
    }

    if (newState === PLAYER_STATE_PASSENGER) {
      void chargePassengerFare(player);
    }
  });

  omp.on("playerEnterRaceCheckpoint", (player) => {
    if (!isBusDriverOnShift(player)) {
      return;
    }
    onRouteCheckpoint(player);
  });

  omp.on("dialogResponse", (player, dialogId, response, _listItem, inputText) => {
    const id = Number(dialogId);
    const ok = Number(response) !== 0;
    if (id === BUS_CONFIRM_DIALOG_ID) {
      onConfirmDialog(player, ok);
      return;
    }
    if (id === BUS_FARE_DIALOG_ID) {
      onFareDialog(player, ok, String(inputText ?? ""));
      return;
    }
    if (id === BUS_ROUTE_DIALOG_ID) {
      onRouteDialog(player, ok, Number(_listItem));
    }
  });

  omp.on("playerDisconnect", (player) => {
    clearPending(player);
    if (isBusDriverOnShift(player)) {
      cancelShift(player, null);
    }
    const id = playerId(player);
    if (id !== null) {
      fareBusy.delete(id);
    }
  });

  omp.on("vehicleDeath", (vehicle) => {
    endShiftForVehicle(vehicle, "班次已中止:公交车被摧毁.");
  });

  // 班次期间公交车重生为空车,视为线路中断.
  omp.on("vehicleSpawn", (vehicle) => {
    const vehicleId = liveVehicleId(vehicle);
    if (vehicleId === null || !shiftsByVehicle.has(vehicleId)) {
      return;
    }
    endShiftForVehicle(vehicle, "班次已中止:公交车已重生.");
  });
}

function onBecameDriver(player: Player): void {
  if (!isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  if (!account || account.jobId !== JOB_BUS_DRIVER) {
    return;
  }

  const vehicle = driverBus(player);
  if (!vehicle || !isBusJobVehicle(vehicle)) {
    return;
  }

  const vehicleId = liveVehicleId(vehicle);
  const slot = playerId(player);
  if (vehicleId === null || slot === null) {
    return;
  }

  const existing = shiftsByPlayer.get(slot);
  if (existing) {
    if (existing.vehicleId !== vehicleId) {
      cancelShift(player, "班次已中止:你乘坐了其他车辆.");
      return;
    }

    if (existing.phase === "away") {
      resumeAfterReturn(player, existing);
    }
    return;
  }

  const ownerSlot = shiftsByVehicle.get(vehicleId);
  if (ownerSlot !== undefined && ownerSlot !== slot) {
    tell(player, Color.error, "这辆公交车已经在执行线路.");
    eject(player);
    return;
  }

  pendingSetup.set(slot, { vehicleId, accountId: account.id });
  try {
    Dialog.show(
      player,
      BUS_CONFIRM_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "{FFCC00}公交车司机",
      "{FFFFFF}开始线路工作吗?",
      "是",
      "否"
    );
  } catch {
    pendingSetup.delete(slot);
  }
}

function resumeAfterReturn(player: Player, shift: BusShift): void {
  if (shift.awayTimer) {
    clearTimeout(shift.awayTimer);
    shift.awayTimer = null;
  }

  if (shift.pointIndex >= shift.route.points.length) {
    completeShift(player, shift);
    return;
  }

  shift.phase = "drive";
  setRouteCheckpoint(player, shift);
  tell(player, Color.info, "你已回到公交车上,请继续行驶.");
}

function onLeftBusDuringShift(player: Player): void {
  const slot = playerId(player);
  if (slot === null) {
    return;
  }

  const shift = shiftsByPlayer.get(slot);
  if (!shift || shift.phase === "away") {
    return;
  }

  // 如果玩家在停站期间下车,则解除站点冻结状态.
  if (shift.frozen) {
    setFrozen(player, false);
    shift.frozen = false;
  }

  if (shift.phase === "stop") {
    if (shift.stopTimer) {
      clearTimeout(shift.stopTimer);
      shift.stopTimer = null;
    }
    // 该站已计入路线;玩家返回后继续前往下一站.
    shift.pointIndex += 1;
  }

  const vehicle = omp.vehicles.at(shift.vehicleId) ?? null;
  if (vehicle) {
    setVehicleEngine(vehicle, false, false);
  }

  shift.phase = "away";
  if (shift.awayTimer) {
    clearTimeout(shift.awayTimer);
  }

  tell(
    player,
    Color.error,
    `你已离开公交车.请在 ${RETURN_SEC} 秒内回到驾驶座,否则班次将结束且不会获得检查点报酬.`
  );

  shift.awayTimer = setTimeout(() => {
    shift.awayTimer = null;
    if (!shiftsByPlayer.has(slot)) {
      return;
    }
    const live = omp.players.at(slot);
    const current = shiftsByPlayer.get(slot);
    if (!live || !isPlayerActive(live) || !current || current !== shift) {
      return;
    }
    if (current.phase !== "away") {
      return;
    }
    // 确认玩家尚未回到驾驶座(槽位可能已被复用).
    try {
      if (
        live.getState() === PLAYER_STATE_DRIVER &&
        live.getVehicleID() === shift.vehicleId
      ) {
        return;
      }
    } catch {
      // 按照"不在公交车内"处理.
    }
    cancelShift(
      live,
      "班次已结束:你没有回到公交车上,未获得检查点报酬."
    );
  }, RETURN_SEC * 1000);
}

function rejectSetup(player: Player, message: string): void {
  clearPending(player);
  tell(player, Color.info, message);
  eject(player);
}

function onConfirmDialog(player: Player, ok: boolean): void {
  const slot = playerId(player);
  if (slot === null) {
    return;
  }

  const pending = pendingSetup.get(slot);
  if (!pending) {
    return;
  }

  if (!ok) {
    rejectSetup(player, "你已取消班次.");
    return;
  }

  if (!stillInPendingBus(player, pending)) {
    rejectSetup(player, "请坐上工作公交车的驾驶座.");
    return;
  }

  try {
    Dialog.show(
      player,
      BUS_FARE_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "{FFCC00}车票价格",
      `{FFFFFF}请输入车票价格(${MIN_FARE} 至 ${MAX_FARE}$):`,
      "下一步",
      "取消"
    );
  } catch {
    rejectSetup(player, "无法开始班次.");
  }
}

function onFareDialog(player: Player, ok: boolean, input: string): void {
  const slot = playerId(player);
  if (slot === null) {
    return;
  }

  const pending = pendingSetup.get(slot);
  if (!pending) {
    return;
  }

  if (!ok) {
    rejectSetup(player, "班次已取消.");
    return;
  }

  if (!stillInPendingBus(player, pending)) {
    rejectSetup(player, "请坐上工作公交车的驾驶座.");
    return;
  }

  const fare = Math.floor(Number(String(input).replace(/^\$/, "").trim()));
  if (!Number.isInteger(fare) || fare < MIN_FARE || fare > MAX_FARE) {
    tell(player, Color.error, `车票价格必须为 ${MIN_FARE}-${MAX_FARE}$.`);
    try {
      Dialog.show(
        player,
        BUS_FARE_DIALOG_ID,
        DIALOG_STYLE_INPUT,
        "{FFCC00}车票价格",
        `{FFFFFF}请输入车票价格(${MIN_FARE} 至 ${MAX_FARE}$):`,
        "下一步",
        "取消"
      );
    } catch {
      rejectSetup(player, "班次已取消.");
    }
    return;
  }

  pending.fare = fare;
  const body = BUS_ROUTES.map((route) => route.name).join("\n");
  try {
    Dialog.show(
      player,
      BUS_ROUTE_DIALOG_ID,
      DIALOG_STYLE_LIST,
      "{FFCC00}选择线路",
      body,
      "开始",
      "取消"
    );
  } catch {
    rejectSetup(player, "班次已取消.");
  }
}

function onRouteDialog(player: Player, ok: boolean, listItem: number): void {
  const slot = playerId(player);
  if (slot === null) {
    return;
  }

  const pending = pendingSetup.get(slot);
  if (!pending) {
    return;
  }

  if (!ok) {
    rejectSetup(player, "班次已取消.");
    return;
  }

  if (!stillInPendingBus(player, pending)) {
    rejectSetup(player, "请坐上工作公交车的驾驶座.");
    return;
  }

  const route = BUS_ROUTES[listItem] ?? null;
  if (!route || pending.fare === undefined) {
    rejectSetup(player, "无法选择线路.");
    return;
  }

  const vehicle = driverBus(player);
  if (!vehicle) {
    rejectSetup(player, "请坐上工作公交车的驾驶座.");
    return;
  }

  const spot = busSpawnSpot(vehicle);
  if (!spot) {
    rejectSetup(player, "无法开始班次.");
    return;
  }

  if (shiftsByVehicle.has(pending.vehicleId)) {
    rejectSetup(player, "这辆公交车已经在执行线路.");
    return;
  }

  let label: TextLabel;
  try {
    const pos = vehicle.getPos();
    label = new TextLabel(
      labelText(route.name, pending.fare),
      Color.white,
      pos.x,
      pos.y,
      pos.z + LABEL_OFFSET_Z,
      LABEL_DRAW_DISTANCE,
      STREET_WORLD,
      false
    );
    label.attachToVehicle(vehicle, 0, 0, LABEL_OFFSET_Z);
  } catch {
    rejectSetup(player, "无法开始班次.");
    return;
  }

  const shift: BusShift = {
    playerSlot: slot,
    accountId: pending.accountId,
    vehicleId: pending.vehicleId,
    spawn: spot,
    fare: pending.fare,
    route,
    pointIndex: 0,
    earned: 0,
    label,
    phase: "drive",
    stopTimer: null,
    awayTimer: null,
    frozen: false,
  };

  pendingSetup.delete(slot);
  shiftsByPlayer.set(slot, shift);
  shiftsByVehicle.set(pending.vehicleId, slot);
  setBusDriverShiftActive(slot, true);

  setRouteCheckpoint(player, shift);
  tell(
    player,
    Color.info,
    `线路[${route.name}].车票价格:${formatMoney(pending.fare)}.请沿检查点行驶.`
  );
}

function onRouteCheckpoint(player: Player): void {
  const slot = playerId(player);
  if (slot === null) {
    return;
  }

  const shift = shiftsByPlayer.get(slot);
  if (!shift || shift.phase !== "drive") {
    return;
  }

  const vehicle = driverBus(player);
  if (!vehicle || liveVehicleId(vehicle) !== shift.vehicleId) {
    return;
  }

  const point = shift.route.points[shift.pointIndex];
  if (!point) {
    return;
  }

  try {
    const pos = vehicle.getPos();
    if (
      Math.hypot(pos.x - point.x, pos.y - point.y, pos.z - point.z) >
      CP_VERIFY_RANGE
    ) {
      return;
    }
  } catch {
    return;
  }

  shift.earned += PAY_PER_CHECKPOINT;

  if (point.kind === "finish") {
    completeShift(player, shift);
    return;
  }

  if (point.kind === "stop") {
    beginStop(player, shift, vehicle);
    return;
  }

  shift.pointIndex += 1;
  if (shift.pointIndex >= shift.route.points.length) {
    completeShift(player, shift);
    return;
  }

  setRouteCheckpoint(player, shift);
}

function beginStop(player: Player, shift: BusShift, vehicle: Vehicle): void {
  shift.phase = "stop";

  // 停车期间不要设置 RaceCP,否则解除冻结后可能再次触发 Enter.
  clearRouteCheckpoint(player);
  setVehicleEngine(vehicle, false, false);
  setFrozen(player, true);
  shift.frozen = true;

  sendNearby(
    player,
    STOP_ANNOUNCE_RADIUS,
    BUS_STOP_CHAT,
    `线路 ${shift.route.name} 的公交车将在 ${STOP_SEC} 秒后发车.`
  );
  tell(player, Color.info, `已到站,将于 ${STOP_SEC} 秒后发车.`);

  if (shift.stopTimer) {
    clearTimeout(shift.stopTimer);
  }

  shift.stopTimer = setTimeout(() => {
    shift.stopTimer = null;
    if (!shiftsByPlayer.has(shift.playerSlot)) {
      return;
    }

    const live = omp.players.at(shift.playerSlot);
    if (!live || !isPlayerActive(live) || !isBusDriverOnShift(live)) {
      return;
    }

    const current = shiftsByPlayer.get(shift.playerSlot);
    if (!current || current !== shift || current.phase !== "stop") {
      return;
    }

    finishStop(live, shift);
  }, STOP_SEC * 1000);
}

/** 先推进线路和检查点,再解除冻结,避免重复计入站点. */
function finishStop(player: Player, shift: BusShift): void {
  const bus = omp.vehicles.at(shift.vehicleId) ?? null;

  shift.pointIndex += 1;
  if (shift.pointIndex >= shift.route.points.length) {
    if (shift.frozen) {
      setFrozen(player, false);
      shift.frozen = false;
    }
    completeShift(player, shift);
    return;
  }

  shift.phase = "drive";
  setRouteCheckpoint(player, shift);

  if (shift.frozen) {
    setFrozen(player, false);
    shift.frozen = false;
  }
  if (bus) {
    setVehicleEngine(bus, true, false);
  }

  tell(player, Color.info, "公交车已发车,请前往下一个检查点.");
}

function completeShift(player: Player, shift: BusShift): void {
  const payout = Math.max(0, Math.floor(shift.earned));
  const vehicle = omp.vehicles.at(shift.vehicleId) ?? null;
  const spawn = shift.spawn;
  const vehicleId = shift.vehicleId;

  if (shift.frozen) {
    setFrozen(player, false);
    shift.frozen = false;
  }

  clearShiftState(shift, true);
  clearRouteCheckpoint(player);

  // 先让乘客下车,稍后再将公交车送回停车位.
  if (vehicle) {
    ejectAllFromBus(vehicle);
    setVehicleEngine(vehicle, false, false);
    setTimeout(() => {
      const live = omp.vehicles.at(vehicleId);
      if (!live) {
        return;
      }
      respawnBus(live, spawn);
    }, FINISH_RESPAWN_DELAY_MS);
  }

  if (payout > 0) {
    const account = getAccount(player);
    if (account && account.id === shift.accountId) {
      const cash = Math.max(0, Math.floor(account.money));
      const credited = Math.min(payout, Math.max(0, MAX_CASH - cash));
      if (credited > 0) {
        const next = cash + credited;
        patchAccount(player, { money: next });
        applyWallet(player, getAccount(player) ?? { ...account, money: next });
        void saveUserMoney(account.id, next, Math.max(0, Math.floor(account.bank))).catch(
          () => {
            // 后续定时持久化会保存此更改.
          }
        );
      }
      tell(
        player,
        Color.info,
        `线路已完成.本班次收入:${formatMoney(credited)}.`
      );
      return;
    }
  }

  tell(player, Color.info, "线路已完成.");
}

function cancelShift(player: Player, message: string | null): void {
  const slot = playerId(player);
  if (slot === null) {
    return;
  }

  const shift = shiftsByPlayer.get(slot);
  if (!shift) {
    return;
  }

  if (shift.frozen) {
    setFrozen(player, false);
    shift.frozen = false;
  }

  const vehicle = omp.vehicles.at(shift.vehicleId) ?? null;
  clearShiftState(shift, true);
  clearRouteCheckpoint(player);

  if (vehicle) {
    respawnBus(vehicle, shift.spawn);
  }

  if (message) {
    tell(player, Color.error, message);
  }
}

function endShiftForVehicle(vehicle: Vehicle, message: string): void {
  const vehicleId = liveVehicleId(vehicle);
  if (vehicleId === null) {
    return;
  }

  const slot = shiftsByVehicle.get(vehicleId);
  if (slot === undefined) {
    return;
  }

  const player = omp.players.at(slot);
  if (player && isPlayerActive(player)) {
    cancelShift(player, message);
    return;
  }

  const shift = shiftsByPlayer.get(slot);
  if (!shift) {
    return;
  }

  const spawn = shift.spawn;
  clearShiftState(shift, true);
  respawnBus(vehicle, spawn);
}

function clearShiftState(shift: BusShift, destroyLabel: boolean): void {
  if (shift.stopTimer) {
    clearTimeout(shift.stopTimer);
    shift.stopTimer = null;
  }
  if (shift.awayTimer) {
    clearTimeout(shift.awayTimer);
    shift.awayTimer = null;
  }

  shiftsByPlayer.delete(shift.playerSlot);
  setBusDriverShiftActive(shift.playerSlot, false);
  if (shiftsByVehicle.get(shift.vehicleId) === shift.playerSlot) {
    shiftsByVehicle.delete(shift.vehicleId);
  }

  if (destroyLabel) {
    try {
      shift.label.destroy();
    } catch {
      // 已销毁.
    }
  }
}

function setRouteCheckpoint(player: Player, shift: BusShift): void {
  const point = shift.route.points[shift.pointIndex];
  if (!point) {
    return;
  }

  const last = shift.pointIndex >= shift.route.points.length - 1;
  const next = last
    ? point
    : shift.route.points[shift.pointIndex + 1] ?? point;

  try {
    Checkpoint.disable(player);
  } catch {
    // -
  }

  try {
    RaceCheckpoint.set(
      player,
      last || point.kind === "finish" ? RACE_CP_FINISH : RACE_CP_NORMAL,
      point.x,
      point.y,
      point.z,
      next.x,
      next.y,
      next.z,
      RACE_CP_RADIUS
    );
  } catch {
    // 槽位为空.
  }
}

function clearRouteCheckpoint(player: Player): void {
  try {
    RaceCheckpoint.disable(player);
  } catch {
    // -
  }
  try {
    Checkpoint.disable(player);
  } catch {
    // -
  }
}

function setFrozen(player: Player, frozen: boolean): void {
  try {
    player.toggleControllable(!frozen);
  } catch {
    // 槽位为空.
  }
}

function ejectAllFromBus(vehicle: Vehicle): void {
  let vehicleId: number | null = null;
  try {
    vehicleId = liveVehicleId(vehicle);
  } catch {
    vehicleId = null;
  }
  if (vehicleId === null) {
    return;
  }

  omp.players.forEach((other) => {
    try {
      if (
        !isPlayerActive(other) ||
        !other.isInAnyVehicle() ||
        other.getVehicleID() !== vehicleId
      ) {
        return;
      }
      try {
        other.toggleControllable(true);
      } catch {
        // -
      }
      other.removeFromVehicle();
    } catch {
      // -
    }
  });
}

function respawnBus(
  vehicle: Vehicle,
  spawn: { x: number; y: number; z: number; angle: number }
): void {
  ejectAllFromBus(vehicle);

  try {
    vehicle.setPos(spawn.x, spawn.y, spawn.z);
    vehicle.setZAngle(spawn.angle);
    vehicle.setHealth(1000);
    vehicle.setVirtualWorld(STREET_WORLD);
    setVehicleEngine(vehicle, false, false);
  } catch {
    // 车辆已销毁.
  }
}

async function chargePassengerFare(player: Player): Promise<void> {
  const slot = playerId(player);
  if (slot === null || fareBusy.has(slot)) {
    return;
  }

  let vehicle: Vehicle | null = null;
  try {
    if (player.getState() !== PLAYER_STATE_PASSENGER) {
      return;
    }
    vehicle = omp.vehicles.at(player.getVehicleID()) ?? null;
  } catch {
    return;
  }

  if (!vehicle || !isBusJobVehicle(vehicle)) {
    return;
  }

  const vehicleId = liveVehicleId(vehicle);
  if (vehicleId === null) {
    return;
  }

  const driverSlot = shiftsByVehicle.get(vehicleId);
  if (driverSlot === undefined) {
    return;
  }

  const shift = shiftsByPlayer.get(driverSlot);
  // 司机离开公交车期间,不收取车费.
  if (!shift || shift.fare <= 0 || shift.phase === "away") {
    return;
  }

  const driver = omp.players.at(driverSlot);
  if (!driver || !isPlayerActive(driver) || !getAccount(driver)) {
    return;
  }

  if (playerId(player) === driverSlot) {
    return;
  }

  const passenger = getAccount(player);
  const driverAccount = getAccount(driver);
  if (!passenger || !driverAccount) {
    return;
  }

  if (passenger.money < shift.fare) {
    tell(player, Color.error, `车票价格为 ${formatMoney(shift.fare)}.`);
    eject(player);
    return;
  }

  if (driverAccount.money > MAX_CASH - shift.fare) {
    tell(player, Color.error, "司机目前无法收取车费.");
    eject(player);
    return;
  }

  fareBusy.add(slot);
  try {
    const ok = await transferUserCash(passenger.id, driverAccount.id, shift.fare);
    if (!ok) {
      tell(player, Color.error, "现金不足,无法支付车费.");
      eject(player);
      return;
    }

    if (isPlayerActive(player) && getAccount(player)?.id === passenger.id) {
      applyCashDelta(player, -shift.fare);
    }
    if (isPlayerActive(driver) && getAccount(driver)?.id === driverAccount.id) {
      applyCashDelta(driver, shift.fare);
      tell(
        driver,
        Color.info,
        `已收取车费:${formatMoney(shift.fare)}.`
      );
    }
    tell(player, Color.info, `你已支付车费:${formatMoney(shift.fare)}.`);
  } catch {
    tell(player, Color.error, "无法支付车费.");
    eject(player);
  } finally {
    fareBusy.delete(slot);
  }
}

function applyCashDelta(player: Player, delta: number): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }
  const next = Math.max(0, Math.min(MAX_CASH, Math.floor(account.money + delta)));
  patchAccount(player, { money: next });
  applyWallet(player, getAccount(player) ?? { ...account, money: next });
}

function stillInPendingBus(player: Player, pending: PendingSetup): boolean {
  const account = getAccount(player);
  if (!account || account.id !== pending.accountId) {
    return false;
  }
  const vehicle = driverBus(player);
  return !!vehicle && liveVehicleId(vehicle) === pending.vehicleId;
}

function driverBus(player: Player): Vehicle | null {
  try {
    if (player.getState() !== PLAYER_STATE_DRIVER) {
      return null;
    }
    return omp.vehicles.at(player.getVehicleID()) ?? null;
  } catch {
    return null;
  }
}

function liveVehicleId(vehicle: Vehicle): number | null {
  try {
    const id = vehicle.getID();
    if (id === null || id === undefined || id === INVALID_VEHICLE_ID) {
      return null;
    }
    const numeric = Number(id);
    return Number.isInteger(numeric) ? numeric : null;
  } catch {
    return null;
  }
}

function labelText(routeName: string, fare: number): string {
  return `{33CCFF}${routeName}\n{FFFFFF}车费:{66CC00}${formatMoney(fare)}`;
}

function clearPending(player: Player): void {
  const slot = playerId(player);
  if (slot !== null) {
    pendingSetup.delete(slot);
  }
}

function eject(player: Player): void {
  try {
    player.clearAnimations(ANIM_SYNC_ALL);
    player.removeFromVehicle();
  } catch {
    // 玩家已经下车.
  }
}

function tell(player: Player, color: number, text: string): void {
  try {
    if (!isPlayerActive(player)) {
      return;
    }
    player.sendClientMessage(color, text);
  } catch {
    // 槽位为空.
  }
}

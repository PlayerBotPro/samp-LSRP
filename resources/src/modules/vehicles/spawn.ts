import { Vehicle, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isAuthenticated } from "../auth/session";
import { STREET_WORLD } from "../spawn/point";
import { attachLightBar } from "./light-bar";

const PLAYER_STATE_DRIVER = 2;
/** Left Ctrl. KEY_ACTION = 1. */
const KEY_ACTION = 1;
/** 鼠标左键.KEY_FIRE = 4.在 Pawn 中此键用于车灯. */
const KEY_FIRE = 4;
const PARAM_ON = 1;
const PARAM_OFF = 0;
const LIGHTS_SOUND_ID = 4604;

export type ServerVehicleDef = {
  model: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  color1: number;
  color2: number;
  respawnSec: number;
  world?: number;
  siren?: boolean;
  lightBar?: boolean;
};

/** 手动控制服务器上所有车辆的发动机. */
export function startEngineControl(): void {
  try {
    Vehicle.useManualEngineAndLights();
  } catch {
    // 核心已处于手动模式.
  }

  for (const vehicle of omp.vehicles.all()) {
    setEngine(vehicle, false, false);
  }

  omp.on("vehicleSpawn", (vehicle) => {
    setEngine(vehicle, false, false);
  });

  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    const pressed = newKeys & ~oldKeys;
    if ((pressed & KEY_ACTION) !== 0) {
      toggleEngine(player);
    }

    if ((pressed & KEY_FIRE) !== 0) {
      toggleLights(player);
    }
  });
}

/** 车辆的唯一生成入口:置于游戏世界中,发动机关闭. */
export function createServerVehicle(def: ServerVehicleDef): Vehicle | null {
  let vehicle: Vehicle;
  try {
    vehicle = new Vehicle(
      def.model,
      def.x,
      def.y,
      def.z,
      def.angle,
      def.color1,
      def.color2,
      def.respawnSec,
      def.siren ?? false
    );
  } catch {
    return null;
  }

  try {
    vehicle.setVirtualWorld(def.world ?? STREET_WORLD);
    setEngine(vehicle, false, false);
  } catch {
    // 车辆已在游戏世界中,参数会在 vehicleSpawn 时同步.
  }

  if (def.lightBar) {
    attachLightBar(vehicle);
  }

  return vehicle;
}

/** 对外提供的发动机设置接口(可选设置车灯). */
export function setVehicleEngine(
  vehicle: Vehicle,
  on: boolean,
  lights?: boolean
): void {
  setEngine(vehicle, on, lights);
}

type EngineStartBlocker = (player: Player, vehicle: Vehicle) => string | null;

let engineStartBlocker: EngineStartBlocker | null = null;

/** 阻止发动机启动(例如油箱已空). */
export function setEngineStartBlocker(
  blocker: EngineStartBlocker | null
): void {
  engineStartBlocker = blocker;
}

function setEngine(vehicle: Vehicle, on: boolean, lights?: boolean): void {
  try {
    const params = vehicle.getParamsEx();
    vehicle.setParamsEx(
      on ? PARAM_ON : PARAM_OFF,
      lights === undefined ? asParam(params.lights) : lights ? PARAM_ON : PARAM_OFF,
      asParam(params.alarm),
      asParam(params.doors),
      asParam(params.bonnet),
      asParam(params.boot),
      asParam(params.objective)
    );
  } catch {
    // 车辆已被销毁.
  }
}

function setLights(vehicle: Vehicle, on: boolean): void {
  try {
    const params = vehicle.getParamsEx();
    vehicle.setParamsEx(
      asParam(params.engine),
      on ? PARAM_ON : PARAM_OFF,
      asParam(params.alarm),
      asParam(params.doors),
      asParam(params.bonnet),
      asParam(params.boot),
      asParam(params.objective)
    );
  } catch {
    // 车辆已被销毁.
  }
}

function driverVehicle(player: Player): Vehicle | null {
  if (!isAuthenticated(player)) {
    return null;
  }

  try {
    if (player.getState() !== PLAYER_STATE_DRIVER) {
      return null;
    }

    return omp.vehicles.at(player.getVehicleID()) ?? null;
  } catch {
    return null;
  }
}

function toggleEngine(player: Player): void {
  const vehicle = driverVehicle(player);
  if (!vehicle) {
    return;
  }

  const running = isEngineOn(vehicle);
  if (!running) {
    const deny = engineStartBlocker?.(player, vehicle);
    if (deny) {
      try {
        player.sendClientMessage(Color.error, deny);
      } catch {
        // 已退出.
      }
      return;
    }
  }

  setEngine(vehicle, !running, !running);
  try {
    player.sendClientMessage(
      Color.info,
      running ? "引擎已关闭." : "引擎已启动."
    );
  } catch {
    // 玩家已退出.
  }
}

function toggleLights(player: Player): void {
  const vehicle = driverVehicle(player);
  if (!vehicle) {
    return;
  }

  const on = isLightsOn(vehicle);
  setLights(vehicle, !on);
  playToggleSound(player);
}

function playToggleSound(player: Player): void {
  try {
    const pos = player.getPos();
    player.playGameSound(LIGHTS_SOUND_ID, pos.x, pos.y, pos.z);
  } catch {
    try {
      player.playGameSound(LIGHTS_SOUND_ID, 0, 0, 0);
    } catch {
      // 槽位为空.
    }
  }
}

export function isEngineOn(vehicle: Vehicle): boolean {
  try {
    return vehicle.getParamsEx().engine === PARAM_ON;
  } catch {
    return false;
  }
}

export function isLightsOn(vehicle: Vehicle): boolean {
  try {
    return vehicle.getParamsEx().lights === PARAM_ON;
  } catch {
    return false;
  }
}

function asParam(value: number): number {
  return value === PARAM_ON ? PARAM_ON : PARAM_OFF;
}

import {
  INVALID_VEHICLE_ID,
  omp,
  type Player,
  type Vehicle,
} from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { getPool } from "../../shared/database";
import type { RowDataPacket } from "mysql2/promise";
import { STREET_WORLD } from "../spawn/point";
import {
  findOwnedPlayerVehicle,
  updatePlayerVehicleFuel,
  updatePlayerVehicleHealth,
  updatePlayerVehicleLock,
  type PlayerVehicleRecord,
} from "./player-vehicles";
import { clearVehicleFuel, getVehicleFuel, setVehicleFuel } from "./fuel";
import { createServerVehicle } from "./spawn";

const PERSONAL_RESPAWN_SEC = 999_999;
const ANIM_SYNC_ALL = 1;
const DOORS_LOCKED = 1;
const DOORS_UNLOCKED = 0;
const PLAYER_STATE_DRIVER = 2;
const PLAYER_STATE_PASSENGER = 3;
/** /lock 的车辆判定半径。 */
export const PERSONAL_LOCK_RADIUS = 5;
/** 锁车音效（25800）可在车辆周围 10 米内听到。 */
const LOCK_SOUND_ID = 25800;
const LOCK_SOUND_RADIUS = 10;

export type PersonalRuntime = {
  dbId: number;
  ownerId: number;
  locked: boolean;
  trunkMetal: number;
  trunkAmmo: number;
  trunkDrugs: number;
};

/** dbId → runtime vehicle id */
const runtimeByDbId = new Map<number, number>();
/** runtime vehicle id → meta */
const personalByRuntime = new Map<number, PersonalRuntime>();
/** 避免玩家上车时重复显示车主信息。 */
const ownerHintShown = new Set<number>();

export function getPersonalRuntime(runtimeId: number): PersonalRuntime | null {
  return personalByRuntime.get(runtimeId) ?? null;
}

export function isPersonalVehicleLocked(vehicle: Vehicle): boolean | null {
  const id = liveVehicleId(vehicle);
  if (id === null) {
    return null;
  }
  const personal = personalByRuntime.get(id);
  return personal ? personal.locked : null;
}

export function findRuntimeIdByDbId(dbId: number): number | undefined {
  return runtimeByDbId.get(dbId);
}

/** 数据库写入成功后更新后备箱缓存。 */
export function adjustPersonalTrunk(
  runtimeId: number,
  item: "ammo" | "metal" | "drugs",
  delta: number
): void {
  const personal = personalByRuntime.get(runtimeId);
  if (!personal) {
    return;
  }
  if (item === "ammo") {
    personal.trunkAmmo = Math.max(0, personal.trunkAmmo + delta);
  } else if (item === "metal") {
    personal.trunkMetal = Math.max(0, personal.trunkMetal + delta);
  } else {
    personal.trunkDrugs = Math.max(0, personal.trunkDrugs + delta);
  }
}

/** 出售给玩家后更新运行时车主信息。 */
export function setPersonalOwner(runtimeId: number, ownerId: number): void {
  const personal = personalByRuntime.get(runtimeId);
  if (!personal) {
    return;
  }
  personal.ownerId = ownerId;
}

/** 玩家在这辆车内或位于其附近。 */
export function isPlayerNearPersonalVehicle(
  player: Player,
  runtimeId: number,
  radius = PERSONAL_LOCK_RADIUS
): boolean {
  try {
    if (player.isInAnyVehicle() && player.getVehicleID() === runtimeId) {
      return true;
    }
  } catch {
    // 不在车内。
  }

  const vehicle = omp.vehicles.at(runtimeId);
  if (!vehicle) {
    return false;
  }

  try {
    const pos = player.getPos();
    return vehicle.getDistanceFromPoint(pos.x, pos.y, pos.z) <= radius;
  } catch {
    return false;
  }
}

export function bindPersonalVehicles(): void {
  omp.on("vehicleStreamIn", (vehicle, player) => {
    applyPersonalDoorLock(vehicle, player);
  });

  omp.on("playerStateChange", (player, newState, oldState) => {
    if (newState === PLAYER_STATE_DRIVER || newState === PLAYER_STATE_PASSENGER) {
      handleEnterPersonal(player, newState === PLAYER_STATE_PASSENGER);
      return;
    }

    if (
      oldState === PLAYER_STATE_DRIVER &&
      newState !== PLAYER_STATE_DRIVER &&
      newState !== PLAYER_STATE_PASSENGER
    ) {
      const slotId = playerId(player);
      if (slotId !== null) {
        ownerHintShown.delete(slotId);
      }
      void saveDriverVehicleState(player);
    }
  });

  omp.on("playerDisconnect", (player) => {
    const slotId = playerId(player);
    if (slotId !== null) {
      ownerHintShown.delete(slotId);
    }

    const account = getAccount(player);
    if (!account) {
      return;
    }

    void despawnOwnerVehiclesOnDisconnect(account.id);
  });
}

export function spawnPersonalVehicle(
  record: PlayerVehicleRecord,
  x: number,
  y: number,
  z: number,
  angle: number
): Vehicle | null {
  destroyPersonalVehicleByDbId(record.id, false);

  const vehicle = createServerVehicle({
    model: record.modelId,
    x,
    y,
    z,
    angle,
    color1: record.color1,
    color2: record.color2,
    respawnSec: PERSONAL_RESPAWN_SEC,
    world: STREET_WORLD,
  });
  if (!vehicle) {
    return null;
  }

  const runtimeId = liveVehicleId(vehicle);
  if (runtimeId === null) {
    return null;
  }

  try {
    vehicle.setHealth(Math.max(250, Math.min(1000, record.health)));
  } catch {
    // 忽略。
  }

  if (record.hasNitro) {
    try {
      vehicle.addComponent(1010);
    } catch {
      // 此车型没有氮气。
    }
  }

  runtimeByDbId.set(record.id, runtimeId);
  personalByRuntime.set(runtimeId, {
    dbId: record.id,
    ownerId: record.ownerId,
    locked: record.isLocked,
    trunkMetal: record.trunkMetal,
    trunkAmmo: record.trunkAmmo,
    trunkDrugs: record.trunkDrugs,
  });
  setVehicleFuel(vehicle, record.fuel);
  refreshPersonalDoorLocks(runtimeId);
  return vehicle;
}

/** 销毁运行时车辆。若 saveState 为 true，则将耐久度保存到数据库。 */
export function destroyPersonalVehicleByDbId(dbId: number, saveState: boolean): void {
  const runtimeId = runtimeByDbId.get(dbId);
  if (runtimeId === undefined) {
    return;
  }

  const vehicle = omp.vehicles.at(runtimeId);
  if (saveState && vehicle) {
    try {
      void updatePlayerVehicleHealth(dbId, vehicle.getHealth());
      void updatePlayerVehicleFuel(dbId, getVehicleFuel(vehicle));
    } catch {
      // 已被销毁。
    }
  }

  runtimeByDbId.delete(dbId);
  personalByRuntime.delete(runtimeId);
  clearVehicleFuel(runtimeId);

  if (!vehicle) {
    return;
  }

  ejectOccupants(runtimeId);
  try {
    vehicle.destroy();
  } catch {
    // 已被销毁。
  }
}

export async function toggleNearbyPersonalLock(player: Player): Promise<void> {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  if (!account) {
    return;
  }

  const vehicle = findOwnedPersonalVehicleNear(player, account.id);
  if (!vehicle) {
    player.sendClientMessage(
      Color.error,
      "附近没有你的载具。请靠近或上车。"
    );
    return;
  }

  const runtimeId = liveVehicleId(vehicle);
  if (runtimeId === null) {
    return;
  }

  const personal = personalByRuntime.get(runtimeId);
  if (!personal || personal.ownerId !== account.id) {
    return;
  }

  const nextLocked = !personal.locked;
  personal.locked = nextLocked;
  refreshPersonalDoorLocks(runtimeId);

  try {
    await updatePlayerVehicleLock(personal.dbId, nextLocked);
  } catch {
    personal.locked = !nextLocked;
    refreshPersonalDoorLocks(runtimeId);
    player.sendClientMessage(Color.error, "无法保存车锁状态。");
    return;
  }

  playLockSoundNearVehicle(vehicle);

  player.sendClientMessage(
    nextLocked ? Color.error : Color.tryOk,
    nextLocked ? "载具已锁定。" : "载具已解锁。"
  );
}

function playLockSoundNearVehicle(vehicle: Vehicle): void {
  let x = 0;
  let y = 0;
  let z = 0;
  try {
    const pos = vehicle.getPos();
    x = pos.x;
    y = pos.y;
    z = pos.z;
  } catch {
    return;
  }

  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      const pos = other.getPos();
      if (Math.hypot(pos.x - x, pos.y - y, pos.z - z) > LOCK_SOUND_RADIUS) {
        return;
      }
      other.playGameSound(LOCK_SOUND_ID, x, y, z);
    } catch {
      // 槽位为空。
    }
  });
}

/** 车主生成的任意个人车辆（不检查距离）。 */
export function findOwnedPersonalVehicle(ownerId: number): Vehicle | null {
  for (const [runtimeId, personal] of personalByRuntime) {
    if (personal.ownerId !== ownerId) {
      continue;
    }
    const vehicle = omp.vehicles.at(runtimeId);
    if (vehicle) {
      return vehicle;
    }
  }
  return null;
}

/** 查找车主的个人车辆：优先查找其当前乘坐的车辆，否则查找半径内最近的车辆。 */
export function findOwnedPersonalVehicleNear(
  player: Player,
  ownerId: number,
  radius = PERSONAL_LOCK_RADIUS
): Vehicle | null {
  try {
    if (player.isInAnyVehicle()) {
      const vehicle = omp.vehicles.at(player.getVehicleID());
      if (vehicle) {
        const id = liveVehicleId(vehicle);
        if (id !== null) {
          const personal = personalByRuntime.get(id);
          if (personal && personal.ownerId === ownerId) {
            return vehicle;
          }
        }
      }
    }
  } catch {
    // 不在车内。
  }

  let x = 0;
  let y = 0;
  let z = 0;
  try {
    const pos = player.getPos();
    x = pos.x;
    y = pos.y;
    z = pos.z;
  } catch {
    return null;
  }

  let best: Vehicle | null = null;
  let bestDist = radius;
  for (const [runtimeId, personal] of personalByRuntime) {
    if (personal.ownerId !== ownerId) {
      continue;
    }
    const vehicle = omp.vehicles.at(runtimeId);
    if (!vehicle) {
      continue;
    }
    try {
      const dist = vehicle.getDistanceFromPoint(x, y, z);
      if (dist <= bestDist) {
        bestDist = dist;
        best = vehicle;
      }
    } catch {
      // 已被销毁。
    }
  }
  return best;
}

export async function parkPersonalVehicleAtHouse(
  player: Player,
  record: PlayerVehicleRecord,
  x: number,
  y: number,
  z: number,
  angle: number
): Promise<Vehicle | null> {
  const runtimeId = runtimeByDbId.get(record.id);
  if (runtimeId !== undefined) {
    const existing = omp.vehicles.at(runtimeId);
    if (existing) {
      try {
        const hp = existing.getHealth();
        const fuel = getVehicleFuel(existing);
        await updatePlayerVehicleHealth(record.id, hp);
        await updatePlayerVehicleFuel(record.id, fuel);
        record.health = hp;
        record.fuel = Math.round(fuel);
      } catch {
        // 忽略。
      }
    }
    destroyPersonalVehicleByDbId(record.id, false);
  }

  const fresh = await findOwnedPlayerVehicle(record.ownerId);
  const toSpawn = fresh ?? record;
  return spawnPersonalVehicle(toSpawn, x, y, z, angle);
}

async function despawnOwnerVehiclesOnDisconnect(ownerId: number): Promise<void> {
  const ownedDbIds: number[] = [];
  for (const [dbId, runtimeId] of runtimeByDbId) {
    const personal = personalByRuntime.get(runtimeId);
    if (personal && personal.ownerId === ownerId) {
      ownedDbIds.push(dbId);
    }
  }

  for (const dbId of ownedDbIds) {
    destroyPersonalVehicleByDbId(dbId, true);
  }
}

async function saveDriverVehicleState(player: Player): Promise<void> {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  // 离车后 getVehicleID 已为空，因此按运行时车主查找并保存耐久度。
  // 通过最后已知信息处理，因为 leave 事件发生时 vehicle 可能尚不可用。
  // 简化处理：保存车主生成的所有运行时车辆的状态。
  for (const [runtimeId, personal] of personalByRuntime) {
    if (personal.ownerId !== account.id) {
      continue;
    }
    const vehicle = omp.vehicles.at(runtimeId);
    if (!vehicle) {
      continue;
    }
    try {
      await updatePlayerVehicleHealth(personal.dbId, vehicle.getHealth());
      await updatePlayerVehicleFuel(personal.dbId, getVehicleFuel(vehicle));
    } catch {
      // 忽略。
    }
  }
}

function handleEnterPersonal(player: Player, asPassenger: boolean): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  let vehicle: Vehicle | null = null;
  try {
    vehicle = omp.vehicles.at(player.getVehicleID()) ?? null;
  } catch {
    return;
  }
  if (!vehicle) {
    return;
  }

  const runtimeId = liveVehicleId(vehicle);
  if (runtimeId === null) {
    return;
  }

  const personal = personalByRuntime.get(runtimeId);
  if (!personal) {
    return;
  }

  // 车辆已锁定，任何人都不能上车，包括车主。
  if (personal.locked) {
    player.sendClientMessage(Color.error, "载具已锁定。");
    eject(player);
    return;
  }

  if (!asPassenger) {
    void notifyOwnerOnEnter(player, personal.ownerId);
  }
}

async function notifyOwnerOnEnter(player: Player, ownerId: number): Promise<void> {
  const slotId = playerId(player);
  if (slotId === null || ownerHintShown.has(slotId)) {
    return;
  }
  ownerHintShown.add(slotId);

  const tag = await resolveOwnerTag(ownerId);
  try {
    player.sendClientMessage(Color.info, `载具属于 ${tag}.`);
  } catch {
    // 玩家已退出。
  }
}

async function resolveOwnerTag(ownerId: number): Promise<string> {
  let online: Player | null = null;
  omp.players.forEach((other) => {
    if (online || !isPlayerActive(other) || !isAuthenticated(other)) {
      return;
    }
    const account = getAccount(other);
    if (account && account.id === ownerId) {
      online = other;
    }
  });

  if (online) {
    return playerChatName(online);
  }

  try {
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT name FROM users WHERE id = ? LIMIT 1",
      [ownerId]
    );
    const name = String(rows[0]?.name ?? "").trim();
    return name || "未知玩家";
  } catch {
    return "未知玩家";
  }
}

function applyPersonalDoorLock(vehicle: Vehicle, player: Player): void {
  const runtimeId = liveVehicleId(vehicle);
  if (runtimeId === null) {
    return;
  }

  const personal = personalByRuntime.get(runtimeId);
  if (!personal) {
    return;
  }

  // 锁定时所有人都无法开门；解锁时所有人都可以开门。
  try {
    vehicle.setParamsForPlayer(
      player,
      0,
      personal.locked ? DOORS_LOCKED : DOORS_UNLOCKED
    );
  } catch {
    // 槽位为空。
  }
}

function refreshPersonalDoorLocks(runtimeId: number): void {
  const vehicle = omp.vehicles.at(runtimeId);
  if (!vehicle) {
    return;
  }

  omp.players.forEach((player) => {
    if (!isPlayerActive(player)) {
      return;
    }
    applyPersonalDoorLock(vehicle, player);
  });
}

function ejectOccupants(vehicleId: number): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player)) {
      return;
    }
    try {
      if (!player.isInAnyVehicle() || player.getVehicleID() !== vehicleId) {
        return;
      }
      eject(player);
    } catch {
      // 槽位为空。
    }
  });
}

function eject(player: Player): void {
  try {
    player.clearAnimations(ANIM_SYNC_ALL);
    player.removeFromVehicle();
  } catch {
    // 已不在车辆中。
  }
}

function liveVehicleId(vehicle: Vehicle): number | null {
  try {
    const id = vehicle.getID();
    if (id === null || id === INVALID_VEHICLE_ID || id < 1) {
      return null;
    }
    return id;
  } catch {
    return null;
  }
}

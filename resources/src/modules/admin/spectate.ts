import { omp, type Player, type Vehicle } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { markSpectating } from "../anticheat/trust";
import { getAccount, isAuthenticated } from "../auth/session";
import { refreshStreamForPlayer } from "../mapping/stream";
import { placeAt, type SpawnPoint } from "../spawn/point";
import { registerCommand } from "../commands/registry";
import { hasAdminAccess } from "./session";

const MIN_LEVEL = 1;
/** SPECTATE_MODE_NORMAL - 第三人称视角. */
const SPECTATE_MODE_NORMAL = 1;
const PLAYER_STATE_WASTED = 7;
const PLAYER_STATE_SPECTATING = 9;
const SYNC_MS = 400;
const RETURN_FALLBACK_MS = 80;

type SpecSession = {
  targetSlot: number;
  returnPoint: SpawnPoint;
  lastInterior: number;
  lastWorld: number;
  lastVehicleId: number;
};

/** adminSlot → 观察会话. */
const sessions = new Map<number, SpecSession>();
/** toggleSpectating(false) 后,在 playerSpawn 中返回原位置. */
const pendingReturn = new Map<number, SpawnPoint>();

/** 被观察目标的槽位,或 null. */
export function getAdminSpectateTarget(player: Player): number | null {
  const id = playerId(player);
  if (id === null) {
    return null;
  }

  return sessions.get(id)?.targetSlot ?? null;
}

export function bindAdminSpectate(): void {
  registerCommand(
    "sp",
    "观察玩家",
    (player, args) => {
      tryStartSpectate(player, args.trim());
    },
    true
  );

  registerCommand(
    "spoff",
    "退出观察",
    (player) => {
      tryStopSpectate(player);
    },
    true
  );

  setInterval(syncSpectateSessions, SYNC_MS);

  omp.on("playerSpawn", (player) => {
    applyPendingReturn(player);
  });

  omp.on("playerDeath", (player) => {
    // 观察期间死亡时不返回旧位置(由重生/医院流程处理).
    clearSpectateState(player, false);
  });

  omp.on("playerDisconnect", (player) => {
    const slot = playerId(player);
    if (slot === null) {
      return;
    }

    clearSpectateState(player, false);

    for (const [adminSlot, session] of sessions) {
      if (session.targetSlot !== slot) {
        continue;
      }

      const admin = omp.players.at(adminSlot);
      if (admin && isPlayerActive(admin)) {
        stopSpectate(admin, "玩家已离开游戏,观察已结束.");
      } else {
        sessions.delete(adminSlot);
        pendingReturn.delete(adminSlot);
      }
    }
  });
}

function tryStartSpectate(player: Player, raw: string): void {
  if (!hasAdminAccess(player, MIN_LEVEL)) {
    return;
  }

  if (!raw) {
    player.sendClientMessage(Color.error, "用法: /sp [id]");
    return;
  }

  const targetSlot = Number(raw);
  if (!Number.isInteger(targetSlot) || targetSlot < 0) {
    player.sendClientMessage(Color.error, "用法: /sp [id]");
    return;
  }

  const target = findTarget(targetSlot);
  if (!target || !isAuthenticated(target)) {
    player.sendClientMessage(Color.error, "未找到玩家.");
    return;
  }

  const adminSlot = playerId(player);
  if (adminSlot === null) {
    return;
  }

  if (adminSlot === targetSlot) {
    player.sendClientMessage(Color.error, "不能观察自己.");
    return;
  }

  if (isAdminTarget(target)) {
    player.sendClientMessage(Color.error, "不能观察管理员.");
    return;
  }

  if (!canBeSpectated(target)) {
    player.sendClientMessage(Color.error, "现在不能观察该玩家.");
    return;
  }

  const existing = sessions.get(adminSlot);
  if (existing?.targetSlot === targetSlot) {
    player.sendClientMessage(Color.gray, "你已经在观察该玩家.");
    return;
  }

  // 没有本地会话但已处于观察状态(故障/F4),否则 returnPoint 会是无效值.
  if (!existing && isPlayerSpectating(player)) {
    player.sendClientMessage(
      Color.error,
      "请先退出摄像机模式: /spoff"
    );
    return;
  }

  if (!existing && !canAdminStartSpectate(player)) {
    player.sendClientMessage(Color.error, "现在不能开始观察.");
    return;
  }

  const returnPoint = existing?.returnPoint ?? readPoint(player);
  if (!returnPoint) {
    player.sendClientMessage(Color.error, "无法保存位置.");
    return;
  }

  leaveVehicle(player);

  if (!attachSpectate(player, target)) {
    player.sendClientMessage(Color.error, "无法开始观察.");
    if (existing) {
      // 切换观察目标失败,将镜头恢复到原目标.
      const prev = findTarget(existing.targetSlot);
      if (!prev || !attachSpectate(player, prev)) {
        stopSpectate(player, "观察已结束.");
      }
    } else {
      try {
        player.toggleSpectating(false);
      } catch {
        // 已退出观察模式.
      }
      markSpectating(player, false);
    }
    return;
  }

  let interior = 0;
  let world = 0;
  let vehicleId = -1;
  try {
    interior = target.getInterior();
    world = target.getVirtualWorld();
    if (target.isInAnyVehicle()) {
      vehicleId = target.getVehicleID();
    }
  } catch {
    // 默认值.
  }

  sessions.set(adminSlot, {
    targetSlot,
    returnPoint,
    lastInterior: interior,
    lastWorld: world,
    lastVehicleId: vehicleId,
  });
  pendingReturn.delete(adminSlot);
  markSpectating(player, true);

  player.sendClientMessage(
    Color.info,
    `你开始观察 ${playerChatName(target)}.`
  );
  broadcastAdmins(
    `[A] 管理员 ${playerChatName(player)} 开始观察 ${playerChatName(target)}.`
  );
}

function tryStopSpectate(player: Player): void {
  const id = playerId(player);
  // 即使未 alogin 也允许退出观察,否则可能卡在观察模式.
  if (id !== null && sessions.has(id)) {
    stopSpectate(player, "你已退出观察模式.");
    return;
  }

  // 会话已结束,但客户端仍处于 SPECTATING 状态(故障),强制退出.
  if (isPlayerSpectating(player)) {
    markSpectating(player, false);
    try {
      player.toggleSpectating(false);
    } catch {
      // 已退出观察模式.
    }
    player.sendClientMessage(Color.info, "你已退出观察模式.");
    return;
  }

  if (hasAdminAccess(player, MIN_LEVEL)) {
    player.sendClientMessage(Color.error, "你当前不在观察模式.");
  }
}

function stopSpectate(player: Player, message: string): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const session = sessions.get(id);
  if (!session) {
    return;
  }

  sessions.delete(id);
  pendingReturn.set(id, session.returnPoint);
  markSpectating(player, false);

  try {
    player.toggleSpectating(false);
  } catch {
    pendingReturn.delete(id);
    return;
  }

  // toggleSpectating(false) 会触发 playerSpawn,并在那里调用 applyPendingReturn.
  // 如果重生流程已完成或事件未触发,则使用备用处理.
  setTimeout(() => {
    if (pendingReturn.has(id) && isPlayerActive(player)) {
      applyPendingReturn(player);
    }
  }, RETURN_FALLBACK_MS);

  try {
    player.sendClientMessage(Color.info, message);
  } catch {
    // 已离线.
  }
}

function applyPendingReturn(player: Player): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const point = pendingReturn.get(id);
  if (!point) {
    return;
  }

  pendingReturn.delete(id);

  try {
    placeAt(player, point, { settleMs: false });
    refreshStreamForPlayer(player);
    player.setCameraBehind();
  } catch {
    // 玩家已离线.
  }

  markSpectating(player, false);
}

function clearSpectateState(player: Player, restore: boolean): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  if (restore && sessions.has(id)) {
    stopSpectate(player, "观察已结束.");
    return;
  }

  sessions.delete(id);
  pendingReturn.delete(id);
  markSpectating(player, false);

  try {
    if (player.getState() === PLAYER_STATE_SPECTATING) {
      player.toggleSpectating(false);
    }
  } catch {
    // 槽位为空.
  }
}

function syncSpectateSessions(): void {
  if (sessions.size === 0) {
    return;
  }

  for (const [adminSlot, session] of [...sessions]) {
    const admin = omp.players.at(adminSlot);
    if (!admin || !isPlayerActive(admin) || !hasAdminAccess(admin, MIN_LEVEL)) {
      if (admin && isPlayerActive(admin)) {
        stopSpectate(admin, "观察已结束.");
      } else {
        sessions.delete(adminSlot);
        pendingReturn.delete(adminSlot);
      }
      continue;
    }

    const target = findTarget(session.targetSlot);
    if (
      !target ||
      !isAuthenticated(target) ||
      isAdminTarget(target) ||
      !canBeSpectated(target)
    ) {
      stopSpectate(admin, "玩家不可用,观察已结束.");
      continue;
    }

    let interior = session.lastInterior;
    let world = session.lastWorld;
    let vehicleId = -1;
    try {
      interior = target.getInterior();
      world = target.getVirtualWorld();
      vehicleId = target.isInAnyVehicle() ? target.getVehicleID() : -1;
    } catch {
      stopSpectate(admin, "玩家不可用,观察已结束.");
      continue;
    }

    if (
      interior === session.lastInterior &&
      world === session.lastWorld &&
      vehicleId === session.lastVehicleId
    ) {
      continue;
    }

    if (!attachSpectate(admin, target)) {
      stopSpectate(admin, "无法更新观察状态.");
      continue;
    }

    session.lastInterior = interior;
    session.lastWorld = world;
    session.lastVehicleId = vehicleId;
  }
}

function attachSpectate(admin: Player, target: Player): boolean {
  try {
    const interior = target.getInterior();
    const world = target.getVirtualWorld();
    admin.setInterior(interior);
    admin.setVirtualWorld(world);

    // 顺序很重要:先设置 spectating,再设置目标.
    admin.toggleSpectating(true);

    if (target.isInAnyVehicle()) {
      const vehicle = omp.vehicles.at(target.getVehicleID()) ?? null;
      if (vehicle) {
        spectateVehicle(admin, vehicle);
        return true;
      }
    }

    admin.spectatePlayer(target, SPECTATE_MODE_NORMAL);
    return true;
  } catch {
    return false;
  }
}

/** omp-node 对 SpectateVehicle 的类型声明错误地要求 Player;Vehicle 也有 getPtr. */
function spectateVehicle(admin: Player, vehicle: Vehicle): void {
  (
    admin as Player & {
      spectateVehicle(target: Vehicle, mode: number): boolean;
    }
  ).spectateVehicle(vehicle, SPECTATE_MODE_NORMAL);
}

function isAdminTarget(target: Player): boolean {
  const account = getAccount(target);
  return !!account && account.adminLevel >= 1;
}

function isPlayerSpectating(player: Player): boolean {
  try {
    return player.getState() === PLAYER_STATE_SPECTATING;
  } catch {
    return false;
  }
}

function canAdminStartSpectate(player: Player): boolean {
  try {
    if (!player.isSpawned()) {
      return false;
    }

    const state = player.getState();
    return state !== PLAYER_STATE_WASTED && state !== PLAYER_STATE_SPECTATING;
  } catch {
    return false;
  }
}

function canBeSpectated(target: Player): boolean {
  try {
    if (!target.isSpawned()) {
      return false;
    }

    const state = target.getState();
    return state !== PLAYER_STATE_WASTED && state !== PLAYER_STATE_SPECTATING;
  } catch {
    return false;
  }
}

function findTarget(slot: number): Player | null {
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

  return target;
}

function readPoint(player: Player): SpawnPoint | null {
  try {
    const pos = player.getPos();
    return {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      angle: player.getFacingAngle(),
      interior: player.getInterior(),
      world: player.getVirtualWorld(),
    };
  } catch {
    return null;
  }
}

function leaveVehicle(player: Player): void {
  try {
    if (player.isInAnyVehicle()) {
      player.removeFromVehicle();
    }
  } catch {
    // 已经下车.
  }
}

function broadcastAdmins(text: string): void {
  omp.players.forEach((other) => {
    if (!isPlayerActive(other) || !hasAdminAccess(other, 1)) {
      return;
    }

    try {
      other.sendClientMessage(Color.gray, text);
    } catch {
      // 槽位为空.
    }
  });
}

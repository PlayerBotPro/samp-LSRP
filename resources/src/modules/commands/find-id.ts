import { Checkpoint, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { isAuthenticated } from "../auth/session";
import { isAutoschoolExamOnRoute } from "../autoschool/session";
import { getBusiness } from "../businesses/repository";
import { clearGpsRouteForPlayer, setFindIdMarkClearer } from "../gps";
import { getHouse } from "../houses/repository";
import { isLoaderOnShift } from "../loader";
import { isMinerOnShift } from "../miner";
import { isArmyAmmoCarrying } from "../vehicles/army-ammo-delivery";
import { isHospitalMedDeliveryActive } from "../vehicles/hospital";
import { registerCommand } from "./registry";

const CHECKPOINT_RADIUS = 4;
const ARRIVE_RADIUS = 8;
const TICK_MS = 200;
/** 与 GPS 共用同一槽位，因此同一时间只能有一个路线标记。 */
const MAP_ICON_SLOT = 2;
const MAP_ICON_TYPE = 0;
const MAP_ICON_COLOR = 0xff0000ff;
const MAPICON_GLOBAL = 1;

type FindKind = "house" | "biz";

type FindMark = {
  kind: FindKind;
  entityId: number;
  label: string;
  x: number;
  y: number;
  z: number;
};

const activeByPlayer = new Map<number, FindMark>();

function canUseCheckpoint(player: Player): boolean {
  return (
    !isMinerOnShift(player) &&
    !isLoaderOnShift(player) &&
    !isAutoschoolExamOnRoute(player) &&
    !isHospitalMedDeliveryActive(player) &&
    !isArmyAmmoCarrying(player)
  );
}

function parseId(args: string): number | null {
  const raw = args.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }

  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }

  return id;
}

export function clearFindIdMarkForPlayer(player: Player): void {
  const slot = playerId(player);
  if (slot === null || !activeByPlayer.has(slot)) {
    return;
  }

  clearMark(player, slot);
}

function clearMark(player: Player, slot: number): void {
  activeByPlayer.delete(slot);
  try {
    player.removeMapIcon(MAP_ICON_SLOT);
    if (canUseCheckpoint(player)) {
      Checkpoint.disable(player);
    }
  } catch {
    // 已离线。
  }
}

function setMark(player: Player, mark: FindMark): void {
  const slot = playerId(player);
  if (slot === null) {
    return;
  }

  // 与 GPS 共用图标和检查点槽位。
  clearGpsRouteForPlayer(player);

  let pos;
  try {
    pos = player.getPos();
    player.setMapIcon(
      MAP_ICON_SLOT,
      mark.x,
      mark.y,
      mark.z,
      MAP_ICON_TYPE,
      MAP_ICON_COLOR,
      MAPICON_GLOBAL
    );
    if (canUseCheckpoint(player)) {
      Checkpoint.set(player, mark.x, mark.y, mark.z, CHECKPOINT_RADIUS);
    }
  } catch {
    player.sendClientMessage(Color.error, "无法设置标记点。");
    return;
  }

  activeByPlayer.set(slot, mark);
  const meters = Math.round(
    Math.hypot(pos.x - mark.x, pos.y - mark.y, pos.z - mark.z)
  );
  player.sendClientMessage(
    Color.info,
    `标记点: ${mark.label}. 距离: ${meters} m.`
  );
}

function handleFind(
  player: Player,
  kind: FindKind,
  args: string,
  usage: string
): void {
  if (!isAuthenticated(player)) {
    player.sendClientMessage(Color.error, "请先登录账号。");
    return;
  }

  const entityId = parseId(args);
  if (entityId === null) {
    player.sendClientMessage(Color.error, usage);
    return;
  }

  const slot = playerId(player);
  if (slot === null) {
    return;
  }

  const current = activeByPlayer.get(slot);
  if (current && current.kind === kind && current.entityId === entityId) {
    clearMark(player, slot);
    player.sendClientMessage(Color.gray, "标记点已关闭。");
    return;
  }

  if (kind === "house") {
    const house = getHouse(entityId);
    if (!house) {
      player.sendClientMessage(Color.error, `未找到房屋 №${entityId}.`);
      return;
    }

    setMark(player, {
      kind,
      entityId,
      label: `房屋编号 ${house.id}`,
      x: house.entranceX,
      y: house.entranceY,
      z: house.entranceZ,
    });
    return;
  }

  const business = getBusiness(entityId);
  if (!business) {
    player.sendClientMessage(Color.error, `未找到企业 №${entityId}.`);
    return;
  }

  setMark(player, {
    kind,
    entityId,
    label: `企业 №${business.id}: ${business.name}`,
    x: business.entranceX,
    y: business.entranceY,
    z: business.entranceZ,
  });
}

function tickFindMarks(): void {
  omp.players.forEach((player) => {
    const slot = playerId(player);
    if (slot === null) {
      return;
    }

    const mark = activeByPlayer.get(slot);
    if (!mark || !isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    try {
      const pos = player.getPos();
      const dist = Math.hypot(pos.x - mark.x, pos.y - mark.y, pos.z - mark.z);
      if (dist <= ARRIVE_RADIUS) {
        clearMark(player, slot);
        player.sendClientMessage(
          Color.info,
          `你已到达地点: ${mark.label}.`
        );
        return;
      }

      if (canUseCheckpoint(player) && !Checkpoint.isActive(player)) {
        Checkpoint.set(player, mark.x, mark.y, mark.z, CHECKPOINT_RADIUS);
      }
    } catch {
      // 玩家已离线。
    }
  });
}

registerCommand("findidhouse", "按 ID 标记房屋位置", (player, args) => {
  handleFind(player, "house", args, "用法： /findidhouse [id]");
});

registerCommand("findidbiz", "按 ID 标记企业位置", (player, args) => {
  handleFind(player, "biz", args, "用法： /findidbiz [id]");
});

export function bindFindIdMarks(): void {
  setFindIdMarkClearer(clearFindIdMarkForPlayer);
  setInterval(tickFindMarks, TICK_MS);

  omp.on("playerDisconnect", (player) => {
    const slot = playerId(player);
    if (slot !== null) {
      activeByPlayer.delete(slot);
    }
  });
}

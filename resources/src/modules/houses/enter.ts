import type { Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { getAccount } from "../auth/session";
import { isLawOfficer } from "../org/law";
import { isJailed } from "../prison/sentence";
import { refreshStreamForPlayer } from "../mapping/stream";
import { placeAt, type SpawnPoint } from "../spawn/point";
import { isNearHouseEntrance } from "./access";
import type { HouseRecord } from "./repository";
import { getHouse } from "./repository";
import { setInsideHouse } from "./session";
import { houseVirtualWorld } from "./world";

export function houseLockStatusLabel(isLocked: boolean): string {
  return isLocked ? "Закрыт" : "Открыт";
}

export function isHouseOwner(userId: number, house: HouseRecord): boolean {
  return house.ownerId === userId;
}

/** Владелец и law (LSPD / обл. полиция / FBI) — всегда; гости — только если открыт. */
export function canEnterHouse(player: Player, house: HouseRecord): boolean {
  if (house.ownerId === null) {
    return false;
  }

  const account = getAccount(player);
  if (!account) {
    return false;
  }

  if (isHouseOwner(account.id, house)) {
    return true;
  }

  if (isLawOfficer(player)) {
    return true;
  }

  return !house.isLocked;
}

export function houseInteriorSpawn(house: HouseRecord): SpawnPoint {
  return {
    x: house.interiorX,
    y: house.interiorY,
    z: house.interiorZ,
    angle: 0,
    interior: house.interiorId,
    world: houseVirtualWorld(house.id),
  };
}

export function teleportToHouseInterior(player: Player, house: HouseRecord): boolean {
  const slotId = playerId(player);
  if (slotId === null) {
    return false;
  }

  try {
    placeAt(player, houseInteriorSpawn(house));
    refreshStreamForPlayer(player);
    setInsideHouse(slotId, house.id);
    return true;
  } catch {
    return false;
  }
}

export function tryEnterHouse(player: Player, houseId: number): void {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null || !isPlayerActive(player)) {
    return;
  }

  if (isJailed(player)) {
    player.sendClientMessage(Color.error, "在监狱里不能进入房屋。");
    return;
  }

  if (account.hospitalized) {
    player.sendClientMessage(Color.error, "请先在医院完成治疗。");
    return;
  }

  const house = getHouse(houseId);
  if (!house || house.ownerId === null) {
    player.sendClientMessage(Color.error, "该房屋无人居住。");
    return;
  }

  if (!isNearHouseEntrance(player, houseId)) {
    player.sendClientMessage(Color.error, "请靠近房屋标记点。");
    return;
  }

  if (!canEnterHouse(player, house)) {
    player.sendClientMessage(Color.error, "房屋已锁。");
    return;
  }

  if (!teleportToHouseInterior(player, house)) {
    player.sendClientMessage(Color.error, "无法进入房屋。");
  }
}

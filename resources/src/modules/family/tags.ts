import { omp, TextLabel, type Player } from "@omp-node/core";
import { isPlayerActive, playerId } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { getFamily } from "./catalog";
import { getFamilyMembership } from "./membership";

/** 柔和的灰紫色,不刺眼. */
const LABEL_COLOR = 0xa8a8c0ff;
/** 略高于昵称. */
const LABEL_OFFSET_Z = 1.15;
/** 距离与昵称显示距离大致相同. */
const LABEL_DRAW_DISTANCE = 20;
const TICK_MS = 1000;

const labels = new Map<number, TextLabel>();

export function startFamilyTags(): void {
  omp.on("playerSpawn", (player) => {
    syncFamilyTag(player);
  });

  omp.on("playerDisconnect", (player) => {
    clearFamilyTag(player);
  });

  setInterval(tickFamilyTags, TICK_MS);
}

/** 更新或移除玩家的家族标签. */
export function syncFamilyTag(player: Player): void {
  const id = playerId(player);
  if (id === null || !isPlayerActive(player) || !isAuthenticated(player)) {
    clearFamilyTag(player);
    return;
  }

  const account = getAccount(player);
  const membership = account ? getFamilyMembership(account) : null;
  if (!account || !membership) {
    clearFamilyTag(player);
    return;
  }

  const text = membership.family.name;
  const existing = labels.get(id);

  try {
    if (existing) {
      existing.updateText(LABEL_COLOR, text);
      existing.setVirtualWorld(player.getVirtualWorld());
      return;
    }

    const pos = player.getPos();
    const label = new TextLabel(
      text,
      LABEL_COLOR,
      pos.x,
      pos.y,
      pos.z + LABEL_OFFSET_Z,
      LABEL_DRAW_DISTANCE,
      player.getVirtualWorld(),
      false
    );
    label.attachToPlayer(player, 0, 0, LABEL_OFFSET_Z);
    labels.set(id, label);
  } catch {
    clearFamilyTag(player);
  }
}

export function clearFamilyTag(player: Player): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  clearFamilyTagById(id);
}

/** 家族改名后,更新所有在线成员的标签. */
export function refreshFamilyTags(familyId: number): void {
  const family = getFamily(familyId);
  if (!family) {
    return;
  }

  omp.players.forEach((player) => {
    if (!isPlayerActive(player)) {
      return;
    }

    const account = getAccount(player);
    if (!account || account.familyId !== familyId) {
      return;
    }

    syncFamilyTag(player);
  });
}

function clearFamilyTagById(id: number): void {
  const label = labels.get(id);
  if (!label) {
    return;
  }

  labels.delete(id);
  try {
    label.destroy();
  } catch {
    // 已销毁.
  }
}

function tickFamilyTags(): void {
  omp.players.forEach((player) => {
    const id = playerId(player);
    if (id === null || !labels.has(id)) {
      return;
    }

    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      clearFamilyTagById(id);
      return;
    }

    const account = getAccount(player);
    if (!account || !getFamilyMembership(account)) {
      clearFamilyTagById(id);
      return;
    }

    try {
      labels.get(id)?.setVirtualWorld(player.getVirtualWorld());
    } catch {
      clearFamilyTagById(id);
    }
  });
}

import { omp, type Player } from "@omp-node/core";
import { SERVER_TAG } from "../../shared/brand";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { clipClientMessage } from "../../shared/nearby";
import { GANGS, getMembership, getOrganization } from "../org";
import {
  hideCaptureHud,
  hideCaptureHudAll,
  showCaptureHud,
  startCaptureHud,
  updateCaptureHud,
  clearCaptureHudSlot,
} from "./capture-hud";
import { districtNameAt } from "./district";
import {
  findTurfAtPlayer,
  getTurf,
  isGangOrgId,
  playerOnTurf,
  setGangZoneOwner,
  turfColor,
  type LiveTurf,
} from "./turf";

const CAPTURE_MIN_RANK = 8;
const CAPTURE_SECONDS = 420;
const TICK_MS = 1000;
const MAP_ICON_SLOT = 6;
const MAPICON_GLOBAL = 1;
const PLAYER_STATE_ONFOOT = 1;
const PLAYER_STATE_DRIVER = 2;
const PLAYER_STATE_PASSENGER = 3;
const NEWS_COLOR = 0xff6600aa;
const GPS_HINT_COLOR = 0xffff00aa;
const GANG_HINT_COLOR = 0xffffffff;

const CAPTURE_ICONS: Readonly<Record<number, number>> = {
  9: 62,
  10: 60,
  11: 59,
  12: 61,
  13: 58,
};

type CaptureState = {
  gen: number;
  zoneId: number;
  attackerId: number;
  defenderId: number;
  attackerKills: number;
  defenderKills: number;
  endsAt: number;
  district: string;
  timer: ReturnType<typeof setInterval>;
};

let state: CaptureState | null = null;
let generation = 0;
let ending = false;

function tell(player: Player, color: number, text: string): void {
  try {
    if (isPlayerActive(player)) {
      player.sendClientMessage(color, clipClientMessage(text));
    }
  } catch {
    // 槽位为空.
  }
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function remainingSeconds(current: CaptureState): number {
  return Math.max(0, Math.ceil((current.endsAt - Date.now()) / 1000));
}

function isPlayable(player: Player): boolean {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return false;
  }

  try {
    return !player.isNPC();
  } catch {
    return false;
  }
}

function canIssueCapture(player: Player): boolean {
  if (!isPlayable(player)) {
    return false;
  }

  try {
    if (!player.isSpawned()) {
      return false;
    }

    const liveState = player.getState();
    return (
      liveState === PLAYER_STATE_ONFOOT ||
      liveState === PLAYER_STATE_DRIVER ||
      liveState === PLAYER_STATE_PASSENGER
    );
  } catch {
    return false;
  }
}

function playerOrgId(player: Player): number {
  const account = getAccount(player);
  return account ? getMembership(account)?.org.id ?? 0 : 0;
}

function isCaptureSide(orgId: number, current: CaptureState): boolean {
  return orgId === current.attackerId || orgId === current.defenderId;
}

function countOnlineGang(orgId: number): number {
  let count = 0;
  omp.players.forEach((player) => {
    if (isPlayable(player) && playerOrgId(player) === orgId) {
      count += 1;
    }
  });
  return count;
}

function forEachGangMember(orgId: number, visit: (player: Player) => void): void {
  omp.players.forEach((player) => {
    if (isPlayable(player) && playerOrgId(player) === orgId) {
      visit(player);
    }
  });
}

function sendToGang(orgId: number, color: number, text: string): void {
  forEachGangMember(orgId, (player) => tell(player, color, text));
}

function sendToSides(current: CaptureState, color: number, text: string): void {
  sendToGang(current.attackerId, color, text);
  sendToGang(current.defenderId, color, text);
}

function scoreLine(orgId: number, kills: number): string {
  const name = getOrganization(orgId)?.name ?? "帮派";
  return `${name}: ~r~${kills}`;
}

function paintHud(current: CaptureState): void {
  updateCaptureHud(
    `Time: ${formatClock(remainingSeconds(current))}`,
    scoreLine(current.attackerId, current.attackerKills),
    scoreLine(current.defenderId, current.defenderKills)
  );
}

function captureIconType(orgId: number): number {
  return CAPTURE_ICONS[orgId] ?? 23;
}

function turfCenter(turf: LiveTurf): { x: number; y: number; z: number } {
  const spawn = GANGS.find((gang) => gang.id === turf.orgId)?.spawn;
  return {
    x: (turf.minX + turf.maxX) / 2,
    y: (turf.minY + turf.maxY) / 2,
    z: spawn?.z ?? 13.5,
  };
}

function showCaptureIcon(player: Player, current: CaptureState): void {
  const turf = getTurf(current.zoneId);
  if (!turf) {
    return;
  }

  const center = turfCenter(turf);
  try {
    player.setMapIcon(
      MAP_ICON_SLOT,
      center.x,
      center.y,
      center.z,
      captureIconType(current.attackerId),
      0,
      MAPICON_GLOBAL
    );
  } catch {
    // 玩家已离开.
  }
}

function hideCaptureIcon(player: Player): void {
  try {
    player.removeMapIcon(MAP_ICON_SLOT);
  } catch {
    // 没有图标.
  }
}

function flashTurf(turf: LiveTurf, color: number): void {
  try {
    turf.zone.flashForAll(color);
  } catch {
    // 区域已销毁.
  }
}

function restoreTurf(turf: LiveTurf): void {
  try {
    turf.zone.stopFlashForAll();
    turf.zone.showForAll(turfColor(turf.orgId));
  } catch {
    // 区域已销毁.
  }
}

export function isZoneUnderCapture(zoneId: number): boolean {
  return state !== null && state.zoneId === zoneId;
}

export function refreshCaptureView(player: Player): void {
  if (!isPlayable(player)) {
    hideCaptureHud(player);
    hideCaptureIcon(player);
    return;
  }

  if (!state) {
    hideCaptureHud(player);
    hideCaptureIcon(player);
    return;
  }

  const turf = getTurf(state.zoneId);
  if (turf) {
    try {
      turf.zone.showForPlayer(player, turfColor(turf.orgId));
      turf.zone.flashForPlayer(player, turfColor(state.attackerId));
    } catch {
      // 区域已销毁.
    }
  }

  if (!isCaptureSide(playerOrgId(player), state)) {
    hideCaptureHud(player);
    hideCaptureIcon(player);
    return;
  }

  showCaptureHud(player);
  showCaptureIcon(player, state);
}

function presentToSides(current: CaptureState): void {
  paintHud(current);
  forEachGangMember(current.attackerId, (player) => refreshCaptureView(player));
  forEachGangMember(current.defenderId, (player) => refreshCaptureView(player));
}

function hideFromEveryone(): void {
  hideCaptureHudAll();
  omp.players.forEach((player) => {
    if (isPlayerActive(player)) {
      hideCaptureIcon(player);
    }
  });
}

async function finishCapture(current: CaptureState): Promise<void> {
  if (ending || state !== current) {
    return;
  }

  ending = true;
  clearInterval(current.timer);

  const turf = getTurf(current.zoneId);
  const attackerName = getOrganization(current.attackerId)?.name ?? "帮派";
  const defenderName = getOrganization(current.defenderId)?.name ?? "帮派";
  let transferred = false;

  try {
    if (current.attackerKills > current.defenderKills && turf) {
      transferred = await setGangZoneOwner(current.zoneId, current.attackerId);
    }

    if (state !== current) {
      return;
    }

    if (!transferred && turf) {
      restoreTurf(turf);
    }

    if (transferred) {
      sendToSides(
        current,
        NEWS_COLOR,
        `${attackerName}在${current.district}夺取了帮派${defenderName}的领地`
      );
    } else {
      sendToSides(
        current,
        NEWS_COLOR,
        `${attackerName}试图夺取${defenderName}的领地,但失败了`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] Turf war: ${message}`);
    if (!transferred && turf) {
      restoreTurf(turf);
    }
  } finally {
    if (state === current) {
      state = null;
    }
    ending = false;
    hideFromEveryone();
  }
}

function tickCapture(current: CaptureState): void {
  if (state !== current || ending) {
    return;
  }

  paintHud(current);
  if (remainingSeconds(current) > 0) {
    return;
  }

  void finishCapture(current);
}

function beginCapture(
  player: Player,
  turf: LiveTurf,
  attackerId: number,
  defenderId: number,
  rankTitle: string
): void {
  const gen = ++generation;
  const district = districtNameAt((turf.minX + turf.maxX) / 2, (turf.minY + turf.maxY) / 2);
  const attackerName = getOrganization(attackerId)?.name ?? "帮派";
  const defenderName = getOrganization(defenderId)?.name ?? "帮派";

  const current: CaptureState = {
    gen,
    zoneId: turf.id,
    attackerId,
    defenderId,
    attackerKills: 0,
    defenderKills: 0,
    endsAt: Date.now() + CAPTURE_SECONDS * 1000,
    district,
    timer: setInterval(() => {
      if (state?.gen === gen) {
        tickCapture(state);
      }
    }, TICK_MS),
  };

  state = current;
  flashTurf(turf, turfColor(attackerId));
  presentToSides(current);

  sendToSides(
    current,
    NEWS_COLOR,
    `${attackerName}开始争夺${district}的帮派${defenderName}领地`
  );
  sendToGang(attackerId, GANG_HINT_COLOR, `${rankTitle} ${playerChatName(player)}发起了领地争夺`);
  sendToSides(
    current,
    GPS_HINT_COLOR,
    "地点已标记在 GPS 上.前往那里支援你的帮派"
  );
}

export function tryStartCapture(player: Player): void {
  if (!canIssueCapture(player)) {
    return;
  }

  const account = getAccount(player);
  const membership = account ? getMembership(account) : null;
  if (!account || !membership || !isGangOrgId(membership.org.id)) {
    return;
  }

  if (membership.rank.id < CAPTURE_MIN_RANK) {
    tell(player, 0xb4b5b7ff, "领地争夺从 8 级开始开放.");
    return;
  }

  if (ending) {
    tell(player, 0xb4b5b7ff, "已有区域正在争夺中,请等待结束!");
    return;
  }

  const turf = findTurfAtPlayer(player);
  if (!turf) {
    tell(
      player,
      0xb4b5b7ff,
      "你必须位于想要争夺的帮派领地内."
    );
    return;
  }

  if (turf.orgId === membership.org.id) {
    tell(player, 0xb4b5b7ff, "这片领地属于你的帮派.");
    return;
  }

  if (state) {
    tell(player, 0xb4b5b7ff, "已有区域正在争夺中,请等待结束!");
    return;
  }

  if (turf.spawnProtected) {
    tell(player, 0xb4b5b7ff, "不能争夺帮派出生点领地!");
    return;
  }

  if (!isGangOrgId(turf.orgId)) {
    tell(player, 0xb4b5b7ff, "这片领地不属于任何帮派.");
    return;
  }

  if (countOnlineGang(turf.orgId) <= 0) {
    tell(
      player,
      0xb4b5b7ff,
      "拥有这片领地的帮派目前没有成员在线."
    );
    return;
  }

  beginCapture(player, turf, membership.org.id, turf.orgId, membership.rank.title);
}

function scoreCaptureKill(victim: Player, killer: Player): void {
  const current = state;
  if (!current || ending) {
    return;
  }

  if (!isCaptureCombatKill(victim, killer)) {
    return;
  }

  const killerOrg = playerOrgId(killer);
  const victimOrg = playerOrgId(victim);

  if (killerOrg === current.attackerId && victimOrg === current.defenderId) {
    current.attackerKills += 1;
    paintHud(current);
    return;
  }

  if (killerOrg === current.defenderId && victimOrg === current.attackerId) {
    current.defenderKills += 1;
    paintHud(current);
  }
}

/** 在进攻帮派与防守帮派交战的活动区域中击杀. */
export function isCaptureCombatKill(victim: Player, killer: Player): boolean {
  const current = state;
  if (!current || ending) {
    return false;
  }

  if (!isPlayable(victim) || !isPlayable(killer)) {
    return false;
  }

  if (playerId(victim) === playerId(killer)) {
    return false;
  }

  const turf = getTurf(current.zoneId);
  if (!turf || !playerOnTurf(victim, turf) || !playerOnTurf(killer, turf)) {
    return false;
  }

  const killerOrg = playerOrgId(killer);
  const victimOrg = playerOrgId(victim);
  if (killerOrg === 0 || victimOrg === 0 || killerOrg === victimOrg) {
    return false;
  }

  return (
    (killerOrg === current.attackerId && victimOrg === current.defenderId) ||
    (killerOrg === current.defenderId && victimOrg === current.attackerId)
  );
}

/** 处于争夺区域内的活动争夺参与者(进攻方/防守方). */
export function isCaptureParticipantOnTurf(player: Player): boolean {
  const current = state;
  if (!current || ending) {
    return false;
  }

  if (!isPlayable(player)) {
    return false;
  }

  const orgId = playerOrgId(player);
  if (!isCaptureSide(orgId, current)) {
    return false;
  }

  const turf = getTurf(current.zoneId);
  return !!turf && playerOnTurf(player, turf);
}

export function startCapture(): void {
  if (!startCaptureHud()) {
    omp.log(`[${SERVER_TAG}] Failed to create turf war TextDraw`);
  }

  omp.on("playerDeath", (player, killer) => {
    if (!killer) {
      return;
    }

    scoreCaptureKill(player, killer);
  });

  omp.on("playerDisconnect", (player) => {
    hideCaptureHud(player);
    hideCaptureIcon(player);
    const id = playerId(player);
    if (id !== null) {
      clearCaptureHudSlot(id);
    }
  });
}

import { Dialog, omp, Pickup, TextLabel, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { byGender } from "../auth/gender";
import { getAccount, isAuthenticated } from "../auth/session";
import { setPlayerWantedLevel } from "../auth/wanted";
import { applyJail, isJailed } from "../prison/sentence";
import { STREET_WORLD } from "../spawn/point";
import { notifyLawStaff } from "./law";
import { LSPD_INTERIOR } from "./lspd";

export const LSPD_SURRENDER_DIALOG_ID = 139;

const PICKUP_MODEL = 1247;
const PICKUP_TYPE = 1;
const PICKUP_RADIUS = 1.5;
const TICK_MS = 200;
const PLAYER_STATE_ONFOOT = 1;
const DIALOG_STYLE_MSGBOX = 0;
const LABEL_HEIGHT = 0.85;
const LABEL_DRAW_DISTANCE = 12;
const DENY_COOLDOWN_MS = 2500;
/** 每级通缉对应的监禁分钟数（1★ = 10 分钟，6★ = 60 分钟). */
const MINUTES_PER_WANTED = 10;

const PICKUP = {
  x: 240.7749,
  y: 112.9135,
  z: 1003.2188,
  interior: LSPD_INTERIOR,
  world: STREET_WORLD,
} as const;

const standingOn = new Set<number>();
const pending = new Set<number>();
const busy = new Set<number>();
const lastDenyAt = new Map<number, number>();

export function bindLspdSurrender(): void {
  new Pickup(
    PICKUP_MODEL,
    PICKUP_TYPE,
    PICKUP.x,
    PICKUP.y,
    PICKUP.z,
    PICKUP.world
  );
  new TextLabel(
    "投案自首",
    Color.info,
    PICKUP.x,
    PICKUP.y,
    PICKUP.z + LABEL_HEIGHT,
    LABEL_DRAW_DISTANCE,
    PICKUP.world,
    false
  );

  setInterval(tickSurrender, TICK_MS);

  omp.on("dialogResponse", (player, dialogId, response) => {
    if (Number(dialogId) !== LSPD_SURRENDER_DIALOG_ID) {
      return;
    }

    const slotId = playerId(player);
    if (slotId === null) {
      return;
    }

    // 仅处理当前打开的对话框响应。
    if (!pending.delete(slotId)) {
      return;
    }

    if (Number(response) === 0) {
      return;
    }

    void confirmSurrender(player, slotId);
  });

  omp.on("playerDisconnect", (player) => {
    const id = playerId(player);
    if (id !== null) {
      standingOn.delete(id);
      pending.delete(id);
      busy.delete(id);
      lastDenyAt.delete(id);
    }
  });
}

function tickSurrender(): void {
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

      if (
        player.getVirtualWorld() !== PICKUP.world ||
        player.getInterior() !== PICKUP.interior
      ) {
        standingOn.delete(slotId);
        return;
      }

      const pos = player.getPos();
      const dist = Math.hypot(
        pos.x - PICKUP.x,
        pos.y - PICKUP.y,
        pos.z - PICKUP.z
      );
      if (dist > PICKUP_RADIUS) {
        standingOn.delete(slotId);
        return;
      }

      if (standingOn.has(slotId) || pending.has(slotId) || busy.has(slotId)) {
        return;
      }

      standingOn.add(slotId);
      openSurrenderDialog(player, slotId);
    } catch {
      standingOn.delete(slotId);
    }
  });
}

function openSurrenderDialog(player: Player, slotId: number): void {
  const account = getAccount(player);
  if (!account) {
    standingOn.delete(slotId);
    return;
  }

  if (isJailed(player)) {
    deny(player, slotId, "你已经在监狱里了。");
    return;
  }

  if (account.wantedLevel <= 0) {
    deny(player, slotId, "你没有通缉等级，无需自首。");
    return;
  }

  const minutes = surrenderMinutes(account.wantedLevel);
  pending.add(slotId);

  try {
    Dialog.show(
      player,
      LSPD_SURRENDER_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "{FFCC00}向警方自首",
      [
        "{FFFFFF}确定要向警方自首吗？",
        "",
        `通缉等级：{FF6347}${account.wantedLevel}`,
        `监禁时间：{33CCFF}${minutes} 分钟`,
        "",
        "{AAAAAA}通缉状态将被移除，你将被送入监狱。",
      ].join("\n"),
      "自首",
      "取消"
    );
  } catch {
    pending.delete(slotId);
    standingOn.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开对话框。");
  }
}

function deny(player: Player, slotId: number, message: string): void {
  // 保留 standingOn，否则每 200 毫秒就会重复触发。
  const now = Date.now();
  const last = lastDenyAt.get(slotId) ?? 0;
  if (now - last < DENY_COOLDOWN_MS) {
    return;
  }

  lastDenyAt.set(slotId, now);
  try {
    player.sendClientMessage(Color.error, message);
  } catch {
    // 槽位为空。
  }
}

async function confirmSurrender(player: Player, slotId: number): Promise<void> {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  if (busy.has(slotId)) {
    return;
  }

  busy.add(slotId);
  try {
    const account = getAccount(player);
    if (!account) {
      return;
    }

    if (isJailed(player)) {
      player.sendClientMessage(Color.error, "你已经在监狱里。");
      return;
    }

    if (account.wantedLevel <= 0) {
      player.sendClientMessage(Color.error, "你没有通缉等级。");
      return;
    }

    try {
      if (
        player.getState() !== PLAYER_STATE_ONFOOT ||
        player.getVirtualWorld() !== PICKUP.world ||
        player.getInterior() !== PICKUP.interior
      ) {
        player.sendClientMessage(Color.error, "请靠近自首柜台。");
        return;
      }

      const pos = player.getPos();
      const dist = Math.hypot(
        pos.x - PICKUP.x,
        pos.y - PICKUP.y,
        pos.z - PICKUP.z
      );
      if (dist > PICKUP_RADIUS * 2) {
        player.sendClientMessage(Color.error, "请靠近自首柜台。");
        return;
      }
    } catch {
      return;
    }

    // 以确认时的通缉等级计算刑期。
    const wanted = account.wantedLevel;
    const minutes = surrenderMinutes(wanted);

    const ok = await applyJail(player, minutes);
    if (!ok) {
      player.sendClientMessage(
        Color.error,
        "无法办理自首。请重试。"
      );
      return;
    }

    // 成功入狱后才执行，否则会无故清除通缉。
    setPlayerWantedLevel(player, 0);

    const verb = byGender(account.gender, "自首了", "自首了");
    player.sendClientMessage(
      Color.info,
      `你${verb}自首了。通缉已解除，刑期: ${minutes} 分钟。`
    );

    notifyLawStaff(
      `${playerChatName(player)} ${verb} 向 LSPD 自首 (通缉等级 ${wanted}, 刑期 ${minutes} 分钟).`
    );
  } finally {
    busy.delete(slotId);
    standingOn.delete(slotId);
  }
}

function surrenderMinutes(wantedLevel: number): number {
  return Math.max(1, Math.floor(wantedLevel)) * MINUTES_PER_WANTED;
}

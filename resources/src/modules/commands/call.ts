import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import {
  CHAT_RADIUS,
  clipClientMessage,
  sendNearby,
} from "../../shared/nearby";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { getAccount, isAuthenticated, normalizePhone } from "../auth/session";
import { cancelTalkTimer, playLocalSpeech } from "../chat/talk";
import { registerCommand } from "./registry";

const COLOR_OUT = 0x66cc00ff;
const COLOR_IN = 0x3399ffff;
const COLOR_OWN = 0x999999ff;
const COLOR_OTHER = 0xffff00ff;
const COLOR_END = 0xff9a44ff;
const RING_SOUND = 20600;
const RING_BUBBLE_MS = 3_000;
const RING_BUBBLE = "手机正在响铃";
const ANIM_SYNC_ALL = 1;
const SPECIAL_ACTION_NONE = 0;
/** 内置手机动作:phone_talk,允许行走. */
const SPECIAL_ACTION_USECELLPHONE = 11;

const phoneHolding = new Set<number>();
const previousAction = new Map<number, number>();

type Call = {
  callerSlot: number;
  calleeSlot: number;
  callerUserId: number;
  calleeUserId: number;
  phase: "ringing" | "active";
};

const bySlot = new Map<number, Call>();
let bound = false;

registerCommand("call", "拨打电话号码", (player, args) => {
  startCall(player, args);
});

registerCommand("p", "接听来电", (player) => {
  answerCall(player);
});

registerCommand("h", "挂断或拒接电话", (player) => {
  hangUp(player);
});

export function bindPhoneCalls(): void {
  if (bound) {
    return;
  }
  bound = true;

  omp.on("playerDisconnect", (player) => {
    dropCallSlot(playerId(player));
  });

  omp.on("playerConnect", (player) => {
    dropCallSlot(playerId(player));
  });

  omp.on("playerDeath", (player) => {
    const slot = playerId(player);
    if (slot === null) {
      return;
    }
    const call = bySlot.get(slot);
    if (call) {
      finishCall(call);
    }
  });
}

/** 通话期间,普通聊天发送给通话对象,而非附近玩家. */
export function routePhoneChat(player: Player, text: string): boolean {
  const slot = playerId(player);
  const account = getAccount(player);
  if (slot === null || !account) {
    return false;
  }

  const call = bySlot.get(slot);
  if (!call || call.phase !== "active" || userIdOf(call, slot) !== account.id) {
    return false;
  }

  const other = livePlayer(partnerSlot(call, slot), partnerUserId(call, slot));
  if (!other) {
    finishCall(call);
    return true;
  }

  const line = clipClientMessage(`[电话] ${account.name}: ${text}`);
  player.sendClientMessage(COLOR_OWN, line);
  other.sendClientMessage(COLOR_OTHER, line);
  playLocalSpeech(player, clipClientMessage(`(( [电话] ${text} ))`), { anim: false });
  return true;
}

function startCall(player: Player, args: string): void {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  if (!account.phone) {
    player.sendClientMessage(Color.error, "你没有手机,请到 24/7 商店购买.");
    return;
  }

  const phone = normalizePhone(args.trim().split(/\s+/)[0] ?? "");
  if (!phone) {
    player.sendClientMessage(Color.error, "用法:/call [电话号码]");
    return;
  }

  if (phone === account.phone) {
    player.sendClientMessage(Color.error, "不能给自己打电话.");
    return;
  }

  if (busyOnLine(slotId, account.id)) {
    player.sendClientMessage(Color.error, "你已在通话中,挂断请使用 /h.");
    return;
  }

  const target = findOnlineByPhone(phone);
  const targetAccount = target ? getAccount(target) : null;
  const targetSlot = target ? playerId(target) : null;
  if (!target || !targetAccount?.phone || targetSlot === null) {
    player.sendClientMessage(Color.error, "对方不在线.");
    return;
  }

  if (busyOnLine(targetSlot, targetAccount.id)) {
    player.sendClientMessage(Color.error, "对方忙线中.");
    return;
  }

  const call: Call = {
    callerSlot: slotId,
    calleeSlot: targetSlot,
    callerUserId: account.id,
    calleeUserId: targetAccount.id,
    phase: "ringing",
  };
  bySlot.set(slotId, call);
  bySlot.set(targetSlot, call);
  holdPhoneAnim(player);

  sendNearby(
    player,
    CHAT_RADIUS,
    Color.action,
    `${playerChatName(player)} 拿出了手机`
  );
  player.sendClientMessage(
    COLOR_OUT,
    clipClientMessage(
      `拨出电话 | 号码: ${phone} {FFCD00}| 等待 ${targetAccount.name} 接听...`
    )
  );

  try {
    target.setChatBubble(RING_BUBBLE, Color.action, CHAT_RADIUS, RING_BUBBLE_MS);
  } catch {
    // 头顶文字并非必需.
  }

  target.sendClientMessage(
    COLOR_IN,
    clipClientMessage(
      `来电 | 号码: ${account.phone} | 来电者: ${account.name}`
    )
  );
  target.sendClientMessage(
    Color.white,
    "使用 {00CC00}/p {FFFFFF}接听,或使用 {FF6600}/h {FFFFFF}拒接来电."
  );
  playRing(target);
}

function answerCall(player: Player): void {
  const slot = playerId(player);
  const account = getAccount(player);
  if (slot === null || !account) {
    return;
  }

  const call = bySlot.get(slot);
  if (!call || call.phase !== "ringing" || call.calleeSlot !== slot || call.calleeUserId !== account.id) {
    player.sendClientMessage(Color.error, "当前没有来电.");
    return;
  }

  const caller = livePlayer(call.callerSlot, call.callerUserId);
  if (!caller) {
    finishCall(call);
    return;
  }

  call.phase = "active";
  holdPhoneAnim(player);
  player.sendClientMessage(Color.action, "你已接听电话.");
  caller.sendClientMessage(Color.action, `${account.name} 接听了你的电话.`);
}

function hangUp(player: Player): void {
  const slot = playerId(player);
  const account = getAccount(player);
  if (slot === null || !account) {
    return;
  }

  const call = bySlot.get(slot);
  if (!call || userIdOf(call, slot) !== account.id) {
    player.sendClientMessage(Color.error, "你当前没有在通话.");
    return;
  }

  finishCall(call);
}

function dropCallSlot(slot: number | null): void {
  if (slot === null) {
    return;
  }

  const call = bySlot.get(slot);
  if (!call) {
    return;
  }

  finishCall(call, slot);
}

function busyOnLine(slot: number, userId: number): boolean {
  const call = bySlot.get(slot);
  if (!call) {
    return false;
  }

  if (userIdOf(call, slot) === userId) {
    return true;
  }

  finishCall(call, slot);
  return false;
}

function finishCall(call: Call, skipSlot?: number): void {
  bySlot.delete(call.callerSlot);
  bySlot.delete(call.calleeSlot);
  releasePhoneAnim(call.callerSlot, call.callerUserId);
  releasePhoneAnim(call.calleeSlot, call.calleeUserId);
  if (skipSlot !== call.callerSlot) {
    tell(call.callerSlot, call.callerUserId, COLOR_END, "通话已结束");
  }
  if (skipSlot !== call.calleeSlot) {
    tell(call.calleeSlot, call.calleeUserId, COLOR_END, "通话已结束");
  }
}

export function endPhoneCall(player: Player): void {
  const slot = playerId(player);
  if (slot === null) {
    return;
  }

  const call = bySlot.get(slot);
  if (!call) {
    return;
  }

  const account = getAccount(player);
  if (account && userIdOf(call, slot) !== account.id) {
    return;
  }

  finishCall(call);
}

function tell(slot: number, userId: number, color: number, text: string): void {
  const player = livePlayer(slot, userId);
  if (!player) {
    return;
  }
  try {
    player.sendClientMessage(color, text);
  } catch {
    // 已离线.
  }
}

function livePlayer(slot: number, userId: number): Player | null {
  const player = omp.players.at(slot);
  if (!player || !isPlayerActive(player) || !isAuthenticated(player)) {
    return null;
  }
  if (getAccount(player)?.id !== userId) {
    return null;
  }
  return player;
}

function userIdOf(call: Call, slot: number): number {
  return call.callerSlot === slot ? call.callerUserId : call.calleeUserId;
}

function partnerSlot(call: Call, slot: number): number {
  return call.callerSlot === slot ? call.calleeSlot : call.callerSlot;
}

function partnerUserId(call: Call, slot: number): number {
  return call.callerSlot === slot ? call.calleeUserId : call.callerUserId;
}

function findOnlineByPhone(phone: string): Player | null {
  let found: Player | null = null;

  omp.players.forEach((other) => {
    if (found || !isPlayerActive(other) || !isAuthenticated(other)) {
      return;
    }

    try {
      if (other.isNPC()) {
        return;
      }
    } catch {
      return;
    }

    if (getAccount(other)?.phone === phone) {
      found = other;
    }
  });

  return found;
}

function holdPhoneAnim(player: Player): void {
  const slot = playerId(player);
  if (slot === null) {
    return;
  }

  cancelTalkTimer(player);
  let restore = SPECIAL_ACTION_NONE;
  try {
    const current = player.getSpecialAction();
    if (current !== SPECIAL_ACTION_USECELLPHONE && current !== SPECIAL_ACTION_NONE) {
      restore = current;
    }
  } catch {
    // 通话结束后恢复普通站姿.
  }

  previousAction.set(slot, restore);
  phoneHolding.add(slot);
  try {
    player.clearAnimations(ANIM_SYNC_ALL);
    player.setSpecialAction(SPECIAL_ACTION_USECELLPHONE);
  } catch {
    // 通话不依赖动画.
  }
}

function releasePhoneAnim(slot: number, userId: number): void {
  const restore = previousAction.get(slot) ?? SPECIAL_ACTION_NONE;
  previousAction.delete(slot);
  if (!phoneHolding.delete(slot)) {
    return;
  }

  const player = livePlayer(slot, userId);
  if (!player) {
    return;
  }

  try {
    player.clearAnimations(ANIM_SYNC_ALL);
    player.setSpecialAction(restore);
  } catch {
    // 已离线.
  }
}

function playRing(player: Player): void {
  try {
    const pos = player.getPos();
    player.playGameSound(RING_SOUND, pos.x, pos.y, pos.z);
  } catch {
    try {
      player.playGameSound(RING_SOUND, 0, 0, 0);
    } catch {
      // 来电提示不依赖铃声.
    }
  }
}

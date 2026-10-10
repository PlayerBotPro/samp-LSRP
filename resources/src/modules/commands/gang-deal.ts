import { omp, type Player } from "@omp-node/core";
import { WHISPER_RADIUS, arePlayersNearby } from "../../shared/nearby";
import { isPlayerActive } from "../../shared/player";
import {
  applyWallet,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../auth/session";
import { getMembership } from "../org";
import { isJailed } from "../prison/sentence";
import { STREET_WORLD } from "../spawn/point";
import { findTurfAtPlayer, isGangOrgId } from "../zones/turf";

export const GANG_DEAL_MIN_PRICE = 1;
export const GANG_DEAL_MAX_PRICE = 50_000;
export const GANG_DEAL_MAX_CASH = 2_147_483_647;
export const GANG_DEAL_OFFER_TTL_MS = 60_000;
export const GANG_DEAL_KEY_YES = 65536;
export const GANG_DEAL_KEY_NO = 131072;

const PLAYER_STATE_ONFOOT = 1;
const PLAYER_STATE_WASTED = 7;

/** 检查帮派卖家是否位于己方帮派地盘.null 表示通过. */
export function gangSellerGate(player: Player): string | null {
  if (!isAuthenticated(player)) {
    return "请先登录账号.";
  }

  const account = getAccount(player);
  if (!account) {
    return "请先登录账号.";
  }

  if (account.hospitalized) {
    return "请先在医院接受治疗.";
  }

  if (isJailed(player)) {
    return "在监狱中无法使用此命令.";
  }

  const membership = getMembership(account);
  if (!membership || !isGangOrgId(membership.org.id)) {
    return "仅帮派成员可使用此命令.";
  }

  try {
    if (player.getState() === PLAYER_STATE_WASTED) {
      return "你不在游戏中.";
    }

    if (player.getState() !== PLAYER_STATE_ONFOOT) {
      return "必须徒步站立.";
    }

    if (
      player.getVirtualWorld() !== STREET_WORLD ||
      player.getInterior() !== 0
    ) {
      return "只能在室外进行交易.";
    }
  } catch {
    return "无法检查位置.";
  }

  const turf = findTurfAtPlayer(player);
  if (!turf || turf.orgId !== membership.org.id) {
    return "只能在自己帮派的地盘出售.";
  }

  return null;
}

export function findDealPlayer(slot: number): Player | null {
  try {
    const target = omp.players.at(slot);
    if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
      return null;
    }

    if (target.isNPC()) {
      return null;
    }

    if (!getAccount(target)) {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}

export function dealPairReady(seller: Player, buyer: Player): string | null {
  const sellerBlock = gangSellerGate(seller);
  if (sellerBlock) {
    return sellerBlock;
  }

  const buyerAccount = getAccount(buyer);
  if (!buyerAccount || !isAuthenticated(buyer)) {
    return "未找到玩家.";
  }

  if (buyerAccount.hospitalized) {
    return "买家需要治疗.";
  }

  if (isJailed(buyer)) {
    return "买家正在监狱中.";
  }

  try {
    if (buyer.getState() === PLAYER_STATE_WASTED) {
      return "玩家不在线.";
    }

    if (buyer.getState() !== PLAYER_STATE_ONFOOT) {
      return "买家必须徒步站立.";
    }
  } catch {
    return "未找到玩家.";
  }

  if (!arePlayersNearby(seller, buyer, WHISPER_RADIUS)) {
    return "玩家距离太远.";
  }

  return null;
}

export function tellDeal(player: Player, color: number, text: string): void {
  try {
    if (isPlayerActive(player)) {
      player.sendClientMessage(color, text);
    }
  } catch {
    // 槽位为空.
  }
}

export function parseDealOfferArgs(
  args: string
): { slot: number; amount: number; price: number } | null {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
    return null;
  }

  if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])) {
    return null;
  }

  const slot = Number(parts[0]);
  const amount = Number(parts[1]);
  const price = Number(parts[2]);
  if (
    !Number.isInteger(slot) ||
    slot < 0 ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    !Number.isInteger(price) ||
    price < GANG_DEAL_MIN_PRICE ||
    price > GANG_DEAL_MAX_PRICE
  ) {
    return null;
  }

  return { slot, amount, price };
}

/** transferUserCash 成功后更新现金差额(与 /pay 相同). */
export function applyDealCashDelta(player: Player, delta: number): void {
  if (!isPlayerActive(player)) {
    return;
  }

  const live = getAccount(player);
  if (!live) {
    return;
  }

  const next = Math.max(
    0,
    Math.min(GANG_DEAL_MAX_CASH, Math.floor(live.money) + delta)
  );
  patchAccount(player, { money: next });
  const updated = getAccount(player);
  if (updated) {
    applyWallet(player, updated);
  }
}

/** /sellgun 与 /selldrug 共用忙碌状态(使用相同槽位). */
const dealBusy = new Set<number>();

export function isDealBusy(...slots: number[]): boolean {
  return slots.some((slot) => dealBusy.has(slot));
}

export function claimDealBusy(...slots: number[]): boolean {
  if (isDealBusy(...slots)) {
    return false;
  }

  for (const slot of slots) {
    dealBusy.add(slot);
  }

  return true;
}

export function releaseDealBusy(...slots: number[]): void {
  for (const slot of slots) {
    dealBusy.delete(slot);
  }
}

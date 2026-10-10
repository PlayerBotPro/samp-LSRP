import type { Player } from "@omp-node/core";
import { playerId } from "../../shared/player";
import { trustHealth, trustMoney } from "../anticheat/trust";
import type { Gender } from "./gender";
import type { Licenses } from "./licenses";

export const MAX_HEALTH = 100;
export const MIN_HEALTH = 20;
export const MAX_LAWFULNESS = 100;
export const MIN_LAWFULNESS = -100;
export const STARTING_LAWFULNESS = 100;
export const HOSPITAL_HEALTH = MIN_HEALTH;
export const STARTING_HEALTH = 100;
export const MAX_HUNGER = 100;
export const STARTING_HUNGER = 100;
/** 电话号码长度(6 位数字).null 表示没有电话. */
export const PHONE_DIGITS = 6;
export const HEALTH_DECAY_AMOUNT = 1;
/** 饥饿度为 0 时更新饥饿度和生命值的间隔(沿用原生命值更新间隔). */
export const HEALTH_DECAY_MS = 15 * 60 * 1000;
/** 每次更新扣除的饥饿度(约 5 小时从 100 降到 0). */
export const HUNGER_DECAY_AMOUNT = 5;
/** 饥饿提醒阈值(从高到低). */
export const HUNGER_WARN_LEVELS = [40, 30, 20] as const;
export const VITALS_SAVE_MS = 3 * 60 * 1000;

export function normalizeHealth(value: unknown): number {
  const health = Number(value);
  if (!Number.isFinite(health) || health <= 0) {
    return STARTING_HEALTH;
  }

  return Math.min(MAX_HEALTH, health);
}

export function normalizeHunger(value: unknown): number {
  const hunger = Math.floor(Number(value));
  if (!Number.isFinite(hunger)) {
    return STARTING_HUNGER;
  }

  return Math.min(MAX_HUNGER, Math.max(0, hunger));
}

/** 规范化的电话号码(6 位数字);没有电话或号码无效时为 null. */
export function normalizePhone(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  if (!new RegExp(`^\\d{${PHONE_DIGITS}}$`).test(raw)) {
    return null;
  }
  return raw;
}

export function normalizeLawfulness(value: unknown): number {
  const lawfulness = Math.floor(Number(value));
  if (!Number.isFinite(lawfulness)) {
    return STARTING_LAWFULNESS;
  }

  return Math.min(MAX_LAWFULNESS, Math.max(MIN_LAWFULNESS, lawfulness));
}

export type Account = {
  id: number;
  name: string;
  email: string;
  gender: Gender;
  skin: number;
  level: number;
  exp: number;
  money: number;
  bank: number;
  donate: number;
  lawfulness: number;
  health: number;
  drugs: number;
  ammo: number;
  metal: number;
  passport: boolean;
  hospitalized: boolean;
  /** 通缉等级 0-6(游戏星级). */
  wantedLevel: number;
  /** 军人证. */
  militaryId: boolean;
  /** 医疗卡. */
  medcard: boolean;
  /** 饥饿度 0-100(100 表示饱腹). */
  hunger: number;
  /** 电话号码(6 位数字);没有电话时为 null. */
  phone: string | null;
  invitedBy: string | null;
  birthDate: string;
  adminLevel: number;
  orgId: number;
  orgRank: number;
  /** 普通职业(0 表示无业). */
  jobId: number;
  familyId: number;
  familyRank: number;
  mutedUntil: number | null;
  jailSeconds: number;
  licenses: Licenses;
};

const accounts = new Map<number, Account>();

export function isAuthenticated(player: Player): boolean {
  const id = playerId(player);
  return id !== null && accounts.has(id);
}

export function getAccount(player: Player): Account | null {
  const id = playerId(player);
  if (id === null) {
    return null;
  }

  return accounts.get(id) ?? null;
}

export function getGender(player: Player): Gender | null {
  return getAccount(player)?.gender ?? null;
}

export function setAccount(player: Player, account: Account): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  accounts.set(id, account);
}

export function clearAccount(player: Player): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  accounts.delete(id);
}

export function applyWallet(player: Player, account: Account): void {
  try {
    player.resetMoney();
    if (account.money !== 0) {
      player.giveMoney(account.money);
    }
  } catch {
    // 槽位尚未进入游戏.
  }
  trustMoney(player, account.money);
}

export function applyHealth(player: Player, health: number): void {
  try {
    player.setHealth(health);
  } catch {
    // 槽位尚未进入游戏.
  }
  trustHealth(player, health);
}

export function applyScore(player: Player, level: number): void {
  try {
    player.setScore(Math.max(0, Math.floor(level)));
  } catch {
    // 槽位尚未进入游戏.
  }
}

/** GTA SA 通缉星级(0-6). */
export function applyWantedLevel(player: Player, level: number): void {
  const wanted = normalizeWantedLevel(level);
  try {
    player.setWantedLevel(wanted);
  } catch {
    // 槽位尚未进入游戏.
  }
}

export function normalizeWantedLevel(value: unknown): number {
  const level = Math.floor(Number(value));
  if (!Number.isFinite(level) || level <= 0) {
    return 0;
  }

  return Math.min(6, level);
}

export function patchAccount(
  player: Player,
  patch: Partial<
    Pick<
      Account,
      | "health"
      | "money"
      | "bank"
      | "lawfulness"
      | "passport"
      | "hospitalized"
      | "wantedLevel"
      | "militaryId"
      | "medcard"
      | "hunger"
      | "phone"
      | "invitedBy"
      | "level"
      | "exp"
      | "adminLevel"
      | "orgId"
      | "orgRank"
      | "jobId"
      | "familyId"
      | "familyRank"
      | "skin"
      | "mutedUntil"
      | "jailSeconds"
      | "licenses"
      | "drugs"
      | "ammo"
      | "metal"
    >
  >
): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  setAccount(player, { ...account, ...patch });
}

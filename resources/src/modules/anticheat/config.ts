import { AcCode, AC_CODE_COUNT, NopCode, NOP_CODE_COUNT } from "./codes";

export type AcConfig = {
  enabled: boolean;
  debug: boolean;
  maxPing: number;
  maxPingWarnings: number;
  maxConnectsPerIp: number;
  kickOnDetect: boolean;
  /** 同一检测代码触发多少次后踢出玩家（软处罚）。 */
  softStrikeMax: number;
  /** 多久没有再次触发后重置软处罚计数（毫秒）。 */
  softStrikeDecayMs: number;
  reconnectMinMs: number;
  airBreakWarnings: number;
  airBreakVehWarnings: number;
  flyWarnings: number;
  speedFootMax: number;
  speedVehMax: number;
  speedWarnings: number;
  teleportFootDist: number;
  teleportVehDist: number;
  moneyGraceMs: number;
  posGraceMs: number;
  healthGraceMs: number;
  weaponGraceMs: number;
  floodWindowMs: number;
  floodMaxEvents: number;
  rapidFireMinMs: number;
  codes: boolean[];
  nops: boolean[];
};

function allTrue(n: number, except: number[] = []): boolean[] {
  const arr = Array.from({ length: n }, () => true);
  for (const i of except) {
    if (i >= 0 && i < n) arr[i] = false;
  }
  return arr;
}

/** 尚未实现或误报率较高的检测代码已禁用。 */
const DISABLED_CODES = [
  AcCode.Parkour,
  AcCode.UnFreeze,
  AcCode.FakeNpc,
  AcCode.LagCompSpoof,
  AcCode.ProAim,
  AcCode.RconBrute,
  AcCode.AttachCrasher,
  AcCode.GodModeFoot,
  AcCode.GodModeVeh,
  AcCode.FullAiming,
  AcCode.CarShot,
  AcCode.QuickTurn,
  AcCode.CarJack,
  AcCode.AfkGhost,
  AcCode.InvalidVersion,
  AcCode.TuningCrasher,
  AcCode.SeatCrasher,
  AcCode.DialogCrasher,
  AcCode.ConnectFlood,
  AcCode.SeatFlood,
  AcCode.Invisible,
  AcCode.DialogHack,
  AcCode.TeleportVehToPlayer,
  AcCode.TeleportPickup,
  AcCode.Tuning,
  AcCode.FakeKill,
  AcCode.Nop,
  AcCode.AmmoInfinite,
  AcCode.RapidFire,
  AcCode.CjRun,
];

/** 这些检测代码会立即踢出玩家，不经过软处罚计数。 */
export const INSTANT_KICK_CODES = new Set<AcCode>([
  AcCode.WeaponCrasher,
  AcCode.FakeSpawn,
  AcCode.Dos,
  AcCode.Sandbox,
]);

export const defaultConfig: AcConfig = {
  enabled: true,
  debug: false,
  maxPing: 550,
  maxPingWarnings: 10,
  maxConnectsPerIp: 4,
  kickOnDetect: false,
  softStrikeMax: 1,
  softStrikeDecayMs: 90_000,
  reconnectMinMs: 8_000,
  airBreakWarnings: 5,
  airBreakVehWarnings: 4,
  flyWarnings: 3,
  speedFootMax: 300,
  speedVehMax: 380,
  speedWarnings: 4,
  teleportFootDist: 50,
  teleportVehDist: 60,
  moneyGraceMs: 2000,
  posGraceMs: 3000,
  healthGraceMs: 3000,
  weaponGraceMs: 2500,
  floodWindowMs: 1000,
  floodMaxEvents: 12,
  rapidFireMinMs: 45,
  codes: allTrue(AC_CODE_COUNT, DISABLED_CODES),
  nops: allTrue(NOP_CODE_COUNT, [
    NopCode.GiveWeapon,
    NopCode.SetAmmo,
    NopCode.SetInterior,
    NopCode.SetHealth,
    NopCode.SetVehicleHealth,
    NopCode.SetArmour,
    NopCode.SetSpecialAction,
    NopCode.PutInVehicle,
    NopCode.ToggleSpectating,
    NopCode.Spawn,
    NopCode.SetPos,
    NopCode.RemoveFromVehicle,
  ]),
};

let config: AcConfig = {
  ...defaultConfig,
  codes: [...defaultConfig.codes],
  nops: [...defaultConfig.nops],
};

export function getConfig(): AcConfig {
  return config;
}

export function isCodeEnabled(code: AcCode): boolean {
  return config.enabled && Boolean(config.codes[code]);
}

export function isNopEnabled(code: NopCode): boolean {
  return config.enabled && Boolean(config.nops[code]);
}

export function setCodeEnabled(code: AcCode, enabled: boolean): boolean {
  if (code < 0 || code >= AC_CODE_COUNT) return false;
  config.codes[code] = enabled;
  return true;
}

export function setNopEnabled(code: NopCode, enabled: boolean): boolean {
  if (code < 0 || code >= NOP_CODE_COUNT) return false;
  config.nops[code] = enabled;
  return true;
}

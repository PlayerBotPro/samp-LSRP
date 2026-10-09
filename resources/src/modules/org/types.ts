import type { SpawnPoint } from "../spawn/point";

export const ORG_NONE = 0;
export const MIN_ORG_RANK = 1;
export const MAX_ORG_RANK = 10;

export type OrgSkins = {
  male: number;
  female: number;
};

export type OrgRankDef = {
  id: number;
  title: string;
  pay: number;
  skins: OrgSkins;
};

export type OrganizationDef = {
  id: number;
  name: string;
  color: number;
  gov: boolean;
  illegal: boolean;
  /** 家族：使用 /f，不使用 /r、/d、/gov，也不参与地盘战。 */
  mafia?: boolean;
  spawn: SpawnPoint;
  ranks: readonly OrgRankDef[];
};

export type OrgGateDef = {
  orgId: number;
  /** 如果已设置，这些组织中的任意一个都可以打开；否则仅限 `orgId`. */
  orgIds?: readonly number[];
  model: number;
  x: number;
  y: number;
  zClosed: number;
  zOpen: number;
  rx: number;
  ry: number;
  rz: number;
  /** 道闸：关闭时使用 `ry`，打开时使用 `ryOpen` （XYZ 相同）。 */
  ryOpen?: number;
  radius: number;
  denyMessage: string;
};

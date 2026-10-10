import { STREET_WORLD } from "../spawn/point";
import { ORG_FBI_ID } from "./fbi";
import { ORG_LSPD_ID } from "./lspd";
import { ORG_POLICE_ID } from "./police";
import type { OrganizationDef, OrgGateDef, OrgRankDef } from "./types";
import { MAX_ORG_RANK } from "./types";

export const ORG_ARMY_ID = 1;

const ARMY_COLOR = 0x9c7a4bff;
const ARMY_GATE_ORG_IDS = [ORG_ARMY_ID, ORG_POLICE_ID, ORG_LSPD_ID, ORG_FBI_ID] as const;
const ARMY_GATE_DENY =
  "军队,州警察,LSPD 和 FBI 员工可以打开.";

function armyRanks(): OrgRankDef[] {
  const rows: Array<{ title: string; male: number; female: number; pay: number }> = [
    { title: "列兵", male: 287, female: 191, pay: 1500 },
    { title: "下士", male: 287, female: 191, pay: 1900 },
    { title: "中士", male: 179, female: 191, pay: 2400 },
    { title: "军士长", male: 179, female: 191, pay: 3000 },
    { title: "中尉", male: 255, female: 191, pay: 3700 },
    { title: "上尉", male: 255, female: 191, pay: 4500 },
    { title: "少校", male: 255, female: 191, pay: 5400 },
    { title: "中校", male: 61, female: 191, pay: 6400 },
    { title: "上校", male: 61, female: 191, pay: 7500 },
    { title: "将军", male: 61, female: 191, pay: 9000 },
  ];

  return rows.map((row, index) => ({
    id: index + 1,
    title: row.title,
    pay: row.pay,
    skins: { male: row.male, female: row.female },
  }));
}

export const ARMY: OrganizationDef = {
  id: ORG_ARMY_ID,
  name: "军队",
  color: ARMY_COLOR,
  gov: true,
  illegal: false,
  spawn: {
    x: 2733.9255,
    y: -2449.3652,
    z: 17.5938,
    angle: 305.0398,
    interior: 0,
    world: STREET_WORLD,
  },
  ranks: armyRanks(),
};

if (ARMY.ranks.length !== MAX_ORG_RANK) {
  throw new Error("军队: 需要 10 个等级");
}

const ARMY_GATE = {
  orgId: ORG_ARMY_ID,
  orgIds: ARMY_GATE_ORG_IDS,
  model: 19912,
  rx: 0,
  ry: 0,
  rz: 90,
  radius: 14,
  denyMessage: ARMY_GATE_DENY,
} as const;

export const ARMY_GATES: OrgGateDef[] = [
  {
    ...ARMY_GATE,
    x: 2719.74878,
    y: -2399.5542,
    zClosed: 15.2148,
    zOpen: 9.6798,
  },
  {
    ...ARMY_GATE,
    x: 2719.74878,
    y: -2498.31299,
    zClosed: 15.2148,
    zOpen: 9.6798,
  },
];

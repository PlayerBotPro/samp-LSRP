import { STREET_WORLD } from "../spawn/point";
import { defineGovOrg } from "./define";
import { ORG_FBI_ID } from "./fbi";
import { ORG_POLICE_ID } from "./police";
import { POLICE_COLOR, POLICE_RANKS } from "./police-ranks";
import type { OrgGateDef } from "./types";

export const ORG_LSPD_ID = 5;
export const LSPD_INTERIOR = 10;

/** = ORG_ARMY_ID; 不导入 army.ts(避免与 ARMY_GATE_ORG_IDS 形成循环依赖). */
const ORG_ARMY_FOR_BARRIER = 1;

export const LSPD = defineGovOrg(
  ORG_LSPD_ID,
  "LSPD",
  POLICE_COLOR,
  {
    x: 274.0818,
    y: 125.2646,
    z: 1004.6172,
    angle: 89.6843,
    interior: LSPD_INTERIOR,
    world: STREET_WORLD,
  },
  POLICE_RANKS
);

/** 车库大门:不包括军队. */
export const LAW_ORG_IDS = [ORG_LSPD_ID, ORG_POLICE_ID, ORG_FBI_ID] as const;
/** 入口道闸:包括军队(弹药运送). */
const BARRIER_ORG_IDS = [
  ORG_LSPD_ID,
  ORG_POLICE_ID,
  ORG_FBI_ID,
  ORG_ARMY_FOR_BARRIER,
] as const;
const BARRIER_DENY =
  "LSPD,州警察,FBI 和军队员工可以打开.";
const GARAGE_DENY = "LSPD,州警察和 FBI 员工可以打开.";

export const LSPD_GATES: OrgGateDef[] = [
  {
    orgId: ORG_LSPD_ID,
    orgIds: BARRIER_ORG_IDS,
    model: 968,
    x: 1544.69019,
    y: -1630.83936,
    zClosed: 13.0765,
    zOpen: 13.0765,
    rx: 0,
    ry: 90,
    ryOpen: 0,
    rz: 90,
    radius: 14,
    denyMessage: BARRIER_DENY,
  },
  {
    orgId: ORG_LSPD_ID,
    orgIds: LAW_ORG_IDS,
    model: 19912,
    x: 1596.14673,
    y: -1637.87109,
    zClosed: 15.0741,
    zOpen: 9.5761,
    rx: 0,
    ry: 0,
    rz: 0,
    radius: 14,
    denyMessage: GARAGE_DENY,
  },
];

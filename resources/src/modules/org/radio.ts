import { defineGovOrg, defineRanks } from "./define";
import type { OrgGateDef } from "./types";

export const ORG_RADIO_ID = 8;
/** 广播中心自定义室内.街道和屋顶仍使用 VW 0. */
export const RADIO_WORLD = 8;
export const RADIO_INTERIOR = 0;

export const RADIOCENTR = defineGovOrg(
  ORG_RADIO_ID,
  "广播中心",
  0xff8c00ff,
  {
    x: 1429.5406,
    y: 1071.8772,
    z: 1058.7916,
    angle: 154.0138,
    interior: RADIO_INTERIOR,
    world: RADIO_WORLD,
  },
  defineRanks([
    { title: "编辑助理", male: 250, female: 93, pay: 1700 },
    { title: "新闻排版员", male: 250, female: 93, pay: 2200 },
    { title: "无线电技术员", male: 60, female: 93, pay: 2800 },
    { title: "记者", male: 60, female: 93, pay: 3500 },
    { title: "高级记者", male: 170, female: 211, pay: 4300 },
    { title: "校对员", male: 188, female: 211, pay: 5200 },
    { title: "副编辑", male: 188, female: 211, pay: 6300 },
    { title: "编辑", male: 187, female: 211, pay: 7600 },
    { title: "主编", male: 227, female: 211, pay: 9100 },
    { title: "广播中心主任", male: 228, female: 150, pay: 11000 },
  ])
);

export const RADIO_GATES: OrgGateDef[] = [
  {
    orgId: ORG_RADIO_ID,
    model: 968,
    x: 1739.44507,
    y: -1309.9248,
    zClosed: 13.4962,
    zOpen: 13.4962,
    rx: 0,
    ry: 90,
    ryOpen: 0,
    rz: 11.4037,
    radius: 14,
    denyMessage: "你不属于广播中心.",
  },
];

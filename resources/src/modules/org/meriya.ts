import type { OrganizationDef, OrgRankDef } from "./types";
import { MAX_ORG_RANK } from "./types";

export const ORG_MERIYA_ID = 3;
/** 市政厅中的“律师”等级 (用于 `/advokats`). */
export const MERIYA_ADVOKAT_RANK = 5;

const MERIYA_COLOR = 0xffff00ff;
/** 市政厅自定义室内 (`maps/cityhall.txt`): interior 0, VW = org id. */
export const MERIYA_WORLD = ORG_MERIYA_ID;
export const MERIYA_CUSTOM_INTERIOR = 0;

function meriyaRanks(): OrgRankDef[] {
  const rows: Array<{ title: string; male: number; female: number; pay: number }> = [
    { title: "保安", male: 164, female: 141, pay: 2500 },
    { title: "秘书", male: 185, female: 141, pay: 3300 },
    { title: "高级秘书", male: 59, female: 141, pay: 4200 },
    { title: "保安主管", male: 165, female: 141, pay: 5300 },
    { title: "律师", male: 57, female: 141, pay: 6600 },
    { title: "议员助理", male: 98, female: 76, pay: 8100 },
    { title: "顾问", male: 227, female: 76, pay: 9800 },
    { title: "议员", male: 187, female: 76, pay: 11800 },
    { title: "副市长", male: 17, female: 76, pay: 14200 },
    { title: "市长", male: 147, female: 150, pay: 17000 },
  ];

  return rows.map((row, index) => ({
    id: index + 1,
    title: row.title,
    pay: row.pay,
    skins: { male: row.male, female: row.female },
  }));
}

export const MERIYA: OrganizationDef = {
  id: ORG_MERIYA_ID,
  name: "市政厅",
  color: MERIYA_COLOR,
  gov: true,
  illegal: false,
  spawn: {
    x: -772.7266,
    y: -674.1481,
    z: 4001.0859,
    angle: 89.9524,
    interior: MERIYA_CUSTOM_INTERIOR,
    world: MERIYA_WORLD,
  },
  ranks: meriyaRanks(),
};

if (MERIYA.ranks.length !== MAX_ORG_RANK) {
  throw new Error("市政厅: 需要 10 个等级");
}

if (MERIYA.ranks[MERIYA_ADVOKAT_RANK - 1]?.title !== "律师") {
  throw new Error("市政厅：MERIYA_ADVOKAT_RANK 必须指向“律师”等级");
}

import { HOSPITAL_WORLD } from "../spawn/point";
import type { OrganizationDef, OrgGateDef, OrgRankDef } from "./types";
import { MAX_ORG_RANK } from "./types";

export const ORG_HOSPITAL_ID = 2;

const HOSPITAL_COLOR = 0xff7a8aff;
const FEMALE_SKIN = 170;

function hospitalRanks(): OrgRankDef[] {
  const rows: Array<{ title: string; male: number; pay: number }> = [
    { title: "实习医生", male: 274, pay: 1800 },
    { title: "初级医护人员", male: 274, pay: 2300 },
    { title: "高级医护人员", male: 70, pay: 2900 },
    { title: "社区医生", male: 71, pay: 3600 },
    { title: "内科医生", male: 71, pay: 4400 },
    { title: "外科医生", male: 276, pay: 5400 },
    { title: "科室主任", male: 275, pay: 6500 },
    { title: "高级住院医师", male: 275, pay: 7700 },
    { title: "副院长", male: 70, pay: 9000 },
    { title: "院长", male: 70, pay: 10800 },
  ];

  return rows.map((row, index) => ({
    id: index + 1,
    title: row.title,
    pay: row.pay,
    skins: { male: row.male, female: FEMALE_SKIN },
  }));
}

export const HOSPITAL: OrganizationDef = {
  id: ORG_HOSPITAL_ID,
  name: "医院",
  color: HOSPITAL_COLOR,
  gov: true,
  illegal: false,
  spawn: {
    x: 1158.3802,
    y: -1349.3069,
    z: 3001.0845,
    angle: 89.0324,
    interior: 0,
    world: HOSPITAL_WORLD,
  },
  ranks: hospitalRanks(),
};

if (HOSPITAL.ranks.length !== MAX_ORG_RANK) {
  throw new Error("医院: 需要 10 个等级");
}

export const HOSPITAL_GATES: OrgGateDef[] = [
  {
    orgId: ORG_HOSPITAL_ID,
    model: 19912,
    x: 1148.72375,
    y: -1290.95996,
    zClosed: 15.3248,
    zOpen: 9.7632,
    rx: 0,
    ry: 0,
    rz: 0,
    radius: 14,
    denyMessage: "你不属于医院.",
  },
];

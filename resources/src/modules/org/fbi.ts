import { defineGovOrg, defineRanks } from "./define";

export const ORG_FBI_ID = 6;
/** FBI 自定义室内 (`maps/fbi.txt`): interior 0, VW = org id. */
export const FBI_WORLD = ORG_FBI_ID;
export const FBI_INTERIOR = 0;

export const FBI = defineGovOrg(
  ORG_FBI_ID,
  "FBI",
  0x000080ff,
  {
    x: 668.7235,
    y: 2560.2925,
    z: -89.4551,
    angle: 177.9197,
    interior: FBI_INTERIOR,
    world: FBI_WORLD,
  },
  defineRanks([
    { title: "实习生", male: 286, female: 306, pay: 2200 },
    { title: "初级特工", male: 286, female: 306, pay: 2800 },
    { title: "缉毒部门特工", male: 164, female: 306, pay: 3500 },
    { title: "特别行动部门特工", male: 163, female: 306, pay: 4300 },
    { title: "高级特工", male: 303, female: 306, pay: 5200 },
    { title: "缉毒部门主管", male: 304, female: 306, pay: 6200 },
    { title: "特别行动部门主管", male: 305, female: 306, pay: 7400 },
    { title: "FBI 督察", male: 166, female: 306, pay: 8800 },
    { title: "FBI 副局长", male: 165, female: 306, pay: 10500 },
    { title: "FBI 局长", male: 295, female: 76, pay: 13000 },
  ])
);

import { defineRanks } from "./define";

export const POLICE_COLOR = 0x2641feff;

export const POLICE_RANKS = defineRanks([
  { title: "列兵", male: 266, female: 307, pay: 2000 },
  { title: "中士", male: 284, female: 307, pay: 2500 },
  { title: "高级中士", male: 267, female: 307, pay: 3100 },
  { title: "中尉", male: 280, female: 307, pay: 3800 },
  { title: "中尉", male: 281, female: 306, pay: 4600 },
  { title: "上尉", male: 282, female: 306, pay: 5500 },
  { title: "少校", male: 311, female: 306, pay: 6500 },
  { title: "中校", male: 310, female: 306, pay: 7700 },
  { title: "上校", male: 283, female: 306, pay: 9000 },
  { title: "将军", male: 288, female: 76, pay: 11000 },
]);

import type { ExamKind } from "./session";

export type ExamQuestion = {
  text: string;
  answers: readonly string[];
  correct: number;
};

export const EXAM_RULES =
  "交通规则简要说明：\n" +
  "1. 遇红灯必须完全停车。\n" +
  "2. 市区限速为 60 km/h。\n" +
  "3. 通过无优先权标志的路口时，应礼让右侧来车。\n" +
  "4. 禁止跨越实线超车。\n" +
  "5. 必须系安全带 / 戴头盔。\n\n" +
  "接下来有 5 道题，必须全部答对。\n" +
  "考试费用：$500。";

const CAR_QUESTIONS: readonly ExamQuestion[] = [
  {
    text: "遇到红灯时应该怎么做？",
    answers: ["停车", "加速通过", "鸣笛后继续行驶"],
    correct: 0,
  },
  {
    text: "市区最高限速是多少？",
    answers: ["120 km/h", "60 km/h", "200 km/h"],
    correct: 1,
  },
  {
    text: "通过无优先权标志的路口时，应礼让哪一方？",
    answers: ["左侧来车", "无需礼让", "右侧来车"],
    correct: 2,
  },
  {
    text: "可以跨越实线超车吗？",
    answers: ["不可以", "可以", "仅限夜间"],
    correct: 0,
  },
  {
    text: "必须系安全带吗？",
    answers: ["不需要", "仅在公路上需要", "需要，必须系好"],
    correct: 2,
  },
];

const MOTO_QUESTIONS: readonly ExamQuestion[] = [
  {
    text: "遇到红灯时应该怎么做？",
    answers: ["停车", "从路肩绕行", "没有其他车辆时通过"],
    correct: 0,
  },
  {
    text: "骑摩托车时必须戴头盔吗？",
    answers: ["不需要", "需要，必须佩戴", "仅在市区外需要"],
    correct: 1,
  },
  {
    text: "可以在车道之间穿行吗？",
    answers: ["可以，任何时候都可以", "仅限空旷的高速公路", "不可以"],
    correct: 2,
  },
  {
    text: "市区最高限速是多少？",
    answers: ["60 km/h", "140 km/h", "没有限速"],
    correct: 0,
  },
  {
    text: "可以跨越实线超车吗？",
    answers: ["可以，摩托车可以", "不可以", "仅限从右侧超车"],
    correct: 1,
  },
];

export function examQuestions(kind: ExamKind): readonly ExamQuestion[] {
  return kind === "car" ? CAR_QUESTIONS : MOTO_QUESTIONS;
}

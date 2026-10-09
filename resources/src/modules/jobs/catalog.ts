import { byGender, type Gender } from "../auth/gender";

export const JOB_NONE = 0;
export const JOB_BUS_DRIVER = 1;

export type JobDef = {
  id: number;
  /** 在证件、统计和招聘中心中显示的名称。 */
  title: string;
  /** 入职所需的最低角色等级。 */
  minLevel: number;
};

const JOBS: readonly JobDef[] = [
  { id: JOB_BUS_DRIVER, title: "公交车司机", minLevel: 2 },
];

const byId = new Map(JOBS.map((job) => [job.id, job]));

export function getJob(jobId: number): JobDef | null {
  return byId.get(jobId) ?? null;
}

export function isKnownJobId(jobId: number): boolean {
  return jobId === JOB_NONE || byId.has(jobId);
}

/** 根据性别生成证件和统计页面中的职业名称。 */
export function jobLabel(jobId: number, gender: Gender | null): string {
  if (jobId === JOB_NONE || !byId.has(jobId)) {
    return byGender(gender, "无业", "无业");
  }

  return byId.get(jobId)!.title;
}

/**
 * TABLIST_HEADERS 对话框正文。
 * listItem 0 表示辞职；1 及以上表示目录中的工作。
 */
export function jobHireDialogBody(): string {
  return [
    "工作\t等级",
    "辞去工作\t—",
    ...JOBS.map((job) => `${job.title}\t${job.minLevel}级`),
  ].join("\n");
}

/** listItem 0 表示辞职；1 及以上表示目录中的工作。 */
export function jobIdFromHireListItem(listItem: number): number | null {
  if (!Number.isInteger(listItem) || listItem < 0) {
    return null;
  }
  if (listItem === 0) {
    return JOB_NONE;
  }
  const job = JOBS[listItem - 1];
  return job?.id ?? null;
}

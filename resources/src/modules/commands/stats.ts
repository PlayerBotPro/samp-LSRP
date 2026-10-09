import { Dialog, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { formatBirthDate } from "../auth/validation";
import { genderLabel } from "../auth/gender";
import { MAX_HUNGER, getAccount, normalizeHunger } from "../auth/session";
import { residenceLabel } from "../houses/residence";
import { businessOwnershipLabel } from "../businesses/ownership";
import { jobLabel } from "../jobs";
import { getMembership, resolvePlayerSkin } from "../org";
import { expForNextLevel } from "../payday/progress";

export const STATS_DIALOG_ID = 2;
const DIALOG_STYLE_MSGBOX = 0;
const TITLE = "{FFCC00}";
const LABEL = "{FFFFFF}";
const VALUE = "{33CCFF}";

/** 统计：查看自己（通过 /mn）或其他玩家（管理员 /stats）。 */
export function showStatsDialog(viewer: Player, target?: Player): void {
  const subject = target ?? viewer;
  const account = getAccount(subject);
  if (!account) {
    viewer.sendClientMessage(Color.error, "请先登录账号。");
    return;
  }

  let health = Math.round(account.health);
  try {
    const live = subject.getHealth();
    if (live > 0) {
      health = Math.round(live);
    }
  } catch {
    // 世界统计数据不可用，将显示账号信息。
  }

  const membership = getMembership(account);
  const rank = membership
    ? `${membership.rank.title} (${membership.rank.id})`
    : "无";
  const body = [
    statsRow("姓名", account.name),
    statsRow("住所", residenceLabel(account.id)),
    statsRow("企业", businessOwnershipLabel(account.id)),
    statsRow("性别", genderLabel(account.gender)),
    statsRow("等级", String(account.level)),
    statsRow("经验", `${account.exp}/${expForNextLevel(account.level)}`),
    statsRow("守法值", String(account.lawfulness)),
    statsRow("皮肤", String(resolvePlayerSkin(account))),
    statsRow("出生日期", formatBirthDate(account.birthDate)),
    statsRow("邮箱", account.email),
    statsRow("现金", formatMoney(account.money)),
    statsRow("银行", formatMoney(account.bank)),
    statsRow("捐赠账户", String(account.donate)),
    statsRow("毒品", `${account.drugs} 件`),
    statsRow("弹药", `${account.ammo} 件`),
    statsRow("金属", `${account.metal} 件`),
    statsRow("通缉等级", String(account.wantedLevel)),
    statsRow("军人证", account.militaryId ? "有" : "无"),
    statsRow("医疗卡", account.medcard ? "有" : "无"),
    statsRow("健康", String(health)),
    statsRow("饥饿值", `${normalizeHunger(account.hunger)}/${MAX_HUNGER}`),
    statsRow("组织", membership?.org.name ?? "无"),
    statsRow("职位", rank),
    statsRow("职业", jobLabel(account.jobId, account.gender)),
  ].join("\n");

  try {
    Dialog.show(
      viewer,
      STATS_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}统计 ${account.name}`,
      body,
      "关闭",
      ""
    );
  } catch {
    viewer.sendClientMessage(Color.error, "无法打开统计信息。");
  }
}

function statsRow(label: string, value: string): string {
  return `${LABEL}${label}:\t\t${VALUE}${value}`;
}

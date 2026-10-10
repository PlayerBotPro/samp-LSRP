import { Dialog, omp } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { getAccount } from "../auth/session";
import { MAX_ORG_RANK, getMembership } from "../org";
import { registerCommand } from "./registry";
import { afkStatusSuffix } from "./status-tags";

export const LEADERS_DIALOG_ID = 126;

const DIALOG_STYLE_MSGBOX = 0;

type OnlineLeader = {
  line: string;
  orgName: string;
  slot: number;
};

registerCommand("leaders", "在线领导者列表", (player) => {
  const list: OnlineLeader[] = [];

  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      if (other.isNPC()) {
        return;
      }
    } catch {
      return;
    }

    const account = getAccount(other);
    if (!account) {
      return;
    }

    const membership = getMembership(account);
    if (!membership || membership.rank.id !== MAX_ORG_RANK) {
      return;
    }

    const phone = account.phone ? ` | 电话:${account.phone}` : "";
    const afk = afkStatusSuffix(other);
    list.push({
      orgName: membership.org.name,
      slot: playerId(other) ?? 0,
      line: `${playerChatName(other)} | ${membership.org.name} | ${membership.rank.title}${phone}${afk}`,
    });
  });

  list.sort((a, b) => a.orgName.localeCompare(b.orgName) || a.slot - b.slot);

  if (list.length === 0) {
    player.sendClientMessage(Color.white, "目前没有组织领导在线.");
    return;
  }

  const lines = list.map((row) => row.line);
  const body = `在线人数:${list.length}\n\n${lines.join("\n")}`;

  try {
    Dialog.show(
      player,
      LEADERS_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "在线领导者",
      body,
      "OK",
      ""
    );
  } catch {
    for (const line of lines) {
      player.sendClientMessage(Color.white, line);
    }
  }
});

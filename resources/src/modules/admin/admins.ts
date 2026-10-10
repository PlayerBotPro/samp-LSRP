import { omp } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { getAccount } from "../auth/session";
import { registerCommand } from "../commands/registry";
import { afkStatusSuffix } from "../commands/status-tags";
import { hasAdminAccess, isAdminLoggedIn } from "./session";
import { getAdminSpectateTarget } from "./spectate";

type OnlineAdmin = {
  line: string;
  level: number;
  slot: number;
};

export function bindAdminsList(): void {
  registerCommand(
    "admins",
    "在线管理员列表",
    (player) => {
      if (!hasAdminAccess(player, 1)) {
        return;
      }

      const list: OnlineAdmin[] = [];

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
        if (!account || account.adminLevel < 1) {
          return;
        }

        const slot = playerId(other) ?? 0;
        const logged = isAdminLoggedIn(other) ? "是" : "否";
        const afk = afkStatusSuffix(other, true);
        const specTarget = getAdminSpectateTarget(other);
        const spec =
          specTarget !== null ? ` | sp > ${specTarget}` : "";
        list.push({
          level: account.adminLevel,
          slot,
          line: `${playerChatName(other)} | ${account.adminLevel} lvl | alogin: ${logged}${afk}${spec}`,
        });
      });

      list.sort((a, b) => b.level - a.level || a.slot - b.slot);

      player.sendClientMessage(Color.info, "游戏中的管理员:");
      if (list.length === 0) {
        player.sendClientMessage(Color.white, "没有人.");
        return;
      }

      for (const row of list) {
        player.sendClientMessage(Color.white, row.line);
      }
    },
    true
  );
}

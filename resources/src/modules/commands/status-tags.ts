import type { Player } from "@omp-node/core";
import {
  formatAfkElapsed,
  getAfkElapsedMs,
  isPlayerAfk,
} from "../afk";
import { getAccount } from "../auth/session";
import { isJailed } from "../prison/sentence";

/** 后缀 ` | AFK` 或 ` | AFK 12 分 05 秒`. */
export function afkStatusSuffix(player: Player, withTime = false): string {
  if (!isPlayerAfk(player)) {
    return "";
  }

  if (!withTime) {
    return " | AFK";
  }

  const ms = getAfkElapsedMs(player);
  if (ms === null) {
    return " | AFK";
  }

  return ` | AFK ${formatAfkElapsed(ms)}`;
}

/** 后缀 ` | AFK | Jail | Mute`,仅显示当前生效的状态标记. */
export function memberStatusSuffix(player: Player): string {
  const parts: string[] = [];
  if (isPlayerAfk(player)) {
    parts.push("AFK");
  }
  if (isJailed(player)) {
    parts.push("Jail");
  }
  if (isMutedNow(player)) {
    parts.push("Mute");
  }

  return parts.length > 0 ? ` | ${parts.join(" | ")}` : "";
}

/** 不触发 expireMute 副作用,列表不应解除禁言. */
function isMutedNow(player: Player): boolean {
  const until = getAccount(player)?.mutedUntil;
  if (until == null) {
    return false;
  }

  return until > Date.now();
}

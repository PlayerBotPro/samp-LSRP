import type { Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CHAT_RADIUS, sendNearby } from "../../shared/nearby";
import { playerName } from "../../shared/player";
import { byGender, type Gender } from "../auth/gender";
import { isCuffed } from "../cuff";
import { isLoaderCarrying } from "../loader";
import { isMinerLocked } from "../miner";

const PLAYER_STATE_ONFOOT = 1;
const ANIM_SYNC_ALL = 1;
const BUBBLE_MS = 4000;

type EmotionAnim = {
  lib: string;
  name: string;
};

type Emotion = {
  trigger: string;
  status: (gender: Gender | null) => string;
  anim?: EmotionAnim;
};

/** 较长的触发符应排在较短的前面（先匹配 `))`，再匹配 `)`）。 */
const EMOTIONS: Emotion[] = [
  {
    trigger: "))",
    status: () => "大笑",
  },
  {
    trigger: "((",
    status: (gender) =>
      byGender(gender, "非常沮丧", "非常沮丧"),
    anim: { lib: "GRAVEYARD", name: "mrnF_loop" },
  },
  {
    trigger: ")",
    status: () => "微笑",
  },
  {
    trigger: "(",
    status: (gender) => byGender(gender, "沮丧", "沮丧"),
  },
  {
    trigger: "=0",
    status: (gender) => byGender(gender, "惊讶", "惊讶"),
  },
];

function canPlayEmotionAnim(player: Player): boolean {
  try {
    // 手铐状态下，applyAnimation 会重置 cpr_loop 冻结姿势。
    if (
      isCuffed(player) ||
      player.isInAnyVehicle() ||
      isMinerLocked(player) ||
      isLoaderCarrying(player)
    ) {
      return false;
    }

    return player.getState() === PLAYER_STATE_ONFOOT;
  } catch {
    return false;
  }
}

/**
 * 聊天中的精确 IC 情绪触发符：`)`、`))`、`(`、`((`、`=0`。
 * 附近玩家会像 `/me`（`Color.action`）一样看到动作消息和头顶气泡。
 */
export function tryChatEmotion(
  player: Player,
  text: string,
  gender: Gender | null
): boolean {
  const key = text.toLowerCase();
  const emotion = EMOTIONS.find((entry) => entry.trigger === key);
  if (!emotion) {
    return false;
  }

  const status = emotion.status(gender);
  sendNearby(player, CHAT_RADIUS, Color.action, `${playerName(player)} ${status}`);

  try {
    player.setChatBubble(status, Color.action, CHAT_RADIUS, BUBBLE_MS);
  } catch {
    // 聊天气泡不是必需的。
  }

  if (emotion.anim && canPlayEmotionAnim(player)) {
    try {
      player.applyAnimation(
        emotion.anim.lib,
        emotion.anim.name,
        4.1,
        false,
        false,
        false,
        false,
        0,
        ANIM_SYNC_ALL
      );
    } catch {
      // 动画是可选的。
    }
  }

  return true;
}

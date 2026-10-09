import { Color } from "../../shared/colors";
import { getAccount } from "../auth/session";
import {
  getOwnedMasks,
  isMasked,
  MASK_DURATION_MINUTES,
  removeMask,
  wearMask,
} from "../mask";
import { isJailed } from "../prison/sentence";
import { registerCommand } from "./registry";

registerCommand("mask", "Надеть или снять маску", (player) => {
  const account = getAccount(player);
  if (!account) {
    player.sendClientMessage(Color.error, "请先登录账号。");
    return;
  }

  if (isMasked(player)) {
    removeMask(player);
    player.sendClientMessage(Color.gray, "你摘下了面具。");
    return;
  }

  if (account.hospitalized) {
    player.sendClientMessage(
      Color.error,
      "请先在医院完成治疗。"
    );
    return;
  }

  if (isJailed(player)) {
    player.sendClientMessage(Color.error, "在监狱里不能戴面具。");
    return;
  }

  const have = getOwnedMasks(player);
  if (have < 1) {
    player.sendClientMessage(
      Color.error,
      "你没有面具。请在 24/7 商店购买。"
    );
    return;
  }

  if (!wearMask(player)) {
    player.sendClientMessage(Color.error, "无法戴上面具。");
    return;
  }

  player.sendClientMessage(
    Color.tryOk,
    `你已戴上面具 ${MASK_DURATION_MINUTES} 分钟。剩余面具数量: ${have - 1}.`
  );
});

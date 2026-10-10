import { Color } from "../../shared/colors";
import { CHAT_RADIUS, WHISPER_RADIUS, arePlayersNearby, sendNearby } from "../../shared/nearby";
import { playerName } from "../../shared/player";
import { byGender } from "../auth/gender";
import { getAccount } from "../auth/session";
import { applyCuff, clearCuff, isCuffed } from "../cuff";
import { isJailed } from "../prison/sentence";
import { resolveLawNearbyTarget } from "./law-target";
import { registerCommand } from "./registry";

registerCommand("cuff", "给玩家戴上手铐(警察 / FBI)", (player, args) => {
  const resolved = resolveLawNearbyTarget(
    player,
    args,
    "用法: /cuff [id]"
  );
  if (!resolved.ok) {
    return;
  }

  const { officer, target } = resolved;

  if (isJailed(target)) {
    officer.sendClientMessage(Color.error, "玩家已经在监狱里.");
    return;
  }

  if (isCuffed(target)) {
    officer.sendClientMessage(Color.error, "玩家已经戴上手铐.");
    return;
  }

  // 再次检查:目标可能在两次检查之间离开.
  if (!arePlayersNearby(officer, target, WHISPER_RADIUS)) {
    officer.sendClientMessage(Color.error, "玩家距离太远.");
    return;
  }

  if (!applyCuff(target)) {
    officer.sendClientMessage(Color.error, "无法给玩家戴上手铐.");
    return;
  }

  const officerName = playerName(officer);
  const targetName = playerName(target);
  const verb = byGender(
    getAccount(officer)?.gender ?? null,
    "戴上了",
    "戴上了"
  );

  sendNearby(
    officer,
    CHAT_RADIUS,
    Color.action,
    `${officerName} 为 ${targetName} 戴上了手铐.`
  );

  officer.sendClientMessage(Color.info, `你给 ${targetName} 戴上了手铐.`);
  try {
    target.sendClientMessage(Color.error, "你被戴上了手铐.");
  } catch {
    // 已离线.
  }
});

registerCommand("uncuff", "给玩家解开手铐(警察 / FBI)", (player, args) => {
  const resolved = resolveLawNearbyTarget(
    player,
    args,
    "用法: /uncuff [id]"
  );
  if (!resolved.ok) {
    return;
  }

  const { officer, target } = resolved;

  if (!isCuffed(target)) {
    officer.sendClientMessage(Color.error, "玩家没有戴手铐.");
    return;
  }

  if (!arePlayersNearby(officer, target, WHISPER_RADIUS)) {
    officer.sendClientMessage(Color.error, "玩家距离太远.");
    return;
  }

  if (!clearCuff(target)) {
    officer.sendClientMessage(Color.error, "无法给玩家解开手铐.");
    return;
  }

  const officerName = playerName(officer);
  const targetName = playerName(target);
  const verb = byGender(
    getAccount(officer)?.gender ?? null,
    "摘下了",
    "摘下了"
  );

  sendNearby(
    officer,
    CHAT_RADIUS,
    Color.action,
    `${officerName} 解开了 ${targetName} 的手铐.`
  );

  officer.sendClientMessage(Color.info, `你解开了 ${targetName} 的手铐.`);
  try {
    target.sendClientMessage(Color.info, "你的手铐已被解开.");
  } catch {
    // 已离线.
  }
});

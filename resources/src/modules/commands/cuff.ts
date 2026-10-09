import { Color } from "../../shared/colors";
import { CHAT_RADIUS, WHISPER_RADIUS, arePlayersNearby, sendNearby } from "../../shared/nearby";
import { playerName } from "../../shared/player";
import { byGender } from "../auth/gender";
import { getAccount } from "../auth/session";
import { applyCuff, clearCuff, isCuffed } from "../cuff";
import { isJailed } from "../prison/sentence";
import { resolveLawNearbyTarget } from "./law-target";
import { registerCommand } from "./registry";

registerCommand("cuff", "Надеть наручники (полиция / FBI)", (player, args) => {
  const resolved = resolveLawNearbyTarget(
    player,
    args,
    "Использование: /cuff [id]"
  );
  if (!resolved.ok) {
    return;
  }

  const { officer, target } = resolved;

  if (isJailed(target)) {
    officer.sendClientMessage(Color.error, "玩家已经在监狱里。");
    return;
  }

  if (isCuffed(target)) {
    officer.sendClientMessage(Color.error, "玩家已经戴上手铐。");
    return;
  }

  // Повторно: цель могла отойти между проверками.
  if (!arePlayersNearby(officer, target, WHISPER_RADIUS)) {
    officer.sendClientMessage(Color.error, "玩家距离太远。");
    return;
  }

  if (!applyCuff(target)) {
    officer.sendClientMessage(Color.error, "无法给玩家戴上手铐。");
    return;
  }

  const officerName = playerName(officer);
  const targetName = playerName(target);
  const verb = byGender(
    getAccount(officer)?.gender ?? null,
    "надел",
    "надела"
  );

  sendNearby(
    officer,
    CHAT_RADIUS,
    Color.action,
    `${officerName} ${verb} наручники на ${targetName}.`
  );

  officer.sendClientMessage(Color.info, `你给 ${targetName} 戴上了手铐。`);
  try {
    target.sendClientMessage(Color.error, "你被戴上了手铐。");
  } catch {
    // Уже вышел.
  }
});

registerCommand("uncuff", "Снять наручники (полиция / FBI)", (player, args) => {
  const resolved = resolveLawNearbyTarget(
    player,
    args,
    "Использование: /uncuff [id]"
  );
  if (!resolved.ok) {
    return;
  }

  const { officer, target } = resolved;

  if (!isCuffed(target)) {
    officer.sendClientMessage(Color.error, "玩家没有戴手铐。");
    return;
  }

  if (!arePlayersNearby(officer, target, WHISPER_RADIUS)) {
    officer.sendClientMessage(Color.error, "玩家距离太远。");
    return;
  }

  if (!clearCuff(target)) {
    officer.sendClientMessage(Color.error, "无法给玩家解开手铐。");
    return;
  }

  const officerName = playerName(officer);
  const targetName = playerName(target);
  const verb = byGender(
    getAccount(officer)?.gender ?? null,
    "снял",
    "сняла"
  );

  sendNearby(
    officer,
    CHAT_RADIUS,
    Color.action,
    `${officerName} ${verb} наручники с ${targetName}.`
  );

  officer.sendClientMessage(Color.info, `你解开了 ${targetName} 的手铐。`);
  try {
    target.sendClientMessage(Color.info, "你的手铐已被解开。");
  } catch {
    // Уже вышел.
  }
});

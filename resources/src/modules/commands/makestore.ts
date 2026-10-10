import type { Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { playerId } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { findOwnedHouseAtInterior } from "../houses/interior";
import {
  hasHouseStore,
  saveHouseStorePosition,
  setHouseStorePosition,
} from "../houses/repository";
import { ensureHouseStoreLabel } from "../houses/store-display";
import { isJailed } from "../prison/sentence";
import { registerCommand } from "./registry";

const PLAYER_STATE_ONFOOT = 1;
const busy = new Set<number>();

registerCommand(
  "makestore",
  "在自己家中放置或移动储物柜",
  (player) => {
    void handleMakeStore(player);
  }
);

async function handleMakeStore(player: Player): Promise<void> {
  if (!isAuthenticated(player)) {
    player.sendClientMessage(Color.error, "请先登录账号.");
    return;
  }

  const account = getAccount(player);
  const slot = playerId(player);
  if (!account || slot === null) {
    return;
  }

  if (busy.has(slot)) {
    player.sendClientMessage(Color.error, "请等待操作完成.");
    return;
  }

  if (isJailed(player)) {
    player.sendClientMessage(Color.error, "在监狱里无法使用此命令.");
    return;
  }

  if (account.hospitalized) {
    player.sendClientMessage(Color.error, "请先在医院完成治疗.");
    return;
  }

  try {
    if (player.getState() !== PLAYER_STATE_ONFOOT) {
      player.sendClientMessage(Color.error, "必须步行.");
      return;
    }
  } catch {
    return;
  }

  const house = findOwnedHouseAtInterior(player);
  if (!house) {
    player.sendClientMessage(
      Color.error,
      "只能在自己的房屋内放置衣柜."
    );
    return;
  }

  let x = 0;
  let y = 0;
  let z = 0;
  try {
    const pos = player.getPos();
    x = pos.x;
    y = pos.y;
    z = pos.z;
  } catch {
    return;
  }

  const relocating = hasHouseStore(house);

  busy.add(slot);
  try {
    const ok = await saveHouseStorePosition(house.id, account.id, x, y, z);
    if (!ok) {
      player.sendClientMessage(Color.error, "无法保存衣柜.");
      return;
    }

    setHouseStorePosition(house.id, x, y, z);
    ensureHouseStoreLabel(house.id);

    player.sendClientMessage(
      Color.info,
      relocating
        ? "你已移动衣柜.管理: /use"
        : "衣柜已放置.管理: /use"
    );
  } finally {
    busy.delete(slot);
  }
}

import { Checkpoint, omp, TextLabel, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import {
  AZTECAS_WORLD,
  BALLAS_WORLD,
  GROVE_WORLD,
  ORG_AZTECAS_ID,
  ORG_BALLAS_ID,
  ORG_GROVE_ID,
  ORG_RIFA_ID,
  ORG_VAGOS_ID,
  RIFA_WORLD,
  VAGOS_WORLD,
} from "../org";
import { getWarehouse } from "./repository";
import { notifyOrgStockStanding } from "./stock-interact";
import { clearOrgStockVisit } from "./stock-visit";

const LABEL_HEIGHT = 1.2;
const LABEL_DRAW_DISTANCE = 12;
const CHECKPOINT_RADIUS = 1.5;
/** 离开标记点(半径稍大,避免在边界反复触发). */
const LEAVE_RADIUS = 2.8;
const SHOW_DISTANCE = 45;
const TICK_MS = 400;

type GangStockDef = {
  orgId: number;
  world: number;
  interior: number;
  x: number;
  y: number;
  z: number;
};

type GangStock = GangStockDef & {
  label: TextLabel;
};

/** 帮派出生点中的总部室内;仓库点单独设置. */
const GANG_STOCK_DEFS: readonly GangStockDef[] = [
  {
    orgId: ORG_AZTECAS_ID,
    world: AZTECAS_WORLD,
    interior: 2,
    x: 217.6411,
    y: 1251.2827,
    z: 1082.1481,
  },
  {
    orgId: ORG_BALLAS_ID,
    world: BALLAS_WORLD,
    interior: 4,
    x: 227.901,
    y: 1155.7843,
    z: 1082.6094,
  },
  {
    orgId: ORG_VAGOS_ID,
    world: VAGOS_WORLD,
    interior: 5,
    x: 331.0317,
    y: 1128.7417,
    z: 1083.8828,
  },
  {
    orgId: ORG_RIFA_ID,
    world: RIFA_WORLD,
    interior: 6,
    x: -71.2803,
    y: 1365.8115,
    z: 1080.2185,
  },
  {
    orgId: ORG_GROVE_ID,
    world: GROVE_WORLD,
    interior: 2,
    x: 2455.6848,
    y: -1706.2021,
    z: 1013.5078,
  },
];

const stocks: GangStock[] = [];
const checkpointShown = new Set<number>();
const activeStockByPlayer = new Map<number, GangStockDef>();

function stockLabelText(orgId: number): string {
  const wh = getWarehouse(orgId);
  const ammo = wh?.ammo ?? 0;
  const metal = wh?.metal ?? 0;
  const drugs = wh?.drugs ?? 0;
  const status = wh && !wh.isLocked ? "仓库已开放" : "仓库已关闭";
  return `子弹:${ammo}\n金属:${metal}\n毒品:${drugs}\n\n${status}`;
}

export function startGangWarehouseDisplays(): void {
  for (const def of GANG_STOCK_DEFS) {
    const label = new TextLabel(
      stockLabelText(def.orgId),
      Color.info,
      def.x,
      def.y,
      def.z + LABEL_HEIGHT,
      LABEL_DRAW_DISTANCE,
      def.world,
      false
    );
    stocks.push({ ...def, label });
  }

  setInterval(tickGangWarehouseCheckpoints, TICK_MS);

  omp.on("playerDisconnect", (player) => {
    const id = playerId(player);
    if (id !== null) {
      checkpointShown.delete(id);
      activeStockByPlayer.delete(id);
    }
  });
}

export function refreshGangWarehouseLabels(): void {
  for (const stock of stocks) {
    try {
      stock.label.updateText(Color.info, stockLabelText(stock.orgId));
    } catch {
      // 标签已销毁.
    }
  }
}

/** 玩家处于检查点范围内时的帮派仓库点. */
export function findGangStockAtPlayer(player: Player): {
  orgId: number;
  x: number;
  y: number;
  z: number;
  world: number;
  interior: number;
} | null {
  try {
    const world = player.getVirtualWorld();
    const interior = player.getInterior();
    const pos = player.getPos();

    for (const def of GANG_STOCK_DEFS) {
      if (def.world !== world || def.interior !== interior) {
        continue;
      }

      const dist = Math.hypot(pos.x - def.x, pos.y - def.y, pos.z - def.z);
      if (dist <= LEAVE_RADIUS) {
        return def;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function tickGangWarehouseCheckpoints(): void {
  omp.players.forEach((player) => {
    updateCheckpointForPlayer(player);
  });
}

function findActiveStock(player: Player): GangStockDef | null {
  try {
    const world = player.getVirtualWorld();
    const interior = player.getInterior();
    const pos = player.getPos();

    for (const def of GANG_STOCK_DEFS) {
      if (def.world !== world || def.interior !== interior) {
        continue;
      }

      const dist = Math.hypot(pos.x - def.x, pos.y - def.y, pos.z - def.z);
      if (dist <= SHOW_DISTANCE) {
        return def;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function updateCheckpointForPlayer(player: Player): void {
  const id = playerId(player);
  if (id === null || !isPlayerActive(player)) {
    return;
  }

  const stock = findActiveStock(player);
  if (stock) {
    let onCheckpoint = false;
    try {
      const pos = player.getPos();
      const dist = Math.hypot(pos.x - stock.x, pos.y - stock.y, pos.z - stock.z);
      onCheckpoint = dist <= LEAVE_RADIUS;

      if (!checkpointShown.has(id)) {
        Checkpoint.set(player, stock.x, stock.y, stock.z, CHECKPOINT_RADIUS);
        checkpointShown.add(id);
      }
      activeStockByPlayer.set(id, stock);
    } catch {
      // 玩家已离开.
    }
    notifyOrgStockStanding(player, onCheckpoint);
    return;
  }

  // 不是我们的仓库,不处理 pending/visit(否则黑手党的定时检查会影响帮派,反之亦然).
  if (!checkpointShown.has(id)) {
    return;
  }

  checkpointShown.delete(id);
  activeStockByPlayer.delete(id);
  clearOrgStockVisit(player);
  notifyOrgStockStanding(player, false);
  try {
    Checkpoint.disable(player);
  } catch {
    // 玩家已离开.
  }
}

import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { registerCommand } from "../commands/registry";
import {
  getOrganization,
  ORG_ARMY_ID,
  ORG_FBI_ID,
  ORG_HOSPITAL_ID,
  ORG_LSPD_ID,
  ORG_POLICE_ID,
} from "../org";
import {
  getWarehouse,
  warehouseUsesLock,
  WAREHOUSE_IDS,
  WAREHOUSE_MINE_ID,
  type WarehouseRecord,
} from "../warehouse";
import { hasAdminAccess } from "./session";

export const WAREHOUSE_LIST_DIALOG_ID = 57;
export const WAREHOUSE_INFO_DIALOG_ID = 58;

const MIN_ADMIN_LEVEL = 5;
const DIALOG_STYLE_MSGBOX = 0;
const DIALOG_STYLE_LIST = 2;

const AMMO_ONLY_IDS = new Set<number>([
  ORG_ARMY_ID,
  ORG_POLICE_ID,
  ORG_LSPD_ID,
  ORG_FBI_ID,
]);

export function bindAdminWarehouse(): void {
  registerCommand(
    "warehouse",
    "组织仓库状态",
    (player) => {
      if (!hasAdminAccess(player, MIN_ADMIN_LEVEL)) {
        return;
      }

      showWarehouseList(player);
    },
    true
  );

  omp.on("dialogResponse", (player, dialogId, response, listItem, inputText) => {
    if (Number(dialogId) !== WAREHOUSE_LIST_DIALOG_ID) {
      return;
    }

    onListResponse(player, Number(response), Number(listItem), String(inputText ?? ""));
  });
}

function showWarehouseList(player: Player): void {
  const lines = WAREHOUSE_IDS.map((orgId, index) => `${index + 1}. ${warehouseName(orgId)}`);

  try {
    Dialog.show(
      player,
      WAREHOUSE_LIST_DIALOG_ID,
      DIALOG_STYLE_LIST,
      "仓库",
      lines.join("\n"),
      "选择",
      "取消"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开仓库列表。");
  }
}

function onListResponse(
  player: Player,
  response: number,
  listItem: number,
  inputText: string
): void {
  if (!hasAdminAccess(player, MIN_ADMIN_LEVEL) || response === 0) {
    return;
  }

  const orgId = pickWarehouseId(listItem, inputText);
  if (orgId === null) {
    return;
  }

  showWarehouseInfo(player, orgId);
}

function showWarehouseInfo(player: Player, orgId: number): void {
  const record = getWarehouse(orgId) ?? emptyRecord(orgId);

  try {
    Dialog.show(
      player,
      WAREHOUSE_INFO_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      warehouseName(orgId),
      formatWarehouseInfo(record),
      "关闭",
      ""
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开仓库。");
  }
}

function formatWarehouseInfo(record: WarehouseRecord): string {
  const lines: string[] = [];

  if (record.orgId === WAREHOUSE_MINE_ID) {
    lines.push(`金属：${record.metal}`);
  } else if (record.orgId === ORG_HOSPITAL_ID) {
    lines.push(`医疗用品：${record.meds}`);
  } else if (AMMO_ONLY_IDS.has(record.orgId)) {
    lines.push(`弹药：${record.ammo}`);
  } else if (warehouseUsesLock(record.orgId)) {
    lines.push(`弹药：${record.ammo}`);
    lines.push(`金属：${record.metal}`);
    lines.push(`毒品：${record.drugs}`);
    lines.push("");
    lines.push(record.isLocked ? "仓库已关闭" : "仓库已开启");
  } else {
    lines.push(`弹药：${record.ammo}`);
    lines.push(`医疗用品：${record.meds}`);
    lines.push(`金属：${record.metal}`);
    lines.push(`毒品：${record.drugs}`);
  }

  return lines.join("\n");
}

function warehouseName(orgId: number): string {
  if (orgId === WAREHOUSE_MINE_ID) {
    return "矿场";
  }

  return getOrganization(orgId)?.name ?? `仓库 #${orgId}`;
}

function pickWarehouseId(listItem: number, inputText: string): number | null {
  const byIndex = WAREHOUSE_IDS[listItem];
  if (byIndex !== undefined) {
    return byIndex;
  }

  const raw = inputText.replace(/^\d+\.\s*/, "").trim().toLowerCase();
  return (
    WAREHOUSE_IDS.find((id) => warehouseName(id).toLowerCase() === raw) ?? null
  );
}

function emptyRecord(orgId: number): WarehouseRecord {
  return {
    orgId,
    ammo: 0,
    meds: 0,
    metal: 0,
    drugs: 0,
    isLocked: warehouseUsesLock(orgId),
  };
}

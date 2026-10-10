import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { listCommands } from "./registry";

export const HELP_MENU_DIALOG_ID = 96;
export const HELP_LIST_DIALOG_ID = 97;

const DIALOG_STYLE_LIST = 2;
const DIALOG_STYLE_MSGBOX = 0;
const C_CMD = "{33FF33}";
const C_DESC = "{FFFFFF}";

type HelpCategory = {
  key: string;
  label: string;
  /** registry 中的命令名称(不含 /). */
  commands: readonly string[];
};

const CATEGORIES: readonly HelpCategory[] = [
  {
    key: "general",
    label: "常用命令",
    commands: [
      "mn",
      "time",
      "gps",
      "findidhouse",
      "findidbiz",
      "report",
      "pass",
      "lic",
      "vbilet",
      "medcard",
      "hospital",
      "leaders",
      "advokats",
      "ad",
      "pay",
      "id",
      "mask",
      "anim",
    ],
  },
  {
    key: "chat",
    label: "聊天",
    commands: ["me", "do", "try", "todo", "b", "s", "w"],
  },
  {
    key: "vehicles",
    label: "车辆管理",
    commands: ["lock", "car", "trunk", "limit", "eject", "unrent"],
  },
  {
    key: "houses",
    label: "房屋",
    commands: ["home", "heal", "sellhouse", "findidhouse", "makestore", "use"],
  },
  {
    key: "business",
    label: "企业",
    commands: ["buybiz", "biz", "findidbiz"],
  },
  {
    key: "gangs",
    label: "帮派与黑手党",
    commands: ["f", "capture", "makegun", "sellgun", "selldrug"],
  },
  {
    key: "org",
    label: "组织",
    commands: [
      "r",
      "d",
      "gov",
      "members",
      "clear",
      "su",
      "wanted",
      "pursuit",
      "unmask",
      "frisk",
      "take",
      "cuff",
      "uncuff",
      "putpl",
      "arrest",
      "demote",
      "selllic",
      "givemedcard",
      "medhelp",
      "givevbilet",
      "pickmed",
      "putammo",
      "takeammo",
      "pult",
      "edit",
    ],
  },
  {
    key: "leaders",
    label: "领导者",
    commands: ["invite", "uninvite", "rang"],
  },
  {
    key: "family",
    label: "家族",
    commands: [
      "family",
      "fam",
      "fmembers",
      "finvite",
      "funinvite",
      "frang",
    ],
  },
];

const menuState = new Map<number, string>();

export function bindHelpDialogs(): void {
  omp.on("dialogResponse", (player, dialogId, response, listItem) => {
    const id = Number(dialogId);
    if (id !== HELP_MENU_DIALOG_ID && id !== HELP_LIST_DIALOG_ID) {
      return;
    }

    const slotId = playerId(player);
    if (slotId === null) {
      return;
    }

    if (id === HELP_MENU_DIALOG_ID) {
      if (Number(response) === 0) {
        menuState.delete(slotId);
        return;
      }
      onHelpCategoryPick(player, Number(listItem));
      return;
    }

    // 命令列表: "返回" (1) / "关闭" (0)
    if (Number(response) === 0) {
      menuState.delete(slotId);
      return;
    }

    showHelpMenu(player);
  });

  omp.on("playerDisconnect", (player) => {
    const slotId = playerId(player);
    if (slotId !== null) {
      menuState.delete(slotId);
    }
  });
}

/** 命令分类菜单(从 `/mn` →"命令列表"进入). */
export function showHelpMenu(player: Player): void {
  if (!isPlayerActive(player)) {
    return;
  }

  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  menuState.set(slotId, "main");

  const lines = CATEGORIES.map((cat, index) => `${index + 1}. ${cat.label}`);

  try {
    Dialog.show(
      player,
      HELP_MENU_DIALOG_ID,
      DIALOG_STYLE_LIST,
      "命令列表",
      lines.join("\n"),
      "选择",
      "关闭"
    );
  } catch {
    menuState.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开命令列表.");
  }
}

function onHelpCategoryPick(player: Player, listItem: number): void {
  const category = CATEGORIES[listItem];
  if (!category) {
    showHelpMenu(player);
    return;
  }
  showHelpCategory(player, category);
}

function showHelpCategory(player: Player, category: HelpCategory): void {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  menuState.set(slotId, category.key);

  const byName = new Map(listCommands().map((cmd) => [cmd.name, cmd.description]));
  const lines: string[] = [];
  for (const name of category.commands) {
    const description = byName.get(name);
    if (!description) {
      continue;
    }
    lines.push(`${C_CMD}/${name}${C_DESC} - ${description}`);
  }

  if (lines.length === 0) {
    player.sendClientMessage(Color.error, "此分类中暂无命令.");
    showHelpMenu(player);
    return;
  }

  try {
    Dialog.show(
      player,
      HELP_LIST_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      category.label,
      lines.join("\n"),
      "返回",
      "关闭"
    );
  } catch {
    menuState.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开命令分类.");
  }
}

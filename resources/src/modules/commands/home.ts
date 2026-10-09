import { showHouseMenu } from "../houses/menu";
import { registerCommand } from "./registry";

registerCommand("home", "房屋菜单", (player) => {
  showHouseMenu(player);
});

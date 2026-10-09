import { showGpsMenu } from "../gps";
import { registerCommand } from "./registry";

registerCommand("gps", "设置路线或关闭 GPS", (player) => {
  showGpsMenu(player);
});

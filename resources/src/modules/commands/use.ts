import { tryOpenHouseStore } from "../houses/store";
import { registerCommand } from "./registry";

registerCommand("use", "打开自己房屋中的储物柜", (player) => {
  tryOpenHouseStore(player);
});

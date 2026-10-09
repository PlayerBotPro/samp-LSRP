import { showSellHouseDialog } from "../houses/sell";
import { registerCommand } from "./registry";

registerCommand("sellhouse", "将房屋出售给政府", (player) => {
  showSellHouseDialog(player);
});

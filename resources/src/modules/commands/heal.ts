import { tryHealInHouse } from "../houses/heal";
import { registerCommand } from "./registry";

registerCommand("heal", "在有急救箱的家中治疗", (player) => {
  tryHealInHouse(player);
});

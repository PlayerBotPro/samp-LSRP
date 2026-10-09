import { tryStartCapture } from "../zones/capture";
import { registerCommand } from "./registry";

registerCommand("capture", "占领帮派地盘", (player) => {
  tryStartCapture(player);
});

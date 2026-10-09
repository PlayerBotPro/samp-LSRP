import { Color } from "../../shared/colors";
import { tryOccupyHospitalBed } from "../hospital";
import { registerCommand } from "./registry";

registerCommand("hospital", "在医院占用病床", (player) => {
  tryOccupyHospitalBed(player);
});

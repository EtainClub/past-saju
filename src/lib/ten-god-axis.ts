import type { TenGod } from "manseryeok";
import type { TenGodAxis } from "./reading-types";

export const AXES: TenGodAxis[] = ["식상", "관성", "재성", "인성", "비겁"];

export function axisFromTenGod(god: TenGod): TenGodAxis {
  if (god === "비견" || god === "겁재") return "비겁";
  if (god === "식신" || god === "상관") return "식상";
  if (god === "편재" || god === "정재") return "재성";
  if (god === "편관" || god === "정관") return "관성";
  return "인성";
}

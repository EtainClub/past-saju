import { isValidSolarDate, lunarToSolar, type SolarDate } from "manseryeok";
import type { BirthInput } from "./reading-types";

export function resolveSolarBirthDate(
  birth: Pick<BirthInput, "date" | "calendarType" | "lunarLeapMonth">,
): SolarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth.date);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (birth.calendarType === "solar") {
    return isValidSolarDate(year, month, day) ? { year, month, day } : null;
  }
  if (birth.calendarType !== "lunar") return null;

  try {
    return lunarToSolar(year, month, day, birth.lunarLeapMonth);
  } catch {
    return null;
  }
}

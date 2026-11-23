import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile();
export const zone = process.env.BUSINESS_TIME_ZONE || "Europe/Saratov";
new Intl.DateTimeFormat("ru-RU", { timeZone: zone });
export const dbPath = process.env.ZAPIS_DB || "./data/zapis-pro.db";

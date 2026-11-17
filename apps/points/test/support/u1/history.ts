import { readFile } from "node:fs/promises";

export const historyText = () => readFile(new URL("../../../../../data/points/history.json", import.meta.url), "utf8");

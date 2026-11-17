import { writes as disputes } from "./disputes/tables.ts";
import { writes as publication } from "./publication/tables.ts";

export const writes = [...publication, ...disputes] as const;

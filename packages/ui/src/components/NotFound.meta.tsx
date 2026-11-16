import type { ComponentMeta } from "vibestack/stories";
import type { NotFoundProps } from "./NotFound.tsx";

export const meta: ComponentMeta<NotFoundProps> = {
  examples: { Project: { title: "Project not found", children: <p className="text-sm text-muted-foreground">This project isn't listed.</p>, as: "section" } },
};

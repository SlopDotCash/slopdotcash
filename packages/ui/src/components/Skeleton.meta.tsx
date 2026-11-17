import type { ComponentMeta } from "vibestack/stories";
import type { SkeletonProps } from "./Skeleton.tsx";

export const meta: ComponentMeta<SkeletonProps> = {
  examples: { Row: { className: "h-12" }, Avatar: { className: "size-8 rounded-full" } },
  decorator: (story) => <div className="w-64">{story()}</div>,
};

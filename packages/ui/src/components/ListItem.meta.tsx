import type { ComponentMeta } from "vibestack/stories";
import { Button } from "./Button.tsx";
import type { ListItemProps } from "./ListItem.tsx";
import { NetworkMark } from "./NetworkMark.tsx";
import { TokenAmount } from "./TokenAmount.tsx";

export const meta: ComponentMeta<ListItemProps> = {
  args: { title: "slop-cli, October", detail: "Approved 3 Nov" },
  examples: {
    Payout: {
      leading: <NetworkMark network="Base" showName={false} />,
      trailing: <TokenAmount value="490.00" symbol="USDC" />,
      actions: <Button size="sm" variant="outline">Details</Button>,
    },
  },
  // A list item belongs in a list.
  decorator: (story) => <ul>{story()}</ul>,
};

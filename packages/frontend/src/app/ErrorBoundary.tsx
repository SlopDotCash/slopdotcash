// spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
import { Button, cn, PageHeader, shell } from "@repo/ui";
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className={cn(shell, "flex flex-col items-start gap-4 py-8")}>
        <PageHeader title="Something broke" />
        <Button onClick={() => this.setState({ failed: false })}>Try again</Button>
      </main>
    );
  }
}

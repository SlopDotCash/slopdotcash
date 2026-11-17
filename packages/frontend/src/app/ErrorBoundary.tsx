// spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
import { Button, PageHeader } from "@repo/ui";
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="flex flex-col items-start gap-4">
        <PageHeader title="Slop could not load." />
        <Button onClick={() => location.reload()}>Reload the page</Button>
      </main>
    );
  }
}

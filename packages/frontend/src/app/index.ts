// spec/app/index.md, "Story: Open a page by its address"
export { ErrorBoundary } from "./ErrorBoundary.tsx";
export { type ExtraHead, type ExtraRoute, extraRouteHead, extraRouteOf, ExtraRoutePage } from "./extraRoutes.tsx";
export { PageAccount, RegistryBootOf, RoutePage } from "./mounted.tsx";
export { type Frame, type PageKind, type PageProps, type RegisteredPage } from "./pages.ts";
export { NotFoundHead, useNotFoundMounted } from "./notFoundHead.ts";
export { pages } from "./registered.tsx";
export { RegistryGate } from "./RegistryGate.tsx";
export { type PageRuntime, pageRuntime } from "./runtime.vibe";
export { useAddress } from "./useAddress.ts";

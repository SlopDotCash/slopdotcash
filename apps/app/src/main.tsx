import "@repo/design-system/fonts";
import { Layer, ManagedRuntime } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { stored } from "./greeter.vibe";
import "./main.css";

// The product renders dark (packages/design-system/design.md), as Storybook does.
document.documentElement.classList.add("dark");

const runtime = ManagedRuntime.make(Layer.provide(stored, KeyValueStore.layerStorage(() => localStorage)));

createRoot(document.getElementById("root")!).render(<StrictMode><App runtime={runtime} /></StrictMode>);

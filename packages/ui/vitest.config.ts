import tailwindcss from "@tailwindcss/vite";
import { project } from "vibestack/testing/vitest";

const singleReact = {
  name: "single-react",
  config: () => ({
    resolve: { dedupe: ["react", "react-dom"] },
    optimizeDeps: {
      include: [
        "react", "react-dom", "react-dom/client", "react/jsx-dev-runtime", "lucide-react",
        "@storybook/addon-a11y/preview", "@storybook/react-vite", "storybook/test",
      ],
    },
  }),
};

/** The generated stories: mounted in happy-dom, and played with axe in Chromium. Behaviour is each story's `play`, in its `.meta.tsx`. */
export default project({ root: import.meta.dirname, plugins: [tailwindcss(), singleReact] });

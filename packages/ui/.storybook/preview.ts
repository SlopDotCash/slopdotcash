import "@repo/design-system/fonts";
import "@repo/design-system/theme.css";

/** The toolbar's theme switch sets the class the tokens' dark values hang on; the product renders dark (design.md). */
export default {
  globalTypes: { theme: { toolbar: { icon: "contrast", items: ["dark", "light"], dynamicTitle: true } } },
  initialGlobals: { theme: "dark" },
  decorators: [
    (Story: () => unknown, context: { globals: { theme: string } }) => {
      document.documentElement.className = context.globals.theme;
      return Story();
    },
  ],
};

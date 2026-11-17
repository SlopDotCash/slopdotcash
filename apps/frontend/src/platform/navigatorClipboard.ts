// spec/ui/copy.md, "Copying starts from ready and reports the browser's answer"

/** @throws {never} */
export async function writeClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

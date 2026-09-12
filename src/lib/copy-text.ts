// An async boundary turns an absent clipboard API or synchronous browser error
// into the same rejected promise as a denied clipboard permission.
export async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

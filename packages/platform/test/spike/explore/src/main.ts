/// <reference lib="dom" />
const button = document.querySelector<HTMLButtonElement>('button[aria-label="Greet"]');
const output = document.querySelector<HTMLOutputElement>('output[aria-label="Greeting"]');

async function greet(): Promise<void> {
  const response = await fetch("/api/hello");
  const body = (await response.json()) as { readonly hello?: unknown };
  if (output !== null) output.value = `hello ${String(body.hello)}`;
}

button?.addEventListener("click", () => void greet());

// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"

export interface Puller {
  readonly next: () => Promise<Uint8Array | undefined>;
  readonly cancel: () => Promise<void>;
}

/** @throws {never} */
export function pulled(source: Puller): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        const part = await source.next();
        if (part === undefined) controller.close();
        else controller.enqueue(part);
      },
      cancel: () => source.cancel(),
    },
    { highWaterMark: 0 },
  );
}

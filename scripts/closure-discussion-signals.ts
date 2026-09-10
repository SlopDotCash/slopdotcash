/** Search aids only. Even negated mentions require reading; no abuse verdict. */
export function closureDiscussionSignals(
  bodies: readonly string[],
  complete: boolean,
): string[] {
  const text = bodies
    .map((body) =>
      body
        .replace(/```[\s\S]*?```/gu, "")
        .replace(/<!--[\s\S]*?-->/gu, "")
        .replace(/^>.*$/gmu, ""),
    )
    .join("\n");
  const flags: string[] = [];
  if (/\bduplicate\b|already (?:covered|claimed)|same patch/iu.test(text))
    flags.push("discussion mentions duplication: inspect rationale");
  if (
    /salvag|co.author|incorporat|supersed|replacement|preserv.{0,30}authorship/iu.test(
      text,
    )
  )
    flags.push(
      "discussion mentions salvage or replacement: preserve useful credit",
    );
  if (
    /no (?:real |reachable )?caller|unused helper|unreachable|no producer|impossible input/iu.test(
      text,
    )
  )
    flags.push(
      "discussion mentions reachability: verify real caller and effect",
    );
  if (
    /(?:contradict|violat|revers|against).{0,60}(?:policy|contract|intentional)|(?:policy|contract).{0,60}(?:contradict|violat)/iu.test(
      text,
    )
  )
    flags.push(
      "discussion mentions policy conflict: inspect maintainer decision",
    );
  if (/withdraw|self.clos/iu.test(text))
    flags.push("discussion mentions withdrawal: do not infer spam");
  if (!complete)
    flags.push(
      "discussion capture incomplete: inspect remaining GitHub context",
    );
  if (!flags.length)
    flags.push("closure reason needs review; no categorical signal detected");
  return flags;
}

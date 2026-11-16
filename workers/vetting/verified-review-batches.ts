/** Exact numeric layout after the caller measures the serialized JSON bytes. */
export interface ReviewBatchItem {
  bytes: number;
  aliases: number;
  fitted: number;
}

export interface ReviewBatchSpan {
  start: number;
  end: number;
}

export interface ReviewBatchLayout {
  spans: ReviewBatchSpan[];
  /** Zero-based group for every source item, in its original order. */
  groupOf: number[];
}

/** UTF-8 size of JSON.stringify(text), including quotes and lone-surrogate escapes. */
//@ verify
//@ ensures \result == 2 + JsonTextBytes(text, 0)
//@ ensures 2 <= \result && \result <= 6 * text.length + 2
export function jsonStringBytes(text: string): number {
  let size = 2;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ invariant 2 <= size && size <= 6 * i + 2
    //@ invariant size + JsonTextBytes(text, i) == 2 + JsonTextBytes(text, 0)
    const unit = text.charCodeAt(i);
    if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      size += 4;
      i += 2;
    } else {
      if (
        unit === 34 ||
        unit === 92 ||
        unit === 8 ||
        unit === 9 ||
        unit === 10 ||
        unit === 12 ||
        unit === 13
      )
        size += 2;
      else if (unit < 32 || (unit >= 0xd800 && unit <= 0xdfff)) size += 6;
      else if (unit < 128) size += 1;
      else if (unit < 2048) size += 2;
      else size += 3;
      i += 1;
    }
  }
  return size;
}

/** Longest leading alias list fitting beside the already serialized item. */
//@ verify
//@ requires base >= 0 && limit >= 0
//@ ensures 0 <= \result && \result <= aliases.length
//@ ensures forall(n, 1 <= n && n <= \result ==> base + AliasBytes(aliases, n) <= limit)
//@ ensures \result < aliases.length ==> base + AliasBytes(aliases, \result + 1) > limit
export function fittedAliasCount(
  base: number,
  aliases: readonly string[],
  limit: number,
): number {
  let size = base;
  let fitted = 0;
  while (fitted < aliases.length) {
    //@ invariant 0 <= fitted && fitted <= aliases.length
    //@ invariant size == base + AliasBytes(aliases, fitted)
    //@ invariant forall(n, 1 <= n && n <= fitted ==> base + AliasBytes(aliases, n) <= limit)
    size += jsonStringBytes(aliases[fitted]) + (fitted > 0 ? 1 : 0);
    if (size > limit) return fitted;
    fitted += 1;
  }
  return fitted;
}

/** Complete ordered greedy layout; an item with overflow aliases stands alone. */
//@ verify
//@ requires overhead >= 0 && limit >= 0 && maximumItems > 0
//@ requires forall(i, 0 <= i && i < items.length ==> items[i].bytes >= 0 && 0 <= items[i].fitted && items[i].fitted <= items[i].aliases)
//@ ensures CompleteBatchLayout(items, \result.spans, \result.groupOf, overhead, limit, maximumItems)
export function layoutReviewBatches(
  items: readonly ReviewBatchItem[],
  overhead: number,
  limit: number,
  maximumItems: number,
): ReviewBatchLayout {
  const spans: ReviewBatchSpan[] = [];
  const groupOf: number[] = [];
  let start = 0;
  let i = 0;
  let size = overhead;
  while (i < items.length) {
    //@ invariant 0 <= start && start <= i && i <= items.length
    //@ invariant groupOf.length == i
    //@ invariant SpanPartition(spans, start, maximumItems)
    //@ invariant SpansFit(items, spans, overhead, limit)
    //@ invariant GroupsMatchPrefix(spans, groupOf, start, i)
    //@ invariant size == overhead + BatchBytes(items, start, i)
    //@ invariant i - start <= maximumItems
    //@ invariant i - start > 1 ==> size <= limit
    //@ invariant forall(k, start <= k && k < i ==> items[k].fitted == items[k].aliases)
    //@ invariant GroupCuts(items, spans, overhead, limit, maximumItems)
    //@ invariant start < i && spans.length > 0 ==> CutAllowed(items, spans[spans.length - 1], start, overhead, limit, maximumItems)
    //@ invariant start == i && spans.length > 0 ==> items[spans[spans.length - 1].start].fitted < items[spans[spans.length - 1].start].aliases
    const item = items[i];
    if (item.fitted < item.aliases) {
      if (start < i) spans.push({ start, end: i });
      spans.push({ start: i, end: i + 1 });
      groupOf.push(spans.length - 1);
      i += 1;
      start = i;
      size = overhead;
    } else {
      if (
        start < i &&
        (size + item.bytes > limit || i - start >= maximumItems)
      ) {
        spans.push({ start, end: i });
        start = i;
        size = overhead;
      }
      groupOf.push(spans.length);
      size += item.bytes;
      i += 1;
    }
  }
  if (start < i) spans.push({ start, end: i });
  return { spans, groupOf };
}

// spec/security/intake.md, "A report body holds between 1 and 262,144 bytes and any other size creates nothing"
lemma backtickRunIsBounded(value: string, end: int)
  requires 0 <= end && end <= |value|
  ensures 0 <= backtickRunEndingAt(value, end) && backtickRunEndingAt(value, end) <= end
  decreases end
{
  if end > 0 {
    backtickRunIsBounded(value, end - 1);
  }
}

lemma fenceOutrunsEveryRun(value: string, end: int)
  requires 0 <= end && end <= |value|
  ensures backtickRunEndingAt(value, end) >= 0
  ensures fenceWidth(backtickRunEndingAt(value, end)) > backtickRunEndingAt(value, end)
  ensures fenceWidth(backtickRunEndingAt(value, end)) >= 3
{
  backtickRunIsBounded(value, end);
}

lemma fenceWidthIsTheLeastLongerFence(longest: int)
  requires longest >= 0
  ensures longest < 3 ==> fenceWidth(longest) == 3
  ensures longest >= 3 ==> fenceWidth(longest) == longest + 1
{
}

// Removing one immutable submission retains every different mounted sibling.
lemma lawCloseKeepsSibling_ensures(opened_: seq<int>, closing: int, sibling: int)
  ensures (lawCloseKeepsSibling(opened_, closing, sibling) == true)
{
  if closing != sibling && sibling in opened_ {
    ProofLib.FilterMember((set_x: int) => !((set_x in [closing])), opened_, sibling);
    CloseUsesFilter(opened_, closing);
  }
}

lemma CloseUsesFilter(opened_: seq<int>, closing: int)
  ensures closeDetail(DetailSet(opened_), closing).opened_ == ProofLib.Filter((set_x: int) => !((set_x in [closing])), opened_)
{
}

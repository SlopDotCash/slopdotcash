// The legacy Cmd.TLA regex makes literal_false pass by changing string data.
// With lexical normalization it must fail in its initial state.
module literal_false {
  var text: str
  action init = text' = "ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA"
  action step = text' = text
  val invariant = text == "LET v == 0 IN  ApaFoldSet(__QUINT_LAMBDA"
}

module literal_true {
  var text: str
  action init = text' = "ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA"
  action step = text' = text
  val invariant = text == "ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA"
}

module fold_true {
  var numbers: List[int]
  action init = numbers' = List(1, 2)
  action step = numbers' = numbers
  val invariant = numbers.foldl(0, (sum, value) => sum + value) == 3
}

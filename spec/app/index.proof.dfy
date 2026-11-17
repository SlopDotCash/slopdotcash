// The legacy rewrite keeps every segment of an address that can be opened, so each identifier a route carries is
// one of them, and never empty.
lemma CanonicalKeepsSegments(segments: seq<string>, securitySettings: bool)
  requires forall i :: 0 <= i < |segments| ==> segments[i] != ""
  ensures forall i :: 0 <= i < |canonical(segments, securitySettings)| ==> canonical(segments, securitySettings)[i] != ""
{
}

lemma open_ensures(s: Shell, segments: seq<string>, withX: bool, securitySettings: bool)
  ensures (inv(s) ==> canOpen(s, segments) ==> alwaysRouteCarriesItsIdentifiers(open(s, segments, withX, securitySettings)))
  ensures (inv(s) ==> canOpen(s, segments) ==> alwaysOpenedIsNonnegative(open(s, segments, withX, securitySettings)))
  ensures (inv(s) ==> canOpen(s, segments) ==> stepOpensOnePage(s, open(s, segments, withX, securitySettings)))
{
  if inv(s) && canOpen(s, segments) {
    forall i | 0 <= i < |segments| ensures segments[i] != "" {
      assert segments[i] in segments;
    }
    CanonicalKeepsSegments(segments, securitySettings);
  }
}

// The parser and the patterns agree: a known kind the parser returns is the one whose pattern matches, and a pattern
// that matches is the kind the parser returns.
lemma ParsedKindMatches(segments: seq<string>, withX: bool, securitySettings: bool)
  ensures !parse(segments, withX, securitySettings).kind.Unknown? ==> matchesKnown(parse(segments, withX, securitySettings).kind, segments, withX, securitySettings)
{
}

lemma MatchedKindIsParsed(kind: RouteKind, segments: seq<string>, withX: bool, securitySettings: bool)
  requires !kind.Unknown? && matchesKnown(kind, segments, withX, securitySettings)
  ensures parse(segments, withX, securitySettings).kind == kind
{
}

lemma KnownKindsHoldEveryKind(kind: RouteKind)
  ensures !kind.Unknown? ==> kind in knownKinds
{
  match kind {
    case Home => assert knownKinds[0] == kind;
    case HowItWorks => assert knownKinds[1] == kind;
    case Sponsors => assert knownKinds[2] == kind;
    case CycleArchive => assert knownKinds[3] == kind;
    case Cycle => assert knownKinds[4] == kind;
    case Points => assert knownKinds[5] == kind;
    case Account => assert knownKinds[6] == kind;
    case Login => assert knownKinds[7] == kind;
    case Earnings => assert knownKinds[8] == kind;
    case Inbox => assert knownKinds[9] == kind;
    case Admin => assert knownKinds[10] == kind;
    case NewProject => assert knownKinds[11] == kind;
    case VettingEvidence => assert knownKinds[12] == kind;
    case SecurityCases => assert knownKinds[13] == kind;
    case Project => assert knownKinds[14] == kind;
    case ManageProject => assert knownKinds[15] == kind;
    case SecurityProgram => assert knownKinds[16] == kind;
    case Profile => assert knownKinds[17] == kind;
    case Unknown =>
  }
}

lemma lawEachAddressNamesOneKind_ensures(kind: RouteKind, segments: seq<string>, withX: bool, securitySettings: bool)
  ensures (lawEachAddressNamesOneKind(kind, segments, withX, securitySettings) == true)
{
  var parsed := parse(segments, withX, securitySettings).kind;
  ParsedKindMatches(segments, withX, securitySettings);
  KnownKindsHoldEveryKind(parsed);
  if kind.Unknown? {
    forall known | known in knownKinds && matchesKnown(known, segments, withX, securitySettings) ensures parsed == known {
      MatchedKindIsParsed(known, segments, withX, securitySettings);
    }
  } else if matchesKnown(kind, segments, withX, securitySettings) {
    MatchedKindIsParsed(kind, segments, withX, securitySettings);
  }
}

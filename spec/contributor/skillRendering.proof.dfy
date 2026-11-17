lemma readNotes_ensures(s: SkillOutput)
  ensures (inv(s) ==> canReadNotes(s) ==> alwaysPublishedPairRendered(readNotes(s)))
  ensures (inv(s) ==> canReadNotes(s) ==> alwaysNoAppliedNoteCrossesARule(readNotes(s)))
  ensures (inv(s) ==> canReadNotes(s) ==> alwaysEveryNoteAppliedOrReported(readNotes(s)))
{
  if inv(s) && canReadNotes(s) {
    var rd := s.publication.archivedSkill;
    var after := readNotes(s);
    forall n | n in rd.notes ensures n in after.applied || n in after.reported {
      ProofLib.FilterMember((n: Note) => !(crossesRule(rd.rules, n)), rd.notes, n);
      ProofLib.FilterMember((n: Note) => crossesRule(rd.rules, n), rd.notes, n);
    }
    forall n | n in after.applied ensures n in rd.notes && !crossesRule(rd.rules, n) {
      ProofLib.FilterMember((n: Note) => !(crossesRule(rd.rules, n)), rd.notes, n);
    }
    forall n | n in after.reported ensures n in rd.notes && crossesRule(rd.rules, n) {
      ProofLib.FilterMember((n: Note) => crossesRule(rd.rules, n), rd.notes, n);
    }
  }
}

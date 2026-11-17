//@ backend dafny
// spec/points/corrections.md, "A historical source retains its original carrier and every successor"; spec/points/corrections.md, "Preparation is the plan: it captures the current predecessor and never appends an allocation"

//@ pure
export function relabeled(labels: readonly number[], from: number, to: number): number[] {
  //@ ensures \result.length === labels.length
  //@ ensures forall(k, 0 <= k && k < labels.length ==> \result[k] === (labels[k] === from ? to : labels[k]))
  return labels.map((label: number) => label === from ? to : label);
}

/** @throws {never} */
export function connectedLabels(candidates: number, members: readonly number[], sources: readonly number[], sourceCount: number): number[] {
  //@ requires candidates >= 0 && sourceCount >= 0
  //@ requires members.length === sources.length
  //@ requires forall(k, 0 <= k && k < members.length ==> 0 <= members[k] && members[k] < candidates)
  //@ requires forall(k, 0 <= k && k < sources.length ==> 0 <= sources[k] && sources[k] < sourceCount)
  //@ ensures \result.length === candidates
  //@ ensures forall(k, 0 <= k && k < candidates ==> 0 <= \result[k] && \result[k] < candidates)
  //@ ensures forall(j, 0 <= j && j < members.length ==> forall(k, 0 <= k && k < members.length && sources[j] === sources[k] ==> \result[members[j]] === \result[members[k]]))
  let labels: number[] = [];
  let candidate = 0;
  while (candidate < candidates) {
    //@ invariant 0 <= candidate && candidate <= candidates
    //@ invariant labels.length === candidate
    //@ invariant forall(k, 0 <= k && k < candidate ==> labels[k] === k)
    //@ decreases candidates - candidate
    labels.push(candidate);
    candidate = candidate + 1;
  }
  const owners: number[] = [];
  let source = 0;
  while (source < sourceCount) {
    //@ invariant 0 <= source && source <= sourceCount
    //@ invariant owners.length === source
    //@ invariant forall(k, 0 <= k && k < source ==> owners[k] === -1)
    //@ decreases sourceCount - source
    owners.push(-1);
    source = source + 1;
  }
  let member = 0;
  while (member < members.length) {
    //@ invariant 0 <= member && member <= members.length
    //@ invariant labels.length === candidates
    //@ invariant owners.length === sourceCount
    //@ invariant forall(k, 0 <= k && k < candidates ==> 0 <= labels[k] && labels[k] < candidates)
    //@ invariant forall(k, 0 <= k && k < sourceCount ==> -1 <= owners[k] && owners[k] < candidates)
    //@ invariant forall(j, 0 <= j && j < member ==> owners[sources[j]] >= 0 && labels[members[j]] === labels[owners[sources[j]]])
    //@ decreases members.length - member
    const owner = owners[sources[member]];
    if (owner < 0) {
      owners[sources[member]] = members[member];
    } else {
      labels = relabeled(labels, labels[members[member]], labels[owner]);
    }
    member = member + 1;
  }
  return labels;
}

//@ pure
export function clash(commits: readonly number[], paths: readonly number[], j: number, k: number): boolean {
  //@ requires commits.length === paths.length
  //@ requires 0 <= j && j < commits.length && 0 <= k && k < commits.length
  return j !== k && commits[j] === commits[k] && (paths[j] < 0 || paths[k] < 0 || paths[j] === paths[k]);
}

//@ pure
export function clashesBefore(commits: readonly number[], paths: readonly number[], j: number, count: number): boolean {
  //@ requires commits.length === paths.length
  //@ requires 0 <= j && j < commits.length && 0 <= count && count <= commits.length
  //@ decreases count
  if (count === 0) return false;
  return clash(commits, paths, j, count - 1) || clashesBefore(commits, paths, j, count - 1);
}

//@ pure
export function planClashes(owners: readonly number[], commits: readonly number[], paths: readonly number[], plan: number, count: number): boolean {
  //@ requires owners.length === commits.length && commits.length === paths.length
  //@ requires 0 <= count && count <= owners.length
  //@ decreases count
  if (count === 0) return false;
  return (owners[count - 1] === plan && clashesBefore(commits, paths, count - 1, commits.length)) || planClashes(owners, commits, paths, plan, count - 1);
}

/** @throws {never} */
export function ambiguousPlans(plans: number, owners: readonly number[], commits: readonly number[], paths: readonly number[]): boolean[] {
  //@ requires plans >= 0
  //@ requires owners.length === commits.length && commits.length === paths.length
  //@ ensures \result.length === plans
  //@ ensures forall(p, 0 <= p && p < plans ==> \result[p] === planClashes(owners, commits, paths, p, owners.length))
  const result: boolean[] = [];
  let plan = 0;
  while (plan < plans) {
    //@ invariant 0 <= plan && plan <= plans
    //@ invariant result.length === plan
    //@ invariant forall(p, 0 <= p && p < plan ==> result[p] === planClashes(owners, commits, paths, p, owners.length))
    //@ decreases plans - plan
    result.push(planClashes(owners, commits, paths, plan, owners.length));
    plan = plan + 1;
  }
  return result;
}

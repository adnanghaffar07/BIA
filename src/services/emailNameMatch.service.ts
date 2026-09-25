/**
 * Does this email address plausibly belong to the person we think it does?
 *
 * Frank, 24 Sep 2026: "a surname match between every skip-trace-recovered address and the
 * insured or co-insured. Failures go to a review list, not into a send."
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A skip trace returns addresses attached to a property, not proof of ownership. On
 * 3604 Scarecrow Ct the insured is Claudia Garcia, the co-insured is Cesar Garcia, and the
 * record carries qthunni96@aol.com and dburnette19@gmail.com — neither of them a Garcia.
 * Sending there discloses a stranger's home address and estimated premium to somebody
 * else, and earns a spam complaint on a domain with no history to absorb it.
 *
 * Email verification does not catch this. It confirms a mailbox exists, not whose it is.
 *
 * ── Why the naive version is worse than useless ─────────────────────────────
 * A substring check for the surname flags 34% of our addresses. Most of those are wrong:
 * catfal73@gmail.com IS Catherine Fallon, leawas@gmail.com IS Lea Ann Salmieri. Acting on
 * that number would hold back a third of the campaign, overwhelmingly people we could
 * legitimately email — and burying forty real strangers in seven hundred false alarms
 * means nobody finds them.
 *
 * So this is built to RECOGNISE the shapes real addresses take, and to say "I don't know"
 * rather than "wrong" when it cannot tell. Only genuine unknowns are worth a person's time.
 *
 * ── Zero imports, deliberately ──────────────────────────────────────────────
 * Same reason as ownerEntity.ts: this is read by a server route and shown on a review
 * screen, and a value import from a service drags its whole graph into the browser bundle.
 */

export type EmailNameVerdict =
  /** The address carries a name from the record. Safe to send. */
  | 'match'
  /** Something lines up but not enough to be sure. A person should look. */
  | 'review'
  /** Nothing on the record appears in the address at all. */
  | 'mismatch'
  /** No name on the record to compare against — not the address's fault. */
  | 'no_name';

export type EmailNameCheck = {
  email: string;
  verdict: EmailNameVerdict;
  /** Which person it matched, where it did. */
  matched: string | null;
  /** Plain English, shown on the review screen so a decision can be made from the row. */
  reason: string;
};

/** Lower-case, strip accents and anything that is not a letter. */
const norm = (s: unknown): string =>
  String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '');

/**
 * Nicknames a prefix test cannot reach.
 *
 * Deliberately short. "cat" for Catherine and "chris" for Christopher are already handled
 * by prefix matching; these are the ones where the short form shares no opening letters
 * with the full name, so no amount of prefix logic finds them.
 */
const NICKNAMES: Record<string, string[]> = {
  robert: ['bob', 'rob', 'bobby'],
  richard: ['dick', 'rick', 'rich'],
  william: ['bill', 'will', 'billy', 'liam'],
  john: ['jack', 'johnny'],
  margaret: ['peggy', 'maggie', 'meg'],
  james: ['jim', 'jimmy'],
  charles: ['chuck', 'charlie'],
  edward: ['ted', 'ned', 'eddie'],
  elizabeth: ['betty', 'liz', 'beth', 'eliza'],
  henry: ['hank', 'harry'],
  lawrence: ['larry'],
  anthony: ['tony'],
  joseph: ['joe', 'joey'],
  patricia: ['patty', 'trish', 'pat'],
  michael: ['mike', 'mickey'],
  thomas: ['tom', 'tommy'],
  frederick: ['fred'],
  theodore: ['ted', 'teddy'],
  kenneth: ['ken', 'kenny'],
  eugene: ['gene'],
  francis: ['frank'],
  virginia: ['ginny'],
  barbara: ['barb', 'babs'],
  susan: ['sue', 'suzy'],
  deborah: ['debbie', 'deb'],
  jennifer: ['jen', 'jenny'],
};

/** Every written form of one given name: itself, plus any nickname for it. */
function givenForms(name: string): string[] {
  const n = norm(name);
  if (!n) return [];
  const out = new Set<string>([n]);
  for (const alias of NICKNAMES[n] ?? []) out.add(alias);
  // And the reverse direction: the record may hold the nickname.
  for (const [full, aliases] of Object.entries(NICKNAMES)) {
    if (aliases.includes(n)) out.add(full);
  }
  return [...out];
}

/**
 * A person, reduced to the pieces that can appear in an address.
 *
 * Middle names are kept as separate tokens rather than glued to the first name. "Lea Ann
 * Salmieri" compared as one string "leaann" is why leawas@gmail.com read as a stranger.
 */
function parts(first: unknown, last: unknown) {
  const givens = String(first ?? '').split(/\s+/).map(norm).filter((t) => t.length >= 2);
  return {
    label: [String(first ?? '').trim(), String(last ?? '').trim()].filter(Boolean).join(' '),
    givens,
    surname: norm(last),
  };
}

/** Strip the domain, and any trailing digits people append to make an address unique. */
function localPart(email: string): string {
  const local = String(email).split('@')[0] ?? '';
  return norm(local);
}

/**
 * Every written form of every name on the record, as one pool.
 *
 * Pooled rather than compared person by person, because household addresses mix the two:
 * antcath2003 is one household's two given names run together, and pambutch@hotmail.com
 * carries a surname belonging to both. Comparing each person separately cannot see either.
 */
function tokenPool(people: { first?: unknown; last?: unknown; role: string }[]) {
  const givens: string[] = [];
  const surnames: string[] = [];
  const labels: string[] = [];
  for (const p of people) {
    const { label, givens: g, surname } = parts(p.first, p.last);
    if (label) labels.push(`${label} (${p.role})`);
    for (const one of g) for (const form of givenForms(one)) givens.push(form);
    if (surname) surnames.push(surname);
  }
  return { givens: [...new Set(givens)], surnames: [...new Set(surnames)], labels };
}

/**
 * How strongly does this address carry a name from the record?
 *
 * 3 = send it · 2 = send it · 1 = someone should look · null = nothing there.
 *
 * The weights come from looking at the real book rather than from first principles. The
 * dominant shape by far is a SURNAME PREFIX — schwa811 is five of the seven letters of
 * Schwalb, golebiowscy is the Polish form of Golebiowski, pambutch carries Butcher. An
 * earlier version wanted the whole surname and rejected all three.
 */
function score(local: string, pool: ReturnType<typeof tokenPool>): { score: number; why: string } | null {
  if (!local) return null;
  const { givens, surnames } = pool;
  if (!givens.length && !surnames.length) return null;

  // ── The surname, whole ───────────────────────────────────────────────────
  for (const sn of surnames) {
    if (sn.length >= 4 && local.includes(sn)) return { score: 3, why: `carries the surname "${sn}"` };
  }

  // ── The surname's first five letters ─────────────────────────────────────
  // Specific enough to be evidence, short enough to survive the spelling the owner uses.
  for (const sn of surnames) {
    if (sn.length >= 5 && local.includes(sn.slice(0, 5))) {
      return { score: 3, why: `carries "${sn.slice(0, 5)}", the opening of "${sn}"` };
    }
  }

  // ── Two name pieces run together ─────────────────────────────────────────
  // catfal73 = Catherine + Fallon. antcath2003 = two given names. Either counts: three
  // letters of one name beside three of another is not a coincidence anyone hits.
  const pieces = [...givens, ...surnames];
  for (const a of pieces) {
    for (const b of pieces) {
      if (a === b) continue;
      for (let i = Math.min(a.length, 6); i >= 3; i--) {
        for (let j = Math.min(b.length, 6); j >= 3; j--) {
          if (local.includes(a.slice(0, i) + b.slice(0, j))) {
            return { score: 3, why: `"${a.slice(0, i)}" and "${b.slice(0, j)}" run together` };
          }
        }
      }
    }
  }

  // ── An initial and the surname, the jsmith / kagilly56 shape ─────────────
  // The surname may be truncated too: Kathleen Gilson writes kagilly56.
  for (const g of givens) {
    for (const sn of surnames) {
      if (sn.length >= 4 && local.startsWith(g[0] + sn)) {
        return { score: 3, why: `initial "${g[0]}" plus "${sn}"` };
      }
      for (let i = Math.min(sn.length, 6); i >= 3; i--) {
        if (local.startsWith(g.slice(0, 2) + sn.slice(0, i))) {
          return { score: 3, why: `"${g.slice(0, 2)}" plus "${sn.slice(0, i)}"` };
        }
      }
    }
  }

  // ── A run of initials ────────────────────────────────────────────────────
  // kdb173@psu.edu is Kyle Donald Barton. Two initials is too weak to mean anything;
  // three in the right order is not an accident.
  const initials = [...givens.map((g) => g[0]), ...surnames.map((sn) => sn[0])];
  if (initials.length >= 3) {
    const run = givens.map((g) => g[0]).join('') + (surnames[0]?.[0] ?? '');
    if (run.length >= 3 && local.startsWith(run)) {
      return { score: 3, why: `the initials "${run}"` };
    }
  }

  // ── A whole given name, or enough of one ─────────────────────────────────
  // jeffre815 is Jeffrey; meliss28 is Melissa; mattdj2 is Matthew. Four letters of a
  // given name is the same strength as four of a surname, and both appear constantly.
  for (const g of givens) {
    if (g.length >= 4 && local.includes(g)) return { score: 2, why: `carries the given name "${g}"` };
  }
  for (const g of givens) {
    for (let i = Math.min(g.length, 6); i >= 4; i--) {
      if (local.includes(g.slice(0, i))) {
        return { score: 2, why: `carries "${g.slice(0, i)}", the opening of "${g}"` };
      }
    }
  }

  // ── A short surname, whole ───────────────────────────────────────────────
  // Luo, Lin, Shah. Three letters is thin on its own, so it only counts where the
  // address is short enough that the surname is most of it.
  for (const sn of surnames) {
    if (sn.length === 3 && local.includes(sn) && local.length <= 8) {
      return { score: 2, why: `carries the surname "${sn}"` };
    }
  }

  // ── Thin: worth a person's eye, not worth a send ─────────────────────────
  for (const sn of surnames) {
    if (sn.length >= 5 && local.includes(sn.slice(0, 4))) {
      return { score: 1, why: `carries "${sn.slice(0, 4)}" — four letters of "${sn}"` };
    }
  }
  for (const g of givens) {
    // captainjoe1 is Joseph. A three-letter given name anywhere is thin, but it is
    // evidence, and thin evidence is exactly what the review list is for.
    if (g.length === 3 && local.includes(g)) {
      return { score: 1, why: `carries "${g}", short enough to be coincidence` };
    }
  }
  return null;
}

/**
 * Check one address against the insured and the co-insured.
 *
 * `review` is a real answer, not a hedge. The alternative is calling a thing a mismatch
 * because our matcher is not clever enough, and then holding back somebody we could have
 * emailed.
 */
export function checkEmailAgainstNames(
  email: string,
  people: { first?: unknown; last?: unknown; role: string }[],
): EmailNameCheck {
  const local = localPart(email);
  const pool = tokenPool(people);

  if (!pool.labels.length) {
    return { email, verdict: 'no_name', matched: null, reason: 'No owner name on the record to check against.' };
  }

  const who = pool.labels.join(' or ');
  const s = score(local, pool);

  if (!s) {
    return {
      email,
      verdict: 'mismatch',
      matched: null,
      reason: `Nothing in "${local}" matches ${who}.`,
    };
  }
  if (s.score >= 2) return { email, verdict: 'match', matched: who, reason: `${who} — ${s.why}.` };
  return { email, verdict: 'review', matched: who, reason: `Possibly ${who} — ${s.why}.` };
}

/** True when an address must not be sent to without someone clearing it first. */
export const needsReview = (v: EmailNameVerdict): boolean => v !== 'match';

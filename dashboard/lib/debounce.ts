/** Trailing-edge debounce for the area typeahead (D-07, ~300ms).
 *
 *  Hand-rolled rather than adding lodash.debounce/use-debounce: RESEARCH.md's "Don't Hand-Roll"
 *  table explicitly calls this out as the one case where a dependency is disproportionate, and
 *  dashboard/package.json carries exactly four runtime deps today. Ten lines beats a package.
 *
 *  Lives in lib/ (not inline in the .tsx) so it is covered by the project's only test harness.
 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, delayMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    // Trailing edge only: a typeahead should fire when the user PAUSES, not on the first
    // keystroke of a burst — a leading-edge call would search on a 1-character prefix.
    timer = setTimeout(() => { timer = undefined; fn(...args); }, delayMs);
  };
  wrapped.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped as Debounced<A>;
}

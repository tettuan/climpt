/** Version resolution and entry filtering */

import type { Entry } from "./types.ts";

export function filterEntries(
  entries: Entry[],
  category?: string,
  lang?: string,
): Entry[] {
  return entries.filter(
    (e) =>
      (!category || e.category === category) &&
      (!lang || !e.lang || e.lang === lang),
  );
}

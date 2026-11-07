/**
 * Names of the events of the bus (PLAN §4.4): lowercase words joined by dots, the domain first
 * (`payment.received`, `match.result_published`). The payload format of an event is versioned
 * (`page.published@1`): a subscriber names the type alone (every version) or a type and one
 * version.
 */

/** Type of an event: at least two lowercase words joined by `.`, `_` inside a word. */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/** What a subscriber listens to: `type`, or `type@version` for one version only. */
export interface EventSelector {
  readonly type: string;
  /** `undefined`: every version. */
  readonly version: number | undefined;
}

/** Reads `type` or `type@version`; `undefined` when it is neither. */
export function parseEventSelector(selector: string): EventSelector | undefined {
  const at = selector.lastIndexOf("@");
  const type = at === -1 ? selector : selector.slice(0, at);
  if (!EVENT_TYPE_PATTERN.test(type)) {
    return undefined;
  }
  if (at === -1) {
    return { type, version: undefined };
  }
  const version = selector.slice(at + 1);
  return /^[1-9]\d{0,5}$/.test(version) ? { type, version: Number(version) } : undefined;
}

/** Whether an event of `type` and `version` is one `selector` listens to. */
export function selectsEvent(selector: EventSelector, type: string, version: number): boolean {
  return selector.type === type && (selector.version === undefined || selector.version === version);
}

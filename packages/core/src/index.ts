// Root entry, free of Node.js built-ins so that browser code (back-office) can import it.
// Server-only code has its own entry, such as `@sport-cms/core/config`.

export {
  CORE_PERMISSIONS,
  can,
  type Permission,
  ROLE_PERMISSIONS,
  ROLES,
  type Role,
  type RoleHolder,
} from "./auth.js";
export {
  type ContentReader,
  isPublicMedia,
  MAX_POSTS_PER_QUERY,
  MEDIA_RIGHTS,
  MEDIA_RIGHTS_LABELS,
  type MediaRights,
  type MediaVariant,
  type MediaView,
  PARTNER_LEVEL_LABELS,
  PARTNER_LEVELS,
  type PartnerLevel,
  type PartnerView,
  POSTS_PATH_PREFIX,
  type PostQuery,
  type PostSummaryView,
  type PostView,
  postPath,
  SLUG_PATTERN,
} from "./content.js";
export {
  EVENT_TYPE_PATTERN,
  type EventSelector,
  parseEventSelector,
  selectsEvent,
} from "./events.js";
export { encodePagePath, normalizePagePath } from "./page-path.js";
export { slugify } from "./slugify.js";
export {
  CALENDAR_EVENT_KIND_LABELS,
  CALENDAR_EVENT_KINDS,
  type CalendarEventKind,
  DAY_PATTERN,
  isDay,
  MAX_MATCHES_PER_QUERY,
  type MatchQuery,
  type MatchView,
  type NamedRef,
  type SportReader,
  TEAM_GENDER_LABELS,
  TEAM_GENDERS,
  type TeamGender,
  type TeamSummaryView,
  type TeamView,
  TIME_OF_DAY_PATTERN,
  type TrainingSlotView,
  type VenueView,
  WEEKDAYS,
  type Weekday,
  weekdayLabel,
} from "./sport.js";
export { CMS_VERSION } from "./version.js";

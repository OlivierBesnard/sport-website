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
  EVENT_TYPE_PATTERN,
  type EventSelector,
  parseEventSelector,
  selectsEvent,
} from "./events.js";
export { encodePagePath, normalizePagePath } from "./page-path.js";
export { slugify } from "./slugify.js";
export { CMS_VERSION } from "./version.js";

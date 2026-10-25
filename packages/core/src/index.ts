// Root entry, free of Node.js built-ins so that browser code (back-office) can import it.
// Server-only code has its own entry, such as `@sport-cms/core/config`.
export { slugify } from "./slugify.js";

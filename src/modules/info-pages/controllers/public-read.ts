/**
 * Per IP: phones on one mobile tower share a carrier address (CGNAT), and
 * these reads are cached and cheap — so the limit is generous.
 */
export const PUBLIC_READ = { default: { limit: 600, ttl: 60_000 } };

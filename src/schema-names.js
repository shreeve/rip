// Tiny JS-face naming helpers shared by schema emission and the
// type story. Kept out of schema-types.js so the browser compile
// graph can take the name without the IDE type machinery.

// The face-only behavior object's name for a schema: one module-local
// const carrying the same compiled callable bodies the descriptor
// does, so `ReturnType<typeof …>` can read what each returns. The JS
// face emits the same binding when a schema carries callable members.
export const behaviorName = (name) => `__${name}__behavior`;

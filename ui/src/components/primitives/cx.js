// ui/src/components/primitives/cx.js
// The single place a falsy class is dropped before it reaches the DOM. Task 6 shipped
// three copies of this line and said a fourth was the trigger to promote it; this is
// that module, so `idle`, an unknown size or an absent `className` can never be
// written as the literal "undefined" by the scoped (production) build.
export const cx = (...names) => names.filter(Boolean).join(" ");

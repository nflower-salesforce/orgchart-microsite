// Example seed for the org-chart microsite.
//
// This is ONLY used to populate an EMPTY database the first time the app boots.
// Once seeded, the live data lives in the database and is edited through the UI
// (the "Add person" button, drag-to-reposition, inline edit) — changing this
// file does NOT retroactively change an already-seeded database.
//
// Replace the people below with your own org, or just delete them down to one
// root and build the rest in the UI. Tip: hand a screenshot or a spreadsheet of
// your org to Claude Code and ask it to rewrite STAKEHOLDERS for you.

// Workstreams = the initiatives/teams a person can be tagged with. The card's
// top accent bar splits into one color segment per workstream, and the toolbar
// builds a filter from them. Rename / add your own; keep ids short and unique.
const WORKSTREAMS = [
  { id: "product", label: "Product" },
  { id: "engineering", label: "Engineering" },
  { id: "gtm", label: "Go-to-Market" }
];

// Each person:
//   id            short unique key (used by reportsTo / worksWith)
//   name, title   display
//   reportsTo     id of their manager, or null for the top of the chart
//   reportingConfidence  "confirmed" (solid line) | "inferred" (dashed)
//   cat           exec | tech | mktg | ops | analytics | unplaced (card tint)
//   workstreams[] ids from WORKSTREAMS above
//   worksWith[]   ids of peers they collaborate with (dotted line)
//   dept, email, linkedin, notes   optional extra fields shown in the drawer
const STAKEHOLDERS = [
  { id: "CEO", name: "Alex Rivera", title: "Chief Executive Officer", reportsTo: null, cat: "exec" },
  { id: "CTO", name: "Sam Chen", title: "Chief Technology Officer", reportsTo: "CEO", reportingConfidence: "confirmed", cat: "tech", workstreams: ["engineering", "product"] },
  { id: "CMO", name: "Jordan Lee", title: "Chief Marketing Officer", reportsTo: "CEO", reportingConfidence: "confirmed", cat: "mktg", workstreams: ["gtm"], worksWith: ["CTO"] }
];

module.exports = { STAKEHOLDERS, WORKSTREAMS };

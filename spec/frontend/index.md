# Frontend

The browser presents the state owned by the application machines. It obtains
authority from the authenticated backend and payment facts from reconciled
evidence. The existing product routes and controls are the design baseline.
These requirements specify the eventual React shell on the generated Machine
service. They introduce no new screens or visual design.

- [Navigation and session ownership](./navigation.md)
- [Asynchronous reads and recovery](./requests.md)
- [Private report drafts](./drafts.md)
- [Public and private projections](./projections.md)

Source requirements are PRD sections 2–4 and 7–10. The retained UI models under
`reference/slop-main/formal/models/ui/` provide the individual legacy races and
named scenarios to replay through the eventual shell.

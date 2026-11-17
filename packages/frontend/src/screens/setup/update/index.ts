// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"
export { type CurrentRevision, currentRevision, publishUpdate, removeManaged } from "./actions.vibe";
export { ChangeReview, type ChangeReviewProps } from "./ChangeReview.tsx";
export { ProjectRemoved, RemoveProject, type RemoveProjectProps } from "./RemoveProject.tsx";
export { type ChangeRow, type Edit, type Managed, managedOf, reviewOf, type UpdateReview } from "./revision.ts";
export { type Addition, UpdateForm, type UpdateFormProps } from "./UpdateForm.tsx";
export { UpdatePage } from "./UpdatePage.tsx";

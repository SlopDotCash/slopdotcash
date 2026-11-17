declare module "*/legacyProjects.json" {
  const projects: ReadonlyArray<{ readonly id: string; readonly name: string; readonly repositories: ReadonlyArray<{ readonly id: string; readonly aliases: ReadonlyArray<string> }> }>;
  export default projects;
}

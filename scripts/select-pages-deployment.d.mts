export function selectSuccessfulProductionDeployment(
  response: unknown,
  expected: {
    commitHash: string;
    notBefore: number;
    branch?: string;
    environment?: string;
    project?: string;
  },
):
  | { id: string; url: string; createdOn: string; createdOnEpoch: number }
  | undefined;

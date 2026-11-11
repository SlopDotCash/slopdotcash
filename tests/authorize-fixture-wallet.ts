/** Use the real wallet API while its D1 runtime is serving browser requests. */
export async function authorizeFixtureWallet(
  post: (
    path: string,
    body: Record<string, unknown>,
  ) => Promise<{ status: number; body: unknown }>,
  wallet: {
    chain: "base" | "solana";
    address: string;
    sign(message: string): string | Promise<string>;
  },
): Promise<string> {
  const request = async (path: string, body: Record<string, unknown>) => {
    const response = await post(`payments/wallets/${path}`, body);
    if (
      response.status !== 200 ||
      !response.body ||
      typeof response.body !== "object" ||
      Array.isArray(response.body)
    )
      throw new Error(`Fixture wallet ${path} failed (${response.status})`);
    return response.body as Record<string, unknown>;
  };
  const registered = await request("register", {
    chain: wallet.chain,
    address: wallet.address,
  });
  const claimId = registered.claimId;
  if (typeof claimId !== "string" || !claimId)
    throw new Error("Fixture wallet registration has no claim");
  const challenge = await request("challenge", { claimId });
  const sameAddress =
    typeof challenge.address === "string" &&
    (wallet.chain === "solana"
      ? challenge.address === wallet.address
      : challenge.address.toLowerCase() === wallet.address.toLowerCase());
  if (
    !sameAddress ||
    challenge.chain !== wallet.chain ||
    typeof challenge.challengeId !== "string" ||
    typeof challenge.message !== "string"
  )
    throw new Error("Fixture wallet challenge is not bound to the wallet");
  const result = await request("authorize", {
    claimId,
    challengeId: challenge.challengeId,
    signature: await wallet.sign(challenge.message),
  });
  if (result.authorized !== true)
    throw new Error("Fixture wallet possession was not authorized");
  return claimId;
}

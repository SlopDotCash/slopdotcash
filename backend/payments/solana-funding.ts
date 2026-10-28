import {
  type SolanaEscrowConfig,
  solanaMintDecimals,
} from "../../contracts/solana/adapter";
import {
  checkSolanaFunding,
  prepareSolanaFunding,
  SolanaFundingError,
  type SolanaFundingIntent,
} from "../../contracts/solana/funding";
import { parseVaultAmount } from "../../src/lib/payments/vault-amount";
import { isWalletAddress } from "../../src/lib/wallets";
import { json, readJsonObject } from "../http";

/** The caller controls access and resolves only its own registry scope. */
export async function handleSolanaFunding(
  request: Request,
  resolve: (
    network: string,
    vault: string,
    action: {
      step: "review" | "check";
      operation: "deposit" | "withdraw";
    },
  ) => Promise<SolanaEscrowConfig>,
): Promise<Response> {
  const body = await readJsonObject(request, 4096, "vault funding action");
  if (
    !body ||
    (body.step !== "review" && body.step !== "check") ||
    (body.operation !== "deposit" && body.operation !== "withdraw") ||
    typeof body.network !== "string" ||
    typeof body.vault !== "string" ||
    typeof body.wallet !== "string" ||
    !isWalletAddress("solana", body.wallet) ||
    (body.step === "review" &&
      (typeof body.amount !== "string" || body.amount.length > 80)) ||
    (body.step === "check" &&
      (typeof body.gross !== "string" ||
        !/^[1-9][0-9]{0,19}$/.test(body.gross))) ||
    (body.step === "check" &&
      (typeof body.blockhash !== "string" ||
        !isWalletAddress("solana", body.blockhash) ||
        typeof body.transactionId !== "string" ||
        body.transactionId.length > 100))
  )
    return json(400, { error: "invalid_funding_action" });
  const config = await resolve(body.network, body.vault, {
    step: body.step,
    operation: body.operation,
  });
  let gross = body.gross as string;
  if (body.step === "review") {
    const decimals = await solanaMintDecimals(config, config.mint);
    try {
      gross = parseVaultAmount(body.amount as string, decimals).toString();
    } catch {
      return json(422, {
        error: "invalid_funding_amount",
        message:
          "Enter a positive amount within this token's decimal precision and vault limit.",
      });
    }
  }
  const intent: Omit<SolanaFundingIntent, "blockhash"> = {
    operation: body.operation,
    wallet: body.wallet,
    gross,
  };
  try {
    if (body.step === "review")
      return json(200, {
        plan: await prepareSolanaFunding(config, intent),
      });
    return json(200, {
      status: await checkSolanaFunding(
        config,
        { ...intent, blockhash: body.blockhash as string },
        body.transactionId as string,
      ),
    });
  } catch (error) {
    if (error instanceof SolanaFundingError)
      return json(422, {
        error: "funding_action_rejected",
        message: error.message,
      });
    throw error;
  }
}

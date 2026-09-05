import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function validateIdentitySchedules(response, expected) {
  if (
    !Array.isArray(expected) ||
    expected.length !== 1 ||
    typeof expected[0] !== "string" ||
    expected[0].trim() === ""
  ) {
    throw new Error("Identity configuration must declare one cleanup schedule");
  }
  if (
    response?.success !== true ||
    !Array.isArray(response.result?.schedules) ||
    response.result.schedules.length !== expected.length ||
    response.result.schedules.some(
      (entry, index) => entry?.cron !== expected[index],
    )
  ) {
    throw new Error(
      "Identity cleanup schedule differs from canonical configuration",
    );
  }
}

export async function verifyIdentitySchedules({
  configuration,
  accountId,
  token,
  fetchImpl = fetch,
  restoreMissing = false,
}) {
  if (
    !/^[a-f0-9]{32}$/u.test(accountId ?? "") ||
    typeof token !== "string" ||
    token.trim() === "" ||
    typeof configuration?.name !== "string" ||
    !/^[a-z0-9-]+$/u.test(configuration.name)
  ) {
    throw new Error("Identity schedule verification configuration is invalid");
  }
  // Reject malformed canonical configuration before making an authenticated request.
  validateIdentitySchedules(
    {
      success: true,
      result: {
        schedules: configuration.triggers?.crons?.map((cron) => ({ cron })),
      },
    },
    configuration.triggers?.crons,
  );
  let response;
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${configuration.name}/schedules`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    // error-policy:J2 never retain request errors that could contain credentials.
    throw new Error("Identity schedule readback request failed");
  }
  if (!response.ok)
    throw new Error("Identity schedule readback was not successful");
  let body;
  try {
    body = await response.json();
  } catch {
    // error-policy:J2 API bodies are untrusted and must not appear in release logs.
    throw new Error("Identity schedule readback was not valid JSON");
  }
  if (
    restoreMissing &&
    body?.success === true &&
    Array.isArray(body.result?.schedules) &&
    body.result.schedules.length === 0
  ) {
    let restored;
    try {
      restored = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${configuration.name}/schedules`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            configuration.triggers.crons.map((cron) => ({ cron })),
          ),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!restored.ok || (await restored.json())?.success !== true) {
        throw new Error("unsuccessful restoration");
      }
    } catch {
      // error-policy:J2 never retain authenticated request or response details.
      throw new Error("Identity cleanup schedule restoration failed");
    }
    // Do not trust a successful write response as configuration readback evidence.
    return verifyIdentitySchedules({
      configuration,
      accountId,
      token,
      fetchImpl,
    });
  }
  validateIdentitySchedules(body, configuration.triggers.crons);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const restoreMissing = process.argv[2] === "--restore-missing";
    if (
      process.argv.length > (restoreMissing ? 3 : 2) ||
      (restoreMissing &&
        (process.env.GITHUB_ACTIONS !== "true" ||
          process.env.GITHUB_REF !== "refs/heads/develop"))
    ) {
      throw new Error(
        "Schedule restoration requires the protected develop workflow",
      );
    }
    const configuration = Bun.TOML.parse(
      readFileSync(
        new URL("../workers/identity/wrangler.toml", import.meta.url),
        "utf8",
      ),
    );
    await verifyIdentitySchedules({
      configuration,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
      restoreMissing,
    });
    console.log("Identity cleanup schedule matches canonical configuration.");
  } catch {
    // error-policy:J2 print no API response, configuration, or authentication material.
    console.error(
      "Identity cleanup schedule verification failed; inspect the authorized trigger configuration.",
    );
    process.exitCode = 1;
  }
}

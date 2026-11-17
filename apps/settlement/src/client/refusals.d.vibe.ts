export declare const postProjectVaultsByIdSolanaFunding: {
    readonly unauthorized: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidExpectedActor: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly actorChanged: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Project not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailable: {
        readonly status: 503;
        readonly error: "github_unavailable";
        readonly messageFrom: "authority.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly slopbotRequired: {
        readonly status: 409;
        readonly error: "slopbot_required";
        readonly messageFrom: "authority.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly authorityRequired: {
        readonly status: 403;
        readonly error: "authority_required";
        readonly messageFrom: "authority.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifest: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly messageFrom: "control.reason";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly maintainerBanned: {
        readonly status: 403;
        readonly error: "maintainer_banned";
        readonly message: "A moderator banned this maintainer after a confirmed malicious scan result. The account cannot start new Slop participation. The banned account, project steward or original applicant may appeal the project decision.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly internalError: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly originForbidden: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly message: "Requests must come from this site";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidFundingAction: {
        readonly status: 400;
        readonly error: "invalid_funding_action";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidFundingAmount: {
        readonly status: 422;
        readonly error: "invalid_funding_amount";
        readonly message: "Enter a positive amount within this token's decimal precision and vault limit.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingActionRejected: {
        readonly status: 422;
        readonly error: "funding_action_rejected";
        readonly messageFrom: "error.message";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingUnavailable: {
        readonly status: 503;
        readonly error: "funding_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundBountyVaultNotFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Bounty vault not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly projectRestricted: {
        readonly status: 409;
        readonly error: "project_restricted";
        readonly message: "New deposits are unavailable while the project is restricted.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const getProjectVaultsById: {
    readonly unauthorized: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidExpectedActor: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly actorChanged: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Project not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailable: {
        readonly status: 503;
        readonly error: "github_unavailable";
        readonly messageFrom: "authority.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly slopbotRequired: {
        readonly status: 409;
        readonly error: "slopbot_required";
        readonly messageFrom: "authority.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly authorityRequired: {
        readonly status: 403;
        readonly error: "authority_required";
        readonly messageFrom: "authority.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifest: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly messageFrom: "control.reason";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly maintainerBanned: {
        readonly status: 403;
        readonly error: "maintainer_banned";
        readonly message: "A moderator banned this maintainer after a confirmed malicious scan result. The account cannot start new Slop participation. The banned account, project steward or original applicant may appeal the project decision.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly internalError: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly projectRestrictedRequestReinstatementBeforeSetting: {
        readonly status: 409;
        readonly error: "project_restricted";
        readonly message: "Request reinstatement before setting up a vault.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultAuthorityRequired: {
        readonly status: 403;
        readonly error: "vault_authority_required";
        readonly messageFrom: "`Only the project steward or an admin of ${current.manifest.repositories[0].id} can set up the project vault.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailable: {
        readonly status: 503;
        readonly error: "vault_setup_unavailable";
        readonly message: "Vault setup is unavailable on this deployment.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableVaultSetupIsNot: {
        readonly status: 503;
        readonly error: "vault_setup_unavailable";
        readonly message: "Vault setup is not configured on this deployment.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableNoStore: {
        readonly status: 422;
        readonly error: "vault_setup_unavailable";
        readonly messageFrom: "bounty ? \"Save the USDC bounty terms and network before creating a bounty vault.\" : \"Choose a monthly reward amount and network before creating a vault.\"";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly walletSignatureRequired: {
        readonly status: 403;
        readonly error: "wallet_signature_required";
        readonly message: "Confirm the current owner wallet before creating a vault.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableThisNetworkHasNo: {
        readonly status: 422;
        readonly error: "vault_setup_unavailable";
        readonly message: "This network has no reviewed reward asset.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableTheMonthlyAmountExceeds: {
        readonly status: 422;
        readonly error: "vault_setup_unavailable";
        readonly message: "The monthly amount exceeds the Solana vault limit.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultNetworkUnavailable: {
        readonly status: 503;
        readonly error: "vault_network_unavailable";
        readonly message: "The network could not be read. Nothing needs review. Try again in a minute.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly status422: {
        readonly status: 422;
        readonly errorFrom: "error instanceof EvmVaultCreationFailed || error instanceof SolanaVaultCreationFailed ? \"vault_creation_failed\" : \"vault_creation_invalid\"";
        readonly messageFrom: "error instanceof Error ? error.message : family === \"evm\" ? \"The creation transaction could not be verified. Check again.\" : \"The creation transaction could not be verified.\"";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultCreationInvalid: {
        readonly status: 422;
        readonly error: "vault_creation_invalid";
        readonly messageFrom: "creationError.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableVaultCreationIsUnavailable: {
        readonly status: 503;
        readonly error: "vault_setup_unavailable";
        readonly message: "Vault creation is unavailable until this network has a compatible reviewed program.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultRoleConflict: {
        readonly status: 422;
        readonly error: "vault_role_conflict";
        readonly message: "The platform fee wallet must be separate from the vault owner and identity authority.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableVaultCreationIsUnavailableOnThisNetwork: {
        readonly status: 503;
        readonly error: "vault_setup_unavailable";
        readonly message: "Vault creation is unavailable on this network until a compatible factory and its current code are reviewed.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSnapshotUnavailable: {
        readonly status: 503;
        readonly error: "vault_snapshot_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequest: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid vault purpose";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly otherMethods: {
        readonly originForbidden: {
            readonly status: 403;
            readonly error: "origin_forbidden";
            readonly message: "Requests must come from this site";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly invalidContentLength: {
            readonly status: 400;
            readonly error: "invalid_content_length";
            readonly message: "Content-Length must contain only decimal digits";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly payloadTooLarge: {
            readonly status: 413;
            readonly error: "payload_too_large";
            readonly message: "Request body exceeds 65536 bytes";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly invalidRequestRequestBodyMustBe: {
            readonly status: 400;
            readonly error: "invalid_request";
            readonly message: "Request body must be valid UTF-8 JSON";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly invalidRequestRequestBodyMustBeAJSONObject: {
            readonly status: 400;
            readonly error: "invalid_request";
            readonly message: "Request body must be a JSON object";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly invalidRequestRequestBodyHasUnexpected: {
            readonly status: 400;
            readonly error: "invalid_request";
            readonly message: "Request body has unexpected fields";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly invalidRequestInvalidVaultSetupRequest: {
            readonly status: 400;
            readonly error: "invalid_request";
            readonly message: "Invalid vault setup request";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly invalidRequestInvalidExpectedRevision: {
            readonly status: 400;
            readonly error: "invalid_request";
            readonly message: "Invalid expectedRevision";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly staleRevision: {
            readonly status: 409;
            readonly error: "stale_revision";
            readonly message: "The project changed. Reload and review the current policy.";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly vaultAlreadyRegistered: {
            readonly status: 409;
            readonly error: "vault_already_registered";
            readonly message: "This project already has a registered vault.";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly invalidRequestEnterTheVaultCreation: {
            readonly status: 400;
            readonly error: "invalid_request";
            readonly message: "Enter the vault creation transaction hash.";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly staleRevisionTheReviewedProjectRevision: {
            readonly status: 409;
            readonly error: "stale_revision";
            readonly message: "The reviewed project revision is not available.";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly invalidManifestNoStore: {
            readonly status: 422;
            readonly error: "invalid_manifest";
            readonly messageFrom: "error instanceof Error ? error.message : \"Project manifest is invalid\"";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly vaultPolicyChanged: {
            readonly status: 409;
            readonly error: "vault_policy_changed";
            readonly message: "The project asset or vault policy changed. Restore the reviewed policy before registering this creation transaction.";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly projectRestrictedNoStore: {
            readonly status: 409;
            readonly error: "project_restricted";
            readonly messageFrom: "`The project is ${restriction.state}; a revision must keep it paused and retired until reinstatement`";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly repositoryRestricted: {
            readonly status: 403;
            readonly error: "repository_restricted";
            readonly messageFrom: "`This repository belongs to a ${restriction.state} project; only reinstatement can list it again`";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly registryConflict: {
            readonly status: 409;
            readonly error: "registry_conflict";
            readonly messageFrom: "error instanceof Error ? error.message : \"Project conflicts\"";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly skillContentIncomplete: {
            readonly status: 422;
            readonly error: "skill_content_incomplete";
            readonly message: "Complete the generated-skill contribution fields before activation";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly invalidManifestRootSkillPublicationIs: {
            readonly status: 422;
            readonly error: "invalid_manifest";
            readonly message: "Root skill publication is retired; project skills are served at /projects/<id>/SKILL.md";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly vettingRequired: {
            readonly status: 422;
            readonly error: "vetting_required";
            readonly messageFrom: "uncleared === undefined ? `Security vetting is ${vetting.state}. A successful retained admission scan of this repository is required before activation; reinstatement requires fresh evidence.` : `Security vetting of ${uncleared} is ${vetting.state}. A successful retained admission scan of ${uncleared} is required before…";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly registryConflictAnotherProjectListsA: {
            readonly status: 409;
            readonly error: "registry_conflict";
            readonly message: "Another project lists a repository of this revision. Reload before retrying.";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly staleRevisionTheProjectChangedSince: {
            readonly status: 409;
            readonly error: "stale_revision";
            readonly message: "The project changed since you loaded it";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly vaultSetupUnavailableSaveTheUSDCBounty: {
            readonly status: 422;
            readonly error: "vault_setup_unavailable";
            readonly message: "Save the USDC bounty terms before setting up a bounty vault.";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly vaultAlreadyRegisteredThisProjectAlreadyHas: {
            readonly status: 409;
            readonly error: "vault_already_registered";
            readonly message: "This project already has a registered bounty vault.";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
        readonly vaultSetupUnavailableSaveTheMonthlyReward: {
            readonly status: 422;
            readonly error: "vault_setup_unavailable";
            readonly message: "Save the monthly reward policy before setting up a vault.";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-project-api-contract": "project-registry-v1";
            };
        };
    };
};
export declare const postProjectVaultsById: {
    readonly unauthorized: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidExpectedActor: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly actorChanged: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Project not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailable: {
        readonly status: 503;
        readonly error: "github_unavailable";
        readonly messageFrom: "authority.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly slopbotRequired: {
        readonly status: 409;
        readonly error: "slopbot_required";
        readonly messageFrom: "authority.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly authorityRequired: {
        readonly status: 403;
        readonly error: "authority_required";
        readonly messageFrom: "authority.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifest: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly messageFrom: "control.reason";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly maintainerBanned: {
        readonly status: 403;
        readonly error: "maintainer_banned";
        readonly message: "A moderator banned this maintainer after a confirmed malicious scan result. The account cannot start new Slop participation. The banned account, project steward or original applicant may appeal the project decision.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly internalError: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly projectRestrictedRequestReinstatementBeforeSetting: {
        readonly status: 409;
        readonly error: "project_restricted";
        readonly message: "Request reinstatement before setting up a vault.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultAuthorityRequired: {
        readonly status: 403;
        readonly error: "vault_authority_required";
        readonly messageFrom: "`Only the project steward or an admin of ${current.manifest.repositories[0].id} can set up the project vault.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailable: {
        readonly status: 503;
        readonly error: "vault_setup_unavailable";
        readonly message: "Vault setup is unavailable on this deployment.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableVaultSetupIsNot: {
        readonly status: 503;
        readonly error: "vault_setup_unavailable";
        readonly message: "Vault setup is not configured on this deployment.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableNoStore: {
        readonly status: 422;
        readonly error: "vault_setup_unavailable";
        readonly messageFrom: "bounty ? \"Save the USDC bounty terms and network before creating a bounty vault.\" : \"Choose a monthly reward amount and network before creating a vault.\"";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly walletSignatureRequired: {
        readonly status: 403;
        readonly error: "wallet_signature_required";
        readonly message: "Confirm the current owner wallet before creating a vault.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableThisNetworkHasNo: {
        readonly status: 422;
        readonly error: "vault_setup_unavailable";
        readonly message: "This network has no reviewed reward asset.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableTheMonthlyAmountExceeds: {
        readonly status: 422;
        readonly error: "vault_setup_unavailable";
        readonly message: "The monthly amount exceeds the Solana vault limit.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultNetworkUnavailable: {
        readonly status: 503;
        readonly error: "vault_network_unavailable";
        readonly message: "The network could not be read. Nothing needs review. Try again in a minute.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly status422: {
        readonly status: 422;
        readonly errorFrom: "error instanceof EvmVaultCreationFailed || error instanceof SolanaVaultCreationFailed ? \"vault_creation_failed\" : \"vault_creation_invalid\"";
        readonly messageFrom: "error instanceof Error ? error.message : family === \"evm\" ? \"The creation transaction could not be verified. Check again.\" : \"The creation transaction could not be verified.\"";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultCreationInvalid: {
        readonly status: 422;
        readonly error: "vault_creation_invalid";
        readonly messageFrom: "creationError.message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableVaultCreationIsUnavailable: {
        readonly status: 503;
        readonly error: "vault_setup_unavailable";
        readonly message: "Vault creation is unavailable until this network has a compatible reviewed program.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultRoleConflict: {
        readonly status: 422;
        readonly error: "vault_role_conflict";
        readonly message: "The platform fee wallet must be separate from the vault owner and identity authority.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableVaultCreationIsUnavailableOnThisNetwork: {
        readonly status: 503;
        readonly error: "vault_setup_unavailable";
        readonly message: "Vault creation is unavailable on this network until a compatible factory and its current code are reviewed.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSnapshotUnavailable: {
        readonly status: 503;
        readonly error: "vault_snapshot_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly originForbidden: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly message: "Requests must come from this site";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidContentLength: {
        readonly status: 400;
        readonly error: "invalid_content_length";
        readonly message: "Content-Length must contain only decimal digits";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly payloadTooLarge: {
        readonly status: 413;
        readonly error: "payload_too_large";
        readonly message: "Request body exceeds 65536 bytes";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestRequestBodyMustBe: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be valid UTF-8 JSON";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestRequestBodyMustBeAJSONObject: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be a JSON object";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestRequestBodyHasUnexpected: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body has unexpected fields";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestInvalidVaultSetupRequest: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid vault setup request";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestInvalidExpectedRevision: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid expectedRevision";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly staleRevision: {
        readonly status: 409;
        readonly error: "stale_revision";
        readonly message: "The project changed. Reload and review the current policy.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultAlreadyRegistered: {
        readonly status: 409;
        readonly error: "vault_already_registered";
        readonly message: "This project already has a registered vault.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestEnterTheVaultCreation: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Enter the vault creation transaction hash.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly staleRevisionTheReviewedProjectRevision: {
        readonly status: 409;
        readonly error: "stale_revision";
        readonly message: "The reviewed project revision is not available.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestNoStore: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly messageFrom: "error instanceof Error ? error.message : \"Project manifest is invalid\"";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultPolicyChanged: {
        readonly status: 409;
        readonly error: "vault_policy_changed";
        readonly message: "The project asset or vault policy changed. Restore the reviewed policy before registering this creation transaction.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly projectRestrictedNoStore: {
        readonly status: 409;
        readonly error: "project_restricted";
        readonly messageFrom: "`The project is ${restriction.state}; a revision must keep it paused and retired until reinstatement`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly repositoryRestricted: {
        readonly status: 403;
        readonly error: "repository_restricted";
        readonly messageFrom: "`This repository belongs to a ${restriction.state} project; only reinstatement can list it again`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly registryConflict: {
        readonly status: 409;
        readonly error: "registry_conflict";
        readonly messageFrom: "error instanceof Error ? error.message : \"Project conflicts\"";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly skillContentIncomplete: {
        readonly status: 422;
        readonly error: "skill_content_incomplete";
        readonly message: "Complete the generated-skill contribution fields before activation";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestRootSkillPublicationIs: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "Root skill publication is retired; project skills are served at /projects/<id>/SKILL.md";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vettingRequired: {
        readonly status: 422;
        readonly error: "vetting_required";
        readonly messageFrom: "uncleared === undefined ? `Security vetting is ${vetting.state}. A successful retained admission scan of this repository is required before activation; reinstatement requires fresh evidence.` : `Security vetting of ${uncleared} is ${vetting.state}. A successful retained admission scan of ${uncleared} is required before…";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly registryConflictAnotherProjectListsA: {
        readonly status: 409;
        readonly error: "registry_conflict";
        readonly message: "Another project lists a repository of this revision. Reload before retrying.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly staleRevisionTheProjectChangedSince: {
        readonly status: 409;
        readonly error: "stale_revision";
        readonly message: "The project changed since you loaded it";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableSaveTheUSDCBounty: {
        readonly status: 422;
        readonly error: "vault_setup_unavailable";
        readonly message: "Save the USDC bounty terms before setting up a bounty vault.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultAlreadyRegisteredThisProjectAlreadyHas: {
        readonly status: 409;
        readonly error: "vault_already_registered";
        readonly message: "This project already has a registered bounty vault.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vaultSetupUnavailableSaveTheMonthlyReward: {
        readonly status: 422;
        readonly error: "vault_setup_unavailable";
        readonly message: "Save the monthly reward policy before setting up a vault.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const getReferralsMe: {
    readonly signInRequired: {
        readonly status: 401;
        readonly error: "sign_in_required";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorInternalError: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly methodNotAllowed: {
            readonly status: 405;
            readonly error: "method_not_allowed";
            readonly headers: {
                readonly "cache-control": "private, no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const getReferralsAccruals: {
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPublicMaxAge300: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "public, max-age=300";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly methodNotAllowedPublicMaxAge300: {
            readonly status: 405;
            readonly error: "method_not_allowed";
            readonly headers: {
                readonly "cache-control": "public, max-age=300";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const getReferralsAccrualsByPeriod: {
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPublicMaxAge300: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "public, max-age=300";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly methodNotAllowedPublicMaxAge300: {
            readonly status: 405;
            readonly error: "method_not_allowed";
            readonly headers: {
                readonly "cache-control": "public, max-age=300";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const getPoolFunding: {
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly methodNotAllowedPublicMaxAge60SMaxage60: {
            readonly status: 405;
            readonly error: "method_not_allowed";
            readonly headers: {
                readonly "cache-control": "public, max-age=60, s-maxage=60";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const postPaymentsProjectsByIdSolanaFunding: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingUnavailablePrivateNoStore: {
        readonly status: 503;
        readonly error: "funding_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidFundingAction: {
        readonly status: 400;
        readonly error: "invalid_funding_action";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidFundingAmount: {
        readonly status: 422;
        readonly error: "invalid_funding_amount";
        readonly message: "Enter a positive amount within this token's decimal precision and vault limit.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingActionRejected: {
        readonly status: 422;
        readonly error: "funding_action_rejected";
        readonly messageFrom: "error.message";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const postPaymentsProjectsByIdSolanaMonthlyCommitment: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingUnavailablePrivateNoStore: {
        readonly status: 503;
        readonly error: "funding_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidMonthlySetting: {
        readonly status: 400;
        readonly error: "invalid_monthly_setting";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthlySettingRejected: {
        readonly status: 422;
        readonly error: "monthly_setting_rejected";
        readonly messageFrom: "error.message";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsProjectsByIdMonthlyByPeriodAuthorizationByNetwork: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthlyAuthorizationUnavailable: {
        readonly status: 404;
        readonly error: "monthly_authorization_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsProjectsByIdMonthlyByPeriodCuts: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsProjectsByIdTotals: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectPaymentsNotIndexed: {
        readonly status: 503;
        readonly error: "project_payments_not_indexed";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsProjectsByIdVault: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsReceived: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundPrivateNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "private, no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const getPaymentsProjectsByIdDirectTransfers: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidPaymentCursor: {
        readonly status: 400;
        readonly error: "invalid_payment_cursor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsActorsByGithubIdDirectTransfers: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidPaymentCursor: {
        readonly status: 400;
        readonly error: "invalid_payment_cursor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsVaultPayments: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidPaymentCursor: {
        readonly status: 400;
        readonly error: "invalid_payment_cursor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidActor: {
        readonly status: 400;
        readonly error: "invalid_actor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsProjectsByIdVaultPayments: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidPaymentCursor: {
        readonly status: 400;
        readonly error: "invalid_payment_cursor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidActor: {
        readonly status: 400;
        readonly error: "invalid_actor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsActorsByGithubIdVaultPayments: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidPaymentCursor: {
        readonly status: 400;
        readonly error: "invalid_payment_cursor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidActor: {
        readonly status: 400;
        readonly error: "invalid_actor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const postPaymentsProjectsByIdMonthlyByPeriodSolanaCommitment: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpired: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedIn: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unauthorizedSignInWithGitHub: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorExpectedGitHubActorIs: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedYourAccountChangedReload: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectUnavailable: {
        readonly status: 404;
        readonly error: "project_unavailable";
        readonly message: "This project has no vault awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectChanged: {
        readonly status: 409;
        readonly error: "project_changed";
        readonly message: "The project changed. Reload its awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidCommitmentReview: {
        readonly status: 400;
        readonly error: "invalid_commitment_review";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectRestrictedThisProjectIsRestricted: {
        readonly status: 409;
        readonly error: "project_restricted";
        readonly message: "This project is restricted. New award reservations are unavailable.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly vaultNotServed: {
        readonly status: 409;
        readonly error: "vault_not_served";
        readonly message: "Award processing is not configured for this network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly snapshotChanged: {
        readonly status: 409;
        readonly error: "snapshot_changed";
        readonly message: "The finalized awards differ. Reload them.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly vaultChanged: {
        readonly status: 409;
        readonly error: "vault_changed";
        readonly message: "The vault changed after this month was finalized.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly awardExcluded: {
        readonly status: 403;
        readonly error: "award_excluded";
        readonly message: "This account was banned before the award was funded.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly awardUnfunded: {
        readonly status: 409;
        readonly error: "award_unfunded";
        readonly message: "This award waits for enough free vault funds.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthlyAutomatic: {
        readonly status: 409;
        readonly error: "monthly_automatic";
        readonly message: "Automatic monthly payment reserves this award. Turn it off to reserve awards by hand.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly awardConflict: {
        readonly status: 409;
        readonly error: "award_conflict";
        readonly message: "Another award is already reserved under this award's source; this award cannot be reserved.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly awardReserved: {
        readonly status: 409;
        readonly error: "award_reserved";
        readonly message: "This award is already reserved on the finalized chain.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly ownerCommitmentUnavailable: {
        readonly status: 503;
        readonly error: "owner_commitment_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidCommitmentAction: {
        readonly status: 400;
        readonly error: "invalid_commitment_action";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly commitmentVaultChanged: {
        readonly status: 409;
        readonly error: "commitment_vault_changed";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly commitmentVaultChangedTheVaultChangedDuring: {
        readonly status: 409;
        readonly error: "commitment_vault_changed";
        readonly message: "The vault changed during review. Reload its current awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidCommitmentCheck: {
        readonly status: 400;
        readonly error: "invalid_commitment_check";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly commitmentActionRejected: {
        readonly status: 422;
        readonly error: "commitment_action_rejected";
        readonly messageFrom: "error.message";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const postPaymentsProjectsByIdMonthlySettings: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpired: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedIn: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unauthorizedSignInWithGitHub: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorExpectedGitHubActorIs: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedYourAccountChangedReload: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectUnavailable: {
        readonly status: 404;
        readonly error: "project_unavailable";
        readonly message: "This project has no vault awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectChanged: {
        readonly status: 409;
        readonly error: "project_changed";
        readonly message: "The project changed. Reload its awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthlyAwardsUnavailable: {
        readonly status: 503;
        readonly error: "monthly_awards_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly accountBanned: {
        readonly status: 403;
        readonly error: "account_banned";
        readonly message: "This account cannot change or finalize new monthly awards while banned.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentRegistryUnavailable: {
        readonly status: 503;
        readonly error: "payment_registry_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidMonthlySetting: {
        readonly status: 400;
        readonly error: "invalid_monthly_setting";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly cutNoticeWindow: {
        readonly status: 409;
        readonly error: "cut_notice_window";
        readonly messageFrom: "`A cut in ${row.period} has less than 24 hours of notice before the cutoff. Automatic finalization can be turned on after ${utcMinute(new Date(noticeEnds))}, or finalize the month yourself then.`";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly settingChanged: {
        readonly status: 409;
        readonly error: "setting_changed";
        readonly message: "The setting changed at the same time. Retry.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsProjectsByIdMonthlyByPeriod: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpired: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedIn: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unauthorizedSignInWithGitHub: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorExpectedGitHubActorIs: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedYourAccountChangedReload: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectUnavailable: {
        readonly status: 404;
        readonly error: "project_unavailable";
        readonly message: "This project has no vault awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectChanged: {
        readonly status: 409;
        readonly error: "project_changed";
        readonly message: "The project changed. Reload its awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthlyAwardsUnavailable: {
        readonly status: 503;
        readonly error: "monthly_awards_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly proposalIncomplete: {
        readonly status: 503;
        readonly error: "proposal_incomplete";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const postPaymentsProjectsByIdMonthlyByPeriodReserveRelease: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpired: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedIn: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unauthorizedSignInWithGitHub: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorExpectedGitHubActorIs: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedYourAccountChangedReload: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectUnavailable: {
        readonly status: 404;
        readonly error: "project_unavailable";
        readonly message: "This project has no vault awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectChanged: {
        readonly status: 409;
        readonly error: "project_changed";
        readonly message: "The project changed. Reload its awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthlyAwardsUnavailable: {
        readonly status: 503;
        readonly error: "monthly_awards_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidReleaseReview: {
        readonly status: 400;
        readonly error: "invalid_release_review";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly releaseUnavailable: {
        readonly status: 503;
        readonly error: "release_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly releaseHeld: {
        readonly status: 409;
        readonly error: "release_held";
        readonly message: "The reserve could not be proved safe to release. No funds moved. Retry the check.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const postPaymentsProjectsByIdMonthlyByPeriodAllocations: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpired: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedIn: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unauthorizedSignInWithGitHub: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorExpectedGitHubActorIs: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedYourAccountChangedReload: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectUnavailable: {
        readonly status: 404;
        readonly error: "project_unavailable";
        readonly message: "This project has no vault awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectChanged: {
        readonly status: 409;
        readonly error: "project_changed";
        readonly message: "The project changed. Reload its awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthlyAwardsUnavailable: {
        readonly status: 503;
        readonly error: "monthly_awards_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly accountBanned: {
        readonly status: 403;
        readonly error: "account_banned";
        readonly message: "This account cannot change or finalize new monthly awards while banned.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentRegistryUnavailable: {
        readonly status: 503;
        readonly error: "payment_registry_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly proposalIncomplete: {
        readonly status: 503;
        readonly error: "proposal_incomplete";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly proposalUnavailable: {
        readonly status: 404;
        readonly error: "proposal_unavailable";
        readonly message: "No allocation has been proposed for this month.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidAllocation: {
        readonly status: 400;
        readonly error: "invalid_allocation";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthFrozen: {
        readonly status: 409;
        readonly error: "month_frozen";
        readonly message: "This month is finalized. Its allocations can no longer change.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly allocationsChanged: {
        readonly status: 409;
        readonly error: "allocations_changed";
        readonly message: "The allocations changed. Reload them before saving.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly cutReasonRequired: {
        readonly status: 400;
        readonly error: "cut_reason_required";
        readonly message: "An amount below the proposed amount needs a reason of 20 to 500 characters. The reason is public and sent to the contributor.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly cutNoticeWindowPrivateNoStore: {
        readonly status: 409;
        readonly error: "cut_notice_window";
        readonly messageFrom: "`A contributor gets 24 hours of notice before a cut takes effect. With automatic finalization on, cuts close at ${utcMinute(noticeDeadline as Date)}, 24 hours before the cutoff.`";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly cutoffPassed: {
        readonly status: 409;
        readonly error: "cutoff_passed";
        readonly message: "The cutoff for this month has passed. The automatic process pays the current allocations.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const postPaymentsProjectsByIdMonthlyByPeriodFinalize: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpired: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedIn: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unauthorizedSignInWithGitHub: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorExpectedGitHubActorIs: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedYourAccountChangedReload: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectUnavailable: {
        readonly status: 404;
        readonly error: "project_unavailable";
        readonly message: "This project has no vault awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectChanged: {
        readonly status: 409;
        readonly error: "project_changed";
        readonly message: "The project changed. Reload its awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthlyAwardsUnavailable: {
        readonly status: 503;
        readonly error: "monthly_awards_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly accountBanned: {
        readonly status: 403;
        readonly error: "account_banned";
        readonly message: "This account cannot change or finalize new monthly awards while banned.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentRegistryUnavailable: {
        readonly status: 503;
        readonly error: "payment_registry_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly proposalIncomplete: {
        readonly status: 503;
        readonly error: "proposal_incomplete";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly proposalUnavailable: {
        readonly status: 404;
        readonly error: "proposal_unavailable";
        readonly message: "No allocation has been proposed for this month.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidFinalization: {
        readonly status: 400;
        readonly error: "invalid_finalization";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectRestrictedThisProjectIsRestrictedItsAwardsCannot: {
        readonly status: 409;
        readonly error: "project_restricted";
        readonly message: "This project is restricted. Its awards cannot be finalized now.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly vaultNotServedAwardProcessingIsNot: {
        readonly status: 409;
        readonly error: "vault_not_served";
        readonly message: "Award processing is not configured for this project's vault network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly cutNoticePending: {
        readonly status: 409;
        readonly error: "cut_notice_pending";
        readonly messageFrom: "`A contributor gets 24 hours of notice after a cut. You can finalize this month from ${utcMinute(allowedAt)}.`";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthOpen: {
        readonly status: 409;
        readonly error: "month_open";
        readonly message: "This month has not closed.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly financialPolicyChanged: {
        readonly status: 409;
        readonly error: "financial_policy_changed";
        readonly message: "The project's payment terms changed after this month was proposed.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly financialPolicyChangedTheProjectSVault: {
        readonly status: 409;
        readonly error: "financial_policy_changed";
        readonly message: "The project's vault or asset changed after this month was proposed.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly allocationsChangedTheAllocationsChangedReload: {
        readonly status: 409;
        readonly error: "allocations_changed";
        readonly message: "The allocations changed. Reload them before finalizing.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly allocationsChangedTheAllocationsChangedWhile: {
        readonly status: 409;
        readonly error: "allocations_changed";
        readonly message: "The allocations changed while finalizing. Retry.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthNotFrozen: {
        readonly status: 404;
        readonly error: "month_not_frozen";
        readonly message: "This month has not been finalized.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const postPaymentsProjectsByIdMonthlyByPeriodCommitment: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpired: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedIn: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unauthorizedSignInWithGitHub: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorExpectedGitHubActorIs: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedYourAccountChangedReload: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notFoundPrivateNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectUnavailable: {
        readonly status: 404;
        readonly error: "project_unavailable";
        readonly message: "This project has no vault awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectChanged: {
        readonly status: 409;
        readonly error: "project_changed";
        readonly message: "The project changed. Reload its awards.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidCommitmentReview: {
        readonly status: 400;
        readonly error: "invalid_commitment_review";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly projectRestrictedThisProjectIsRestricted: {
        readonly status: 409;
        readonly error: "project_restricted";
        readonly message: "This project is restricted. New award reservations are unavailable.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly vaultNotServed: {
        readonly status: 409;
        readonly error: "vault_not_served";
        readonly message: "Award processing is not configured for this network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly snapshotChanged: {
        readonly status: 409;
        readonly error: "snapshot_changed";
        readonly message: "The finalized awards differ. Reload them.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly vaultChanged: {
        readonly status: 409;
        readonly error: "vault_changed";
        readonly message: "The vault changed after this month was finalized.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly awardExcluded: {
        readonly status: 403;
        readonly error: "award_excluded";
        readonly message: "This account was banned before the award was funded.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly awardUnfunded: {
        readonly status: 409;
        readonly error: "award_unfunded";
        readonly message: "This award waits for enough free vault funds.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthlyAutomatic: {
        readonly status: 409;
        readonly error: "monthly_automatic";
        readonly message: "Automatic monthly payment reserves this award. Turn it off to reserve awards by hand.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly awardConflict: {
        readonly status: 409;
        readonly error: "award_conflict";
        readonly message: "Another award is already reserved under this award's source; this award cannot be reserved.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly awardReserved: {
        readonly status: 409;
        readonly error: "award_reserved";
        readonly message: "This award is already reserved on the finalized chain.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly monthlyAwardsUnavailable: {
        readonly status: 503;
        readonly error: "monthly_awards_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPaymentsMe: {
    readonly originForbiddenPrivateNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly fundingVaultNotFound: {
        readonly status: 404;
        readonly error: "funding_vault_not_found";
        readonly message: "This project has no such vault on a served network.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentsUnavailable: {
        readonly status: 503;
        readonly error: "payments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorPrivateNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpired: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedIn: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unauthorizedSignInWithGitHub: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Sign in with GitHub";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorExpectedGitHubActorIs: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly message: "Expected GitHub actor is invalid";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedYourAccountChangedReload: {
        readonly status: 403;
        readonly error: "actor_changed";
        readonly message: "Your account changed. Reload your private view before continuing.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundPrivateNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "private, no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const postOperatorWalletBindingsReconcile: {
    readonly notFoundS404: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly httpsRequired: {
        readonly status: 400;
        readonly error: "https_required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly forbidden: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Same-origin operator session is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly originNotAllowed: {
        readonly status: 403;
        readonly error: "origin_not_allowed";
        readonly message: "Same-origin access is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly unauthorizedAuthenticationFailed: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Authentication failed";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly forbiddenOperatorAccessIsRequired: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Operator access is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidContentLengthContentLengthMustContain: {
        readonly status: 400;
        readonly error: "invalid_content_length";
        readonly message: "Content-Length must contain only decimal digits";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly payloadTooLargeRequestBodyExceeds65536: {
        readonly status: 413;
        readonly error: "payload_too_large";
        readonly message: "Request body exceeds 65536 bytes";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestRequestBodyMustBeValidUTF8: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be valid UTF-8 JSON";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestNoStore: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be a JSON object";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestAnExactBindingWinner: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "An exact binding, winner and recovery reason are required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly recoveryUnavailable: {
        readonly status: 503;
        readonly error: "recovery_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly recoveryPendingOrRejected: {
        readonly status: 409;
        readonly error: "recovery_pending_or_rejected";
        readonly message: "Binding recovery is pending or refused";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly internalErrorNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
};
export declare const attesterPostV1ReconcileBinding: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly notFoundEntrypoint: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly bindingRecoveryUnavailable: {
        readonly status: 409;
        readonly error: "binding_recovery_unavailable";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly bindingRecoveryPendingOrRejected: {
        readonly status: 409;
        readonly error: "binding_recovery_pending_or_rejected";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
};
export declare const attesterPostV1BindDestinations: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly monthlyAlreadyAdmitted: {
        readonly status: 409;
        readonly error: "monthly_already_admitted";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly executionPendingOrRejected: {
        readonly status: 409;
        readonly error: "execution_pending_or_rejected";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
};
export declare const attesterPostV1CommitMonthly: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly monthlyAlreadyAdmitted: {
        readonly status: 409;
        readonly error: "monthly_already_admitted";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly executionPendingOrRejected: {
        readonly status: 409;
        readonly error: "execution_pending_or_rejected";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
};
export declare const attesterPostV1MonthlyReserveRelease: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly monthlyAlreadyAdmitted: {
        readonly status: 409;
        readonly error: "monthly_already_admitted";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly executionPendingOrRejected: {
        readonly status: 409;
        readonly error: "execution_pending_or_rejected";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly notFoundEntrypoint: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
};
export declare const attesterPostV1MonthlyAuthorization: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly monthlyAlreadyAdmitted: {
        readonly status: 409;
        readonly error: "monthly_already_admitted";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly executionPendingOrRejected: {
        readonly status: 409;
        readonly error: "execution_pending_or_rejected";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
};
export declare const attesterPostV1AttemptStatus: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly monthlyAlreadyAdmitted: {
        readonly status: 409;
        readonly error: "monthly_already_admitted";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly executionPendingOrRejected: {
        readonly status: 409;
        readonly error: "execution_pending_or_rejected";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
};
export declare const attesterPostV1CancelUnsubmitted: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly monthlyAlreadyAdmitted: {
        readonly status: 409;
        readonly error: "monthly_already_admitted";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly executionPendingOrRejected: {
        readonly status: 409;
        readonly error: "execution_pending_or_rejected";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
};
export declare const attesterPostV1Pay: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly monthlyAlreadyAdmitted: {
        readonly status: 409;
        readonly error: "monthly_already_admitted";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly executionPendingOrRejected: {
        readonly status: 409;
        readonly error: "execution_pending_or_rejected";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly notFoundEntrypoint: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly idempotencyKeyRequired: {
        readonly status: 400;
        readonly text: "Idempotency key required";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
};
export declare const attesterPostV1CompleteBind: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly monthlyAlreadyAdmitted: {
        readonly status: 409;
        readonly error: "monthly_already_admitted";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly executionPendingOrRejected: {
        readonly status: 409;
        readonly error: "execution_pending_or_rejected";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly notFoundEntrypoint: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly idempotencyKeyRequired: {
        readonly status: 400;
        readonly text: "Idempotency key required";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
};
export declare const attesterPostV1SecurityAny: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
    readonly notFoundEntrypoint: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
};
export declare const keeperPostTick: {
    readonly keeperRunFailed: {
        readonly status: 503;
        readonly error: "keeper_run_failed";
        readonly headers: {
            readonly "content-type": "application/json";
        };
    };
    readonly otherMethods: {
        readonly notFoundV2: {
            readonly status: 404;
            readonly text: "Not found";
            readonly headers: {
                readonly "content-type": "text/plain;charset=UTF-8";
            };
        };
    };
};
export declare const keeperWorkerAnyAny: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
};
export declare const referralAccrualAnyAny: {
    readonly notFoundV2: {
        readonly status: 404;
        readonly text: "Not found";
        readonly headers: {
            readonly "content-type": "text/plain;charset=UTF-8";
        };
    };
};

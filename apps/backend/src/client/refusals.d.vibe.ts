export declare const getProjects: {
    readonly notFound: {
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
    };
};
export declare const getProjectRevisions: {
    readonly notFound: {
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
    };
};
export declare const getProjectRevisionsByIdByRevision: {
    readonly notFound: {
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
    readonly notFoundRevisionNotFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Revision not found";
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
    };
};
export declare const getProjectAccountBans: {
    readonly notFound: {
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
    };
};
export declare const getProjectsById: {
    readonly notFound: {
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
    readonly notFoundProjectNotFound: {
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
    readonly projectRestricted: {
        readonly status: 410;
        readonly error: "project_restricted";
        readonly messageFrom: "`This project is ${restriction.state}. Its history stays public; its skills and participation are closed. ${appeal} with POST /api/v1/project-appeals.`";
        readonly fields: readonly ["restriction"];
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
    };
};
export declare const getProjectGithubOwnedRepositories: {
    readonly notFound: {
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
    readonly githubRateLimited: {
        readonly status: 503;
        readonly error: "github_rate_limited";
        readonly message: "GitHub limited lookups.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailable: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly messageFrom: "`GitHub returned ${response.status}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnUnexpected: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an unexpected response.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestEnterTheRepositoryAs: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Enter the repository as owner/name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableThePublicGitHubLookup: {
        readonly status: 503;
        readonly error: "github_unavailable";
        readonly message: "The public GitHub lookup credential is not configured.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundGitHubHasNoPublic: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "GitHub has no public repository with that name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedIncompleteRepository: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned incomplete repository facts.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchList: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch list.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchName: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchCommit: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch commit.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchPageCursor: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch page cursor.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedTooManyBranchPages: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned too many branch pages.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubDidNotReturn: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub did not return the default branch. Try again.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly personalAccountRequired: {
        readonly status: 422;
        readonly error: "personal_account_required";
        readonly messageFrom: "`@${login} is a GitHub ${user.type} account. Enter a person's GitHub account.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedIncompleteAccount: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned incomplete account facts.";
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
        readonly message: "The signed-in GitHub login is not valid.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubAccountFactsCould: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub account facts could not be read. Try again.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalid: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid repository page link.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedTooMany: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned too many repository pages.";
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
    };
};
export declare const getProjectGithubRepositoriesByOwnerByName: {
    readonly notFound: {
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
    readonly githubRateLimited: {
        readonly status: 503;
        readonly error: "github_rate_limited";
        readonly message: "GitHub limited lookups.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailable: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly messageFrom: "`GitHub returned ${response.status}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnUnexpected: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an unexpected response.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestEnterTheRepositoryAs: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Enter the repository as owner/name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableThePublicGitHubLookup: {
        readonly status: 503;
        readonly error: "github_unavailable";
        readonly message: "The public GitHub lookup credential is not configured.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundGitHubHasNoPublic: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "GitHub has no public repository with that name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedIncompleteRepository: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned incomplete repository facts.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchList: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch list.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchName: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchCommit: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch commit.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchPageCursor: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch page cursor.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedTooManyBranchPages: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned too many branch pages.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubDidNotReturn: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub did not return the default branch. Try again.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly personalAccountRequired: {
        readonly status: 422;
        readonly error: "personal_account_required";
        readonly messageFrom: "`@${login} is a GitHub ${user.type} account. Enter a person's GitHub account.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedIncompleteAccount: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned incomplete account facts.";
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
        readonly message: "The signed-in GitHub login is not valid.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubAccountFactsCould: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub account facts could not be read. Try again.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalid: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid repository page link.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedTooMany: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned too many repository pages.";
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
    };
};
export declare const getProjectSession: {
    readonly notFound: {
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
    };
};
export declare const postProjects: {
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
    readonly notFound: {
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
    readonly staleRevision: {
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
    readonly invalidManifest: {
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
    readonly invalidManifestABountyAmountNeeds: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "A bounty amount needs security bounty terms";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly rewardAssetUnverified: {
        readonly status: 422;
        readonly error: "reward_asset_unverified";
        readonly messageFrom: "`The reward token could not be verified on ${network.name}: ${error.message}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly rewardAssetUnverifiedNoStore: {
        readonly status: 503;
        readonly error: "reward_asset_unverified";
        readonly messageFrom: "`${network.name} could not be reached to verify the reward token. Try again.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestSendTheBountyAmount: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "Send the bounty amount in whole asset units when creating or changing its award";
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
        readonly messageFrom: "`The bounty amount is invalid: ${error instanceof Error ? error.message : \"check the amount\"}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubRateLimited: {
        readonly status: 503;
        readonly error: "github_rate_limited";
        readonly message: "GitHub limited lookups.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailable: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly messageFrom: "`GitHub returned ${response.status}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnUnexpected: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an unexpected response.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestV3: {
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
    readonly githubUnavailableNoStore: {
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
    readonly invalidManifestAMonthlyAmountNeeds: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "A monthly amount needs a monthly pool";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestS422: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly messageFrom: "`The monthly amount is invalid: ${error instanceof Error ? error.message : \"check the amount\"}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly registryConflictNoStore: {
        readonly status: 409;
        readonly error: "registry_conflict";
        readonly messageFrom: "`GitHub repository ${githubId}${typeof name === \"string\" ? ` (${name})` : \"\"} is already listed by project ${owner}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly personalAccountRequired: {
        readonly status: 422;
        readonly error: "personal_account_required";
        readonly messageFrom: "`@${login} is a GitHub ${user.type} account. Enter a person's GitHub account.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedIncompleteAccount: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned incomplete account facts.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestV2: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly messageFrom: "message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securitySplitRestricted: {
        readonly status: 422;
        readonly error: "security_split_restricted";
        readonly message: "A new bounty uses the 75/25 researcher/Slop split; an admin must approve any full-award exception";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityContactsRestricted: {
        readonly status: 422;
        readonly error: "security_contacts_restricted";
        readonly message: "A new bounty names its signed-in creator as its private-case contact and sponsor; verified owners can manage contacts after setup";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidReferrer: {
        readonly status: 422;
        readonly error: "invalid_referrer";
        readonly message: "The referrer must be a GitHub login.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidReferrerNoStore: {
        readonly status: 422;
        readonly error: "invalid_referrer";
        readonly messageFrom: "`@${value} has not signed in to slop.cash, so they cannot be recorded as the referrer. Clear the referral or ask them to sign in first.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidReferrerYouCannotReferYour: {
        readonly status: 422;
        readonly error: "invalid_referrer";
        readonly message: "You cannot refer your own project.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidReferrerTheProjectStewardCannot: {
        readonly status: 422;
        readonly error: "invalid_referrer";
        readonly message: "The project steward cannot be recorded as its referrer.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidReferrerSlopTeamAccountsCannot: {
        readonly status: 422;
        readonly error: "invalid_referrer";
        readonly message: "Slop team accounts cannot be recorded as referrers.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly registryConflictTheProjectIdRepository: {
        readonly status: 409;
        readonly error: "registry_conflict";
        readonly message: "The project id, repository or restrictions changed. Reload before creating it.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const putProjectsById: {
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
    readonly notFound: {
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
    readonly staleRevision: {
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
    readonly invalidManifest: {
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
    readonly invalidManifestABountyAmountNeeds: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "A bounty amount needs security bounty terms";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly rewardAssetUnverified: {
        readonly status: 422;
        readonly error: "reward_asset_unverified";
        readonly messageFrom: "`The reward token could not be verified on ${network.name}: ${error.message}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly rewardAssetUnverifiedNoStore: {
        readonly status: 503;
        readonly error: "reward_asset_unverified";
        readonly messageFrom: "`${network.name} could not be reached to verify the reward token. Try again.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestSendTheBountyAmount: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "Send the bounty amount in whole asset units when creating or changing its award";
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
        readonly messageFrom: "`The bounty amount is invalid: ${error instanceof Error ? error.message : \"check the amount\"}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubRateLimited: {
        readonly status: 503;
        readonly error: "github_rate_limited";
        readonly message: "GitHub limited lookups.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailable: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly messageFrom: "`GitHub returned ${response.status}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnUnexpected: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an unexpected response.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestV3: {
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
    readonly githubUnavailableNoStore: {
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
    readonly invalidManifestAMonthlyAmountNeeds: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "A monthly amount needs a monthly pool";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestS422: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly messageFrom: "`The monthly amount is invalid: ${error instanceof Error ? error.message : \"check the amount\"}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly registryConflictNoStore: {
        readonly status: 409;
        readonly error: "registry_conflict";
        readonly messageFrom: "`GitHub repository ${githubId}${typeof name === \"string\" ? ` (${name})` : \"\"} is already listed by project ${owner}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundProjectNotFound: {
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
    readonly invalidRequestInvalidReason: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid reason";
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
    readonly invalidManifestProjectIdCannotChange: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "Project id cannot change";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly noChange: {
        readonly status: 422;
        readonly error: "no_change";
        readonly message: "The revision changes nothing";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestEnterTheRepositoryAs: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Enter the repository as owner/name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableThePublicGitHubLookup: {
        readonly status: 503;
        readonly error: "github_unavailable";
        readonly message: "The public GitHub lookup credential is not configured.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundGitHubHasNoPublic: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "GitHub has no public repository with that name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedIncompleteRepository: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned incomplete repository facts.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchList: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch list.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchName: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchCommit: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch commit.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchPageCursor: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch page cursor.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedTooManyBranchPages: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned too many branch pages.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubDidNotReturn: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub did not return the default branch. Try again.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestReasonMustBe1: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "reason must be 1 to 500 characters";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestProjectManifestIsInvalid: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "Project manifest is invalid";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly staleRevisionNoStore: {
        readonly status: 409;
        readonly error: "stale_revision";
        readonly messageFrom: "stored ? \"The project changed after this update was saved; make the change again in the project's settings\" : \"The project changed since you loaded it\"";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly projectRestrictedS409: {
        readonly status: 409;
        readonly error: "project_restricted";
        readonly messageFrom: "`The project is ${restriction.state}; request reinstatement before changing it`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestricted: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "Historical cycle caps cannot change";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly ownerFieldRestricted: {
        readonly status: 422;
        readonly error: "owner_field_restricted";
        readonly messageFrom: "`These fields do not change through owner self-service: ${restricted.join(\", \")}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityProgramRequired: {
        readonly status: 422;
        readonly error: "security_program_required";
        readonly message: "Close the bounty program instead of deleting it; existing reports and awards remain available";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securitySplitRestrictedOnlyAnAdminCan: {
        readonly status: 422;
        readonly error: "security_split_restricted";
        readonly message: "Only an admin can change the approved researcher/Slop split";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityContactsRestrictedOnlyTheProjectSteward: {
        readonly status: 422;
        readonly error: "security_contacts_restricted";
        readonly message: "Only the project steward or a repository admin can change bounty contacts or the sponsor";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityContactsRestrictedOnlyTheProjectStewardOrARepository: {
        readonly status: 422;
        readonly error: "security_contacts_restricted";
        readonly message: "Only the project steward or a repository admin can name other bounty contacts or a sponsor";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityVaultRestricted: {
        readonly status: 422;
        readonly error: "security_vault_restricted";
        readonly message: "Keep the verified bounty vault; a new vault needs verified registration";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityAssetRestricted: {
        readonly status: 422;
        readonly error: "security_asset_restricted";
        readonly message: "A funded bounty program keeps its network and asset";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityFundingUnavailable: {
        readonly status: 422;
        readonly error: "security_funding_unavailable";
        readonly message: "Opening requires available funds in a verified bounty vault with a current finalized balance";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepositoryStart: {
        readonly status: 422;
        readonly error: "invalid_repository_start";
        readonly messageFrom: "`${entry.id} must count from ${countsFrom}, the start of the next UTC month.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepository: {
        readonly status: 422;
        readonly error: "invalid_repository";
        readonly messageFrom: "`The display name of ${entry.id} must be ${entry.id}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepositoryNoStore: {
        readonly status: 422;
        readonly error: "invalid_repository";
        readonly messageFrom: "`${entry.id} needs its permanent GitHub ids.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepositoryS422: {
        readonly status: 422;
        readonly error: "invalid_repository";
        readonly messageFrom: "`GitHub has no public repository named ${entry.id}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableInternalError: {
        readonly status: 503;
        readonly error: "github_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepositoryV2: {
        readonly status: 422;
        readonly error: "invalid_repository";
        readonly messageFrom: "refusal";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepositoryV3: {
        readonly status: 422;
        readonly error: "invalid_repository";
        readonly messageFrom: "`GitHub reports different facts for ${entry.id}. Look it up again.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedOnlyAMonthlyReward: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "Only a monthly reward changes through owner self-service";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedASeparateReviewBudget: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "A separate review budget is not offered; review credit comes from the shared scoring policy";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedFundingRoutesDoNot: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "Funding routes do not change through owner self-service";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedUseVaultSetupTo: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "Use vault setup to register a verified owner vault; a manifest edit cannot change vault records";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedAFundedProjectKeeps: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "A funded project keeps its network, asset and vault";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedOnlyTheMonthlyAmount: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "Only the monthly amount, network and asset change through owner self-service";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const postProjectsByIdRemove: {
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
    readonly notFound: {
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
    readonly staleRevision: {
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
    readonly invalidManifest: {
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
    readonly invalidManifestV3: {
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
    readonly githubUnavailableNoStore: {
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
    readonly notFoundProjectNotFound: {
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
};
export declare const getProjectSetup: {
    readonly notFound: {
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
    };
};
export declare const getProjectSetupById: {
    readonly notFound: {
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
    readonly invalidManifestV3: {
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
    readonly githubUnavailableNoStore: {
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
    readonly notFoundProjectNotFound: {
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
    };
};
export declare const postProjectSetupByIdCheck: {
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
    readonly notFound: {
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
    readonly staleRevision: {
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
    readonly invalidManifest: {
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
    readonly invalidManifestV3: {
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
    readonly notFoundProjectNotFound: {
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
    readonly invalidRequestInvalidRequestScan: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid requestScan";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const getProjectApplicationsMine: {
    readonly notFound: {
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
    };
};
export declare const postProjectApplicationsByIdPublish: {
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
    readonly notFound: {
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
    readonly staleRevision: {
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
    readonly invalidManifest: {
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
    readonly invalidManifestABountyAmountNeeds: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "A bounty amount needs security bounty terms";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly rewardAssetUnverified: {
        readonly status: 422;
        readonly error: "reward_asset_unverified";
        readonly messageFrom: "`The reward token could not be verified on ${network.name}: ${error.message}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly rewardAssetUnverifiedNoStore: {
        readonly status: 503;
        readonly error: "reward_asset_unverified";
        readonly messageFrom: "`${network.name} could not be reached to verify the reward token. Try again.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestSendTheBountyAmount: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "Send the bounty amount in whole asset units when creating or changing its award";
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
        readonly messageFrom: "`The bounty amount is invalid: ${error instanceof Error ? error.message : \"check the amount\"}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubRateLimited: {
        readonly status: 503;
        readonly error: "github_rate_limited";
        readonly message: "GitHub limited lookups.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailable: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly messageFrom: "`GitHub returned ${response.status}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnUnexpected: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an unexpected response.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestV3: {
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
    readonly githubUnavailableNoStore: {
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
    readonly invalidManifestAMonthlyAmountNeeds: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "A monthly amount needs a monthly pool";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestS422: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly messageFrom: "`The monthly amount is invalid: ${error instanceof Error ? error.message : \"check the amount\"}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly registryConflictNoStore: {
        readonly status: 409;
        readonly error: "registry_conflict";
        readonly messageFrom: "`GitHub repository ${githubId}${typeof name === \"string\" ? ` (${name})` : \"\"} is already listed by project ${owner}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundProjectNotFound: {
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
    readonly invalidRequestInvalidReason: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid reason";
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
    readonly invalidManifestProjectIdCannotChange: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "Project id cannot change";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly noChange: {
        readonly status: 422;
        readonly error: "no_change";
        readonly message: "The revision changes nothing";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestEnterTheRepositoryAs: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Enter the repository as owner/name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableThePublicGitHubLookup: {
        readonly status: 503;
        readonly error: "github_unavailable";
        readonly message: "The public GitHub lookup credential is not configured.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundGitHubHasNoPublic: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "GitHub has no public repository with that name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedIncompleteRepository: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned incomplete repository facts.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchList: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch list.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchName: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchCommit: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch commit.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnInvalidBranchPageCursor: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an invalid branch page cursor.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedTooManyBranchPages: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned too many branch pages.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubDidNotReturn: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub did not return the default branch. Try again.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestReasonMustBe1: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "reason must be 1 to 500 characters";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestProjectManifestIsInvalid: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "Project manifest is invalid";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly staleRevisionNoStore: {
        readonly status: 409;
        readonly error: "stale_revision";
        readonly messageFrom: "stored ? \"The project changed after this update was saved; make the change again in the project's settings\" : \"The project changed since you loaded it\"";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly projectRestrictedS409: {
        readonly status: 409;
        readonly error: "project_restricted";
        readonly messageFrom: "`The project is ${restriction.state}; request reinstatement before changing it`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestricted: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "Historical cycle caps cannot change";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly ownerFieldRestricted: {
        readonly status: 422;
        readonly error: "owner_field_restricted";
        readonly messageFrom: "`These fields do not change through owner self-service: ${restricted.join(\", \")}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityProgramRequired: {
        readonly status: 422;
        readonly error: "security_program_required";
        readonly message: "Close the bounty program instead of deleting it; existing reports and awards remain available";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securitySplitRestrictedOnlyAnAdminCan: {
        readonly status: 422;
        readonly error: "security_split_restricted";
        readonly message: "Only an admin can change the approved researcher/Slop split";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityContactsRestrictedOnlyTheProjectSteward: {
        readonly status: 422;
        readonly error: "security_contacts_restricted";
        readonly message: "Only the project steward or a repository admin can change bounty contacts or the sponsor";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityContactsRestrictedOnlyTheProjectStewardOrARepository: {
        readonly status: 422;
        readonly error: "security_contacts_restricted";
        readonly message: "Only the project steward or a repository admin can name other bounty contacts or a sponsor";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityVaultRestricted: {
        readonly status: 422;
        readonly error: "security_vault_restricted";
        readonly message: "Keep the verified bounty vault; a new vault needs verified registration";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityAssetRestricted: {
        readonly status: 422;
        readonly error: "security_asset_restricted";
        readonly message: "A funded bounty program keeps its network and asset";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityFundingUnavailable: {
        readonly status: 422;
        readonly error: "security_funding_unavailable";
        readonly message: "Opening requires available funds in a verified bounty vault with a current finalized balance";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepositoryStart: {
        readonly status: 422;
        readonly error: "invalid_repository_start";
        readonly messageFrom: "`${entry.id} must count from ${countsFrom}, the start of the next UTC month.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepository: {
        readonly status: 422;
        readonly error: "invalid_repository";
        readonly messageFrom: "`The display name of ${entry.id} must be ${entry.id}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepositoryNoStore: {
        readonly status: 422;
        readonly error: "invalid_repository";
        readonly messageFrom: "`${entry.id} needs its permanent GitHub ids.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepositoryS422: {
        readonly status: 422;
        readonly error: "invalid_repository";
        readonly messageFrom: "`GitHub has no public repository named ${entry.id}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableInternalError: {
        readonly status: 503;
        readonly error: "github_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepositoryV2: {
        readonly status: 422;
        readonly error: "invalid_repository";
        readonly messageFrom: "refusal";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRepositoryV3: {
        readonly status: 422;
        readonly error: "invalid_repository";
        readonly messageFrom: "`GitHub reports different facts for ${entry.id}. Look it up again.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedOnlyAMonthlyReward: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "Only a monthly reward changes through owner self-service";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedASeparateReviewBudget: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "A separate review budget is not offered; review credit comes from the shared scoring policy";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedFundingRoutesDoNot: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "Funding routes do not change through owner self-service";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedUseVaultSetupTo: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "Use vault setup to register a verified owner vault; a manifest edit cannot change vault records";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedAFundedProjectKeeps: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "A funded project keeps its network, asset and vault";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly financialChangeRestrictedOnlyTheMonthlyAmount: {
        readonly status: 422;
        readonly error: "financial_change_restricted";
        readonly message: "Only the monthly amount, network and asset change through owner self-service";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestV2: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly messageFrom: "message";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securitySplitRestricted: {
        readonly status: 422;
        readonly error: "security_split_restricted";
        readonly message: "A new bounty uses the 75/25 researcher/Slop split; an admin must approve any full-award exception";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly securityContactsRestricted: {
        readonly status: 422;
        readonly error: "security_contacts_restricted";
        readonly message: "A new bounty names its signed-in creator as its private-case contact and sponsor; verified owners can manage contacts after setup";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundApplicationNotFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Application not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly alreadyDecided: {
        readonly status: 409;
        readonly error: "already_decided";
        readonly messageFrom: "`Application was already ${application.status}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly registryConflictTheProjectIdRepositoryOrRestrictionsChanged: {
        readonly status: 409;
        readonly error: "registry_conflict";
        readonly message: "The project id, repository or restrictions changed, or the application was published. Reload before retrying.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const postProjectApplicationsByIdCancel: {
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
    readonly notFound: {
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
    readonly notFoundApplicationNotFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Application not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly applicationDecided: {
        readonly status: 409;
        readonly error: "application_decided";
        readonly messageFrom: "`Application was already ${application.status}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly applicationDecidedTheApplicationChangedReload: {
        readonly status: 409;
        readonly error: "application_decided";
        readonly message: "The application changed. Reload before retrying.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const getAdminProjects: {
    readonly notFound: {
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
    readonly forbidden: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Admin access is required";
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
    };
};
export declare const putAdminProjectsByIdManifest: {
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
    readonly notFound: {
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
    readonly staleRevision: {
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
    readonly invalidManifest: {
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
    readonly invalidManifestABountyAmountNeeds: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "A bounty amount needs security bounty terms";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly rewardAssetUnverified: {
        readonly status: 422;
        readonly error: "reward_asset_unverified";
        readonly messageFrom: "`The reward token could not be verified on ${network.name}: ${error.message}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly rewardAssetUnverifiedNoStore: {
        readonly status: 503;
        readonly error: "reward_asset_unverified";
        readonly messageFrom: "`${network.name} could not be reached to verify the reward token. Try again.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestSendTheBountyAmount: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "Send the bounty amount in whole asset units when creating or changing its award";
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
        readonly messageFrom: "`The bounty amount is invalid: ${error instanceof Error ? error.message : \"check the amount\"}`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundProjectNotFound: {
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
    readonly invalidRequestInvalidReason: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid reason";
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
    readonly invalidManifestProjectIdCannotChange: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "Project id cannot change";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly noChange: {
        readonly status: 422;
        readonly error: "no_change";
        readonly message: "The revision changes nothing";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestReasonMustBe1To1000Characters: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "reason must be 1 to 1000 characters";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly forbidden: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Admin access is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestAReviewBudgetCannot: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "A review budget cannot be added or funded while the contributor pool cap shrinks";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidManifestAReviewBudgetCannotAffectAnOpen: {
        readonly status: 422;
        readonly error: "invalid_manifest";
        readonly message: "A review budget cannot affect an open or past cycle";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const postAdminProjectsByIdEnforcementPreview: {
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
    readonly notFound: {
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
    readonly githubRateLimited: {
        readonly status: 503;
        readonly error: "github_rate_limited";
        readonly message: "GitHub limited lookups.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailable: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly messageFrom: "`GitHub returned ${response.status}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnUnexpected: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an unexpected response.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundProjectNotFound: {
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
    readonly invalidRequestInvalidReason: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid reason";
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
    readonly invalidRequestReasonMustBe1To1000Characters: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "reason must be 1 to 1000 characters";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly staleEnforcement: {
        readonly status: 409;
        readonly error: "stale_enforcement";
        readonly message: "The project changed since you loaded it";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vettingRequiredReinstatementRequiresAFresh: {
        readonly status: 409;
        readonly error: "vetting_required";
        readonly message: "Reinstatement requires a fresh clean scan of the current restricted revision, requested after the latest restriction, at the current integration-branch head and skill template.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestSelectTheAccountsTo: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Select the accounts to reinstate.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly accountNotBanned: {
        readonly status: 409;
        readonly error: "account_not_banned";
        readonly message: "The selected account has no active ban from this project.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestAccountBansRequireA: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Account bans require a moderator decision on a confirmed malicious result.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestInvalidEvidenceReference: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid evidenceReference";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestEvidenceReferenceMustBe1: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "evidenceReference must be 1 to 500 characters";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly forbidden: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Admin access is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly personalAccountRequired: {
        readonly status: 422;
        readonly error: "personal_account_required";
        readonly messageFrom: "`@${login} is a GitHub ${user.type} account. Enter a person's GitHub account.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedIncompleteAccount: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned incomplete account facts.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly moderationUnavailable: {
        readonly status: 403;
        readonly error: "moderation_unavailable";
        readonly message: "Moderation is not configured. Contact the service operator.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly forbiddenTheProjectModeratorRole: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "The project moderator role is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestInvalidEnforcementAction: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid enforcement action";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestSelectTheResponsibleAccounts: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Select the responsible accounts.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestEnterAGitHubAccount: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Enter a GitHub account name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly accountChanged: {
        readonly status: 409;
        readonly error: "account_changed";
        readonly message: "The selected GitHub account changed. Preview the decision again.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestInvalidExpectedSequence: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid expectedSequence";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const postAdminProjectsByIdEnforcement: {
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
    readonly notFound: {
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
    readonly githubRateLimited: {
        readonly status: 503;
        readonly error: "github_rate_limited";
        readonly message: "GitHub limited lookups.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailable: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly messageFrom: "`GitHub returned ${response.status}.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedAnUnexpected: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned an unexpected response.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly notFoundProjectNotFound: {
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
    readonly invalidRequestInvalidReason: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid reason";
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
    readonly invalidRequestReasonMustBe1To1000Characters: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "reason must be 1 to 1000 characters";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly staleEnforcement: {
        readonly status: 409;
        readonly error: "stale_enforcement";
        readonly message: "The project changed since you loaded it";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vettingRequiredReinstatementRequiresAFresh: {
        readonly status: 409;
        readonly error: "vetting_required";
        readonly message: "Reinstatement requires a fresh clean scan of the current restricted revision, requested after the latest restriction, at the current integration-branch head and skill template.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestSelectTheAccountsTo: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Select the accounts to reinstate.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly accountNotBanned: {
        readonly status: 409;
        readonly error: "account_not_banned";
        readonly message: "The selected account has no active ban from this project.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestAccountBansRequireA: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Account bans require a moderator decision on a confirmed malicious result.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestInvalidEvidenceReference: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid evidenceReference";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestEvidenceReferenceMustBe1: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "evidenceReference must be 1 to 500 characters";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly forbidden: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Admin access is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly personalAccountRequired: {
        readonly status: 422;
        readonly error: "personal_account_required";
        readonly messageFrom: "`@${login} is a GitHub ${user.type} account. Enter a person's GitHub account.`";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly githubUnavailableGitHubReturnedIncompleteAccount: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "GitHub returned incomplete account facts.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly moderationUnavailable: {
        readonly status: 403;
        readonly error: "moderation_unavailable";
        readonly message: "Moderation is not configured. Contact the service operator.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly forbiddenTheProjectModeratorRole: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "The project moderator role is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestInvalidEnforcementAction: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid enforcement action";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestSelectTheResponsibleAccounts: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Select the responsible accounts.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestEnterAGitHubAccount: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Enter a GitHub account name.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly accountChanged: {
        readonly status: 409;
        readonly error: "account_changed";
        readonly message: "The selected GitHub account changed. Preview the decision again.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestInvalidExpectedSequence: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid expectedSequence";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const postProjectAppeals: {
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
    readonly notFound: {
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
    readonly notFoundProjectNotFound: {
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
    readonly invalidRequestInvalidReason: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid reason";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestReasonMustBe1To1000Characters: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "reason must be 1 to 1000 characters";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly staleEnforcement: {
        readonly status: 409;
        readonly error: "stale_enforcement";
        readonly message: "The project changed since you loaded it";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly vettingRequiredReinstatementRequiresAFresh: {
        readonly status: 409;
        readonly error: "vetting_required";
        readonly message: "Reinstatement requires a fresh clean scan of the current restricted revision, requested after the latest restriction, at the current integration-branch head and skill template.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestSelectTheAccountsTo: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Select the accounts to reinstate.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly accountNotBanned: {
        readonly status: 409;
        readonly error: "account_not_banned";
        readonly message: "The selected account has no active ban from this project.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestAccountBansRequireA: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Account bans require a moderator decision on a confirmed malicious result.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestInvalidEvidenceReference: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid evidenceReference";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestEvidenceReferenceMustBe1: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "evidenceReference must be 1 to 500 characters";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly invalidRequestUnsupportedAppealScope: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Unsupported appeal scope";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly forbiddenOnlyACurrentlyBanned: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Only a currently banned account can file an account appeal";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
    readonly forbiddenOnlyTheProjectSteward: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Only the project steward, the account that listed the project, or an account banned by this project decision can appeal";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-project-api-contract": "project-registry-v1";
        };
    };
};
export declare const getProjectAppeals: {
    readonly notFound: {
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
    };
};
export declare const postReferralsCode: {
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
    readonly internalErrorInternalError: {
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
    readonly invalidRequestPrivateNoStore: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be a JSON object";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyHasUnexpectedFields: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body has unexpected fields";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidCode: {
        readonly status: 422;
        readonly error: "invalid_code";
        readonly message: "Use 3 to 32 letters, digits, hyphens or underscores, starting and ending with a letter or digit.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly teamAccount: {
        readonly status: 422;
        readonly error: "team_account";
        readonly message: "Slop team accounts cannot be recorded as referrers.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly reservedCode: {
        readonly status: 422;
        readonly error: "reserved_code";
        readonly message: "That name is reserved. Choose another.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly codeTaken: {
        readonly status: 409;
        readonly error: "code_taken";
        readonly message: "That name is taken. Choose another.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly githubRateLimitedInternalError: {
        readonly status: 503;
        readonly error: "github_rate_limited";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly githubUnavailablePrivateNoStore: {
        readonly status: 502;
        readonly error: "github_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly codeIsGithubAccount: {
        readonly status: 409;
        readonly error: "code_is_github_account";
        readonly message: "That name is another GitHub account. Choose another.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly codeLimit: {
        readonly status: 409;
        readonly error: "code_limit";
        readonly message: "You have used all 5 of your names. Choose one you used before.";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getReferralsProjects: {
    readonly internalErrorInternalError: {
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
        readonly methodNotAllowed: {
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
export declare const getNotificationsEmail: {
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
    readonly invalidExpectedActorPrivateNoStore: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedPrivateNoStore: {
        readonly status: 403;
        readonly error: "actor_changed";
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
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly methodNotAllowedPrivateNoStore: {
            readonly status: 405;
            readonly error: "method_not_allowed";
            readonly headers: {
                readonly "cache-control": "private, no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const postNotificationsEmail: {
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
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorPrivateNoStore: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedPrivateNoStore: {
        readonly status: 403;
        readonly error: "actor_changed";
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
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly emailUnavailable: {
        readonly status: 503;
        readonly error: "email_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly verificationChanged: {
        readonly status: 409;
        readonly error: "verification_changed";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly preferenceChanged: {
        readonly status: 409;
        readonly error: "preference_changed";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly methodNotAllowedPrivateNoStore: {
            readonly status: 405;
            readonly error: "method_not_allowed";
            readonly headers: {
                readonly "cache-control": "private, no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const postNotificationsEmailVerification: {
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
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorPrivateNoStore: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedPrivateNoStore: {
        readonly status: 403;
        readonly error: "actor_changed";
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
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly emailUnavailable: {
        readonly status: 503;
        readonly error: "email_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly idempotencyConflict: {
        readonly status: 409;
        readonly error: "idempotency_conflict";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly verificationRateLimited: {
        readonly status: 429;
        readonly error: "verification_rate_limited";
        readonly fields: readonly ["retryAfter"];
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly methodNotAllowedPrivateNoStore: {
            readonly status: 405;
            readonly error: "method_not_allowed";
            readonly headers: {
                readonly "cache-control": "private, no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const postNotificationsEmailVerify: {
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
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidExpectedActorPrivateNoStore: {
        readonly status: 400;
        readonly error: "invalid_expected_actor";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly actorChangedPrivateNoStore: {
        readonly status: 403;
        readonly error: "actor_changed";
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
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly emailUnavailable: {
        readonly status: 503;
        readonly error: "email_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly verificationInvalid: {
        readonly status: 409;
        readonly error: "verification_invalid";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly methodNotAllowedPrivateNoStore: {
            readonly status: 405;
            readonly error: "method_not_allowed";
            readonly headers: {
                readonly "cache-control": "private, no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const postPaymentsWalletsRegister: {
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
    readonly internalErrorInternalError: {
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
    readonly invalidWallet: {
        readonly status: 400;
        readonly error: "invalid_wallet";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly staleWalletClaim: {
        readonly status: 409;
        readonly error: "stale_wallet_claim";
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
export declare const postPaymentsWalletsChallenge: {
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
    readonly internalErrorInternalError: {
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
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly claimNotCurrent: {
        readonly status: 409;
        readonly error: "claim_not_current";
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
export declare const postPaymentsWalletsAuthorize: {
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
    readonly internalErrorInternalError: {
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
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly claimNotCurrent: {
        readonly status: 409;
        readonly error: "claim_not_current";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly walletSignatureRequired: {
        readonly status: 403;
        readonly error: "wallet_signature_required";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly challengeConsumed: {
        readonly status: 409;
        readonly error: "challenge_consumed";
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
export declare const postPaymentsWalletsBindChallenge: {
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
    readonly internalErrorInternalError: {
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
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly claimNotCurrent: {
        readonly status: 409;
        readonly error: "claim_not_current";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentDeploymentsUnavailable: {
        readonly status: 503;
        readonly error: "payment_deployments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unknownDeployment: {
        readonly status: 400;
        readonly error: "unknown_deployment";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly bindingVersionUnavailable: {
        readonly status: 503;
        readonly error: "binding_version_unavailable";
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
export declare const postPaymentsWalletsBindAuthorize: {
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
    readonly internalErrorInternalError: {
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
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly claimNotCurrent: {
        readonly status: 409;
        readonly error: "claim_not_current";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly paymentDeploymentsUnavailable: {
        readonly status: 503;
        readonly error: "payment_deployments_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unknownDeployment: {
        readonly status: 400;
        readonly error: "unknown_deployment";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly bindingVersionUnavailable: {
        readonly status: 503;
        readonly error: "binding_version_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly walletSignatureRequired: {
        readonly status: 403;
        readonly error: "wallet_signature_required";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly authorizationExpiresTooSoon: {
        readonly status: 400;
        readonly error: "authorization_expires_too_soon";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly authorizationExpiresTooLate: {
        readonly status: 400;
        readonly error: "authorization_expires_too_late";
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
export declare const postPaymentsWalletsSolanaBindPrepare: {
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
    readonly internalErrorInternalError: {
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
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly identityAttesterUnavailable: {
        readonly status: 503;
        readonly error: "identity_attester_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly bindingNotReady: {
        readonly status: 409;
        readonly error: "binding_not_ready";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly bindingPendingOrRejected: {
        readonly status: 409;
        readonly error: "binding_pending_or_rejected";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly bindingDeploymentUnavailable: {
        readonly status: 503;
        readonly error: "binding_deployment_unavailable";
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
export declare const postPaymentsWalletsSolanaBindComplete: {
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
    readonly internalErrorInternalError: {
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
    readonly invalidRequestS400: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly identityAttesterUnavailable: {
        readonly status: 503;
        readonly error: "identity_attester_unavailable";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly bindingNotReady: {
        readonly status: 409;
        readonly error: "binding_not_ready";
        readonly headers: {
            readonly "cache-control": "private, no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly bindingPendingOrRejected: {
        readonly status: 409;
        readonly error: "binding_pending_or_rejected";
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
export declare const getPointsXProfile: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidActor: {
        readonly status: 400;
        readonly error: "invalid_actor";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly originForbiddenNoStore: {
            readonly status: 403;
            readonly error: "origin_forbidden";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly rateLimited: {
            readonly status: 429;
            readonly error: "rate_limited";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
            readonly headersFrom: {
                readonly "retry-after": "String(admission.retryAfterSeconds)";
            };
        };
    };
};
export declare const getPointsXCallback: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly originForbiddenNoStore: {
            readonly status: 403;
            readonly error: "origin_forbidden";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly rateLimited: {
            readonly status: 429;
            readonly error: "rate_limited";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
            readonly headersFrom: {
                readonly "retry-after": "String(admission.retryAfterSeconds)";
            };
        };
    };
};
export declare const getPointsXMe: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedInNoStore: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly originForbiddenNoStore: {
            readonly status: 403;
            readonly error: "origin_forbidden";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly rateLimited: {
            readonly status: 429;
            readonly error: "rate_limited";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
            readonly headersFrom: {
                readonly "retry-after": "String(admission.retryAfterSeconds)";
            };
        };
    };
};
export declare const postPointsXStart: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly rateLimited: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(admission.retryAfterSeconds)";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedInNoStore: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestNoStore: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly xNotConfigured: {
        readonly status: 503;
        readonly error: "x_not_configured";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const postPointsXDisconnect: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly rateLimited: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(admission.retryAfterSeconds)";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedInNoStore: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const postPointsXVisibility: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly rateLimited: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(admission.retryAfterSeconds)";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedInNoStore: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestNoStore: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly publicVisibilityRequired: {
        readonly status: 409;
        readonly error: "public_visibility_required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notConnected: {
        readonly status: 404;
        readonly error: "not_connected";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};
export declare const getPointsPeople: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidCursor: {
        readonly status: 400;
        readonly error: "invalid_cursor";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly originForbiddenNoStore: {
            readonly status: 403;
            readonly error: "origin_forbidden";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly rateLimited: {
            readonly status: 429;
            readonly error: "rate_limited";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
            readonly headersFrom: {
                readonly "retry-after": "String(admission.retryAfterSeconds)";
            };
        };
    };
};
export declare const postPointsJoin: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly rateLimited: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(admission.retryAfterSeconds)";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestV2: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly identityExpired: {
        readonly status: 401;
        readonly error: "identity_expired";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidIdentity: {
        readonly status: 401;
        readonly error: "invalid_identity";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly accountClosed: {
        readonly status: 409;
        readonly error: "account_closed";
        readonly fields: readonly ["closedAt"];
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly accountClosedNoStore: {
        readonly status: 409;
        readonly error: "account_closed";
        readonly fields: readonly ["closedAt"];
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const getPointsMe: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly originForbiddenNoStore: {
            readonly status: 403;
            readonly error: "origin_forbidden";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly notSignedInS401: {
            readonly status: 401;
            readonly error: "not_signed_in";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly sessionExpiredNoStore: {
            readonly status: 401;
            readonly error: "session_expired";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
            readonly headersFrom: {
                readonly "set-cookie": "sessionCookie(\"\", 0)";
            };
        };
        readonly rateLimited: {
            readonly status: 429;
            readonly error: "rate_limited";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
            readonly headersFrom: {
                readonly "retry-after": "String(admission.retryAfterSeconds)";
            };
        };
    };
};
export declare const getPointsSessions: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedInS401: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpiredNoStore: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "set-cookie": "sessionCookie(\"\", 0)";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly originForbiddenNoStore: {
            readonly status: 403;
            readonly error: "origin_forbidden";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly rateLimited: {
            readonly status: 429;
            readonly error: "rate_limited";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
            readonly headersFrom: {
                readonly "retry-after": "String(admission.retryAfterSeconds)";
            };
        };
    };
};
export declare const postPointsSessionsRevoke: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedInS401: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpiredNoStore: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "set-cookie": "sessionCookie(\"\", 0)";
        };
    };
    readonly rateLimited: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(admission.retryAfterSeconds)";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestV2: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidSession: {
        readonly status: 400;
        readonly error: "invalid_session";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const postPointsAccountClose: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedInS401: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpiredNoStore: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "set-cookie": "sessionCookie(\"\", 0)";
        };
    };
    readonly rateLimited: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(admission.retryAfterSeconds)";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestV2: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly confirmationMismatch: {
        readonly status: 400;
        readonly error: "confirmation_mismatch";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const postPointsSignout: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedInS401: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpiredNoStore: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "set-cookie": "sessionCookie(\"\", 0)";
        };
    };
    readonly rateLimited: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(admission.retryAfterSeconds)";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const postPointsVisibility: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly notSignedInS401: {
        readonly status: 401;
        readonly error: "not_signed_in";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly sessionExpiredNoStore: {
        readonly status: 401;
        readonly error: "session_expired";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "set-cookie": "sessionCookie(\"\", 0)";
        };
    };
    readonly rateLimited: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(admission.retryAfterSeconds)";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestV2: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly publicVisibilityRequiredNoStore: {
        readonly status: 409;
        readonly error: "public_visibility_required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const getPointsMember: {
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly pointsUnavailable: {
        readonly status: 503;
        readonly error: "points_unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidLogin: {
        readonly status: 400;
        readonly error: "invalid_login";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly originForbiddenNoStore: {
            readonly status: 403;
            readonly error: "origin_forbidden";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly rateLimited: {
            readonly status: 429;
            readonly error: "rate_limited";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
            readonly headersFrom: {
                readonly "retry-after": "String(admission.retryAfterSeconds)";
            };
        };
    };
};
export declare const getWalletClaimsActorsByGithubIdCurrent: {
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
    readonly originNotAllowed: {
        readonly status: 403;
        readonly error: "origin_not_allowed";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidWalletChain: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid wallet chain";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidGitHubActorId: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid GitHub actor id";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly otherMethods: {
        readonly originNotAllowed: {
            readonly status: 403;
            readonly error: "origin_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
        readonly headersNotAllowed: {
            readonly status: 403;
            readonly error: "headers_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
    };
};
export declare const getWalletClaimsByIdPossession: {
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
    readonly originNotAllowed: {
        readonly status: 403;
        readonly error: "origin_not_allowed";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly notFoundWalletClaimNotFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Wallet claim not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidClaimId: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid claim id";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly unsupportedChain: {
        readonly status: 409;
        readonly error: "unsupported_chain";
        readonly message: "Wallet possession proofs currently support Solana only";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly otherMethods: {
        readonly originNotAllowed: {
            readonly status: 403;
            readonly error: "origin_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
        readonly headersNotAllowed: {
            readonly status: 403;
            readonly error: "headers_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
    };
};
export declare const getWalletClaimsById: {
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
    readonly originNotAllowed: {
        readonly status: 403;
        readonly error: "origin_not_allowed";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly notFoundWalletClaimNotFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Wallet claim not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidClaimId: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid claim id";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly otherMethods: {
        readonly originNotAllowed: {
            readonly status: 403;
            readonly error: "origin_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
        readonly headersNotAllowed: {
            readonly status: 403;
            readonly error: "headers_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
    };
};
export declare const getWalletClaimsCurrent: {
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
    readonly forbiddenSameOriginOperatorSession: {
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
    readonly originNotAllowedSameOriginAccessIs: {
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
    readonly originNotAllowed: {
        readonly status: 403;
        readonly error: "origin_not_allowed";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly notFoundWalletClaimNotFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Wallet claim not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidWalletChain: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid wallet chain";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly otherMethods: {
        readonly originNotAllowed: {
            readonly status: 403;
            readonly error: "origin_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
        readonly headersNotAllowed: {
            readonly status: 403;
            readonly error: "headers_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
    };
};
export declare const postWalletClaims: {
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
    readonly forbiddenSameOriginOperatorSession: {
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
    readonly originNotAllowedSameOriginAccessIs: {
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
    readonly invalidRequestRequestBodyMustBeNoStore: {
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
    readonly originNotAllowed: {
        readonly status: 403;
        readonly error: "origin_not_allowed";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly forbiddenWriteAccessIsNot: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Write access is not permitted";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidWalletChain: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid wallet chain";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidSupersedesClaimId: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid supersedesClaimId";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestV3: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly messageFrom: "chainFamily(chain) === \"evm\" ? \"Invalid EVM address\" : \"Invalid Solana address\"";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly staleWalletClaimWalletClaimChangedReload: {
        readonly status: 409;
        readonly error: "stale_wallet_claim";
        readonly message: "Wallet claim changed; reload the current claim before submitting";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly otherMethods: {
        readonly originNotAllowed: {
            readonly status: 403;
            readonly error: "origin_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
        readonly headersNotAllowed: {
            readonly status: 403;
            readonly error: "headers_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
    };
};
export declare const postWalletClaimsByIdPossessionChallenge: {
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
    readonly forbiddenSameOriginOperatorSession: {
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
    readonly originNotAllowedSameOriginAccessIs: {
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
    readonly originNotAllowed: {
        readonly status: 403;
        readonly error: "origin_not_allowed";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly forbiddenWriteAccessIsNot: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Write access is not permitted";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly notFoundWalletClaimNotFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Wallet claim not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidClaimId: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid claim id";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly unsupportedChain: {
        readonly status: 409;
        readonly error: "unsupported_chain";
        readonly message: "Wallet possession proofs currently support Solana only";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly addressNotSignable: {
        readonly status: 409;
        readonly error: "address_not_signable";
        readonly message: "This destination is off the Ed25519 curve and cannot produce a signature";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly otherMethods: {
        readonly originNotAllowed: {
            readonly status: 403;
            readonly error: "origin_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
        readonly headersNotAllowed: {
            readonly status: 403;
            readonly error: "headers_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
    };
};
export declare const postWalletClaimsByIdPossession: {
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
    readonly forbiddenSameOriginOperatorSession: {
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
    readonly originNotAllowedSameOriginAccessIs: {
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
    readonly invalidRequestRequestBodyMustBeNoStore: {
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
    readonly originNotAllowed: {
        readonly status: 403;
        readonly error: "origin_not_allowed";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly forbiddenWriteAccessIsNot: {
        readonly status: 403;
        readonly error: "forbidden";
        readonly message: "Write access is not permitted";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly notFoundWalletClaimNotFound: {
        readonly status: 404;
        readonly error: "not_found";
        readonly message: "Wallet claim not found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidClaimId: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid claim id";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly unsupportedChain: {
        readonly status: 409;
        readonly error: "unsupported_chain";
        readonly message: "Wallet possession proofs currently support Solana only";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidPossessionChallenge: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid possession challenge";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly possessionChallengeUnavailable: {
        readonly status: 409;
        readonly error: "possession_challenge_unavailable";
        readonly message: "Possession challenge is unknown, expired, already used, or bound elsewhere";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidPossessionProof: {
        readonly status: 400;
        readonly error: "invalid_possession_proof";
        readonly messageFrom: "error instanceof Error ? error.message : \"Invalid possession proof\"";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidPossessionProofWalletPossessionChallengeWindow: {
        readonly status: 400;
        readonly error: "invalid_possession_proof";
        readonly message: "Wallet possession challenge window differs from the issued challenge";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly possessionChallengeUnavailablePossessionAttestationChangedReload: {
        readonly status: 409;
        readonly error: "possession_challenge_unavailable";
        readonly message: "Possession attestation changed; reload the claim before submitting";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly otherMethods: {
        readonly originNotAllowed: {
            readonly status: 403;
            readonly error: "origin_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
        readonly headersNotAllowed: {
            readonly status: 403;
            readonly error: "headers_not_allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
                readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
            };
        };
    };
};
export declare const postOperatorWalletClaims: {
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
    readonly forbiddenSameOriginOperatorSession: {
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
    readonly originNotAllowedSameOriginAccessIs: {
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
    readonly invalidRequestRequestBodyMustBeNoStore: {
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
    readonly invalidRequestInvalidSupersedesClaimId: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid supersedesClaimId";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidGithubActorId: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid githubActorId";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidGithubLogin: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid githubLogin";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidSolanaAddress: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid Solana address";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidObservedAt: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid observedAt";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestWalletObservationCannotBe: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Wallet observation cannot be in the future";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidSourceBodySha256: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid sourceBodySha256";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidWalletClaimSource: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid wallet claim source";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly invalidRequestInvalidGitHubIssueSource: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid GitHub issue source";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
    readonly claimConflict: {
        readonly status: 409;
        readonly error: "claim_conflict";
        readonly message: "Wallet claim conflicts";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
            readonly "x-slop-trace-api-contract": "private-trace-v1-opaque-hmac-v1";
        };
    };
};
export declare const getReferralByCode: {
    readonly thisReferralLinkIs: {
        readonly status: 503;
        readonly text: "This referral link is unavailable. Retry.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "text/plain; charset=utf-8";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly methodNotAllowedNoStore: {
            readonly status: 405;
            readonly text: "Method not allowed";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "text/plain; charset=utf-8";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const identityPostV1LocalStart: {
    readonly notFoundNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly httpsRequiredNoStore: {
        readonly status: 400;
        readonly error: "https_required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorInternalErrorNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyIsRequired: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidContentLengthContentLengthMustContainOnlyDecimalDigits: {
        readonly status: 400;
        readonly error: "invalid_content_length";
        readonly message: "Content-Length must contain only decimal digits";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly payloadTooLargeRequestBodyExceeds4096: {
        readonly status: 413;
        readonly error: "payload_too_large";
        readonly message: "Request body exceeds 4096 bytes";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly requestTooLarge: {
        readonly status: 413;
        readonly error: "request_too_large";
        readonly message: "Request body is too large";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyMustBeUTF8JSON: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be UTF-8 JSON";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestV4: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be a JSON object";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly rateLimitedTooManyRequestsTry: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly message: "Too many requests. Try again later.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(retryAfterSeconds)";
        };
    };
    readonly serviceUnavailable: {
        readonly status: 503;
        readonly error: "service_unavailable";
        readonly message: "Identity service is temporarily unavailable.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "retry-after": "60";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestInvalidLocalReturnOrigin: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid local return origin";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestInvalidIdentityAudience: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid identity audience";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly flowUnavailable: {
        readonly status: 503;
        readonly error: "flow_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const identityPostV1LocalPoll: {
    readonly notFoundNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly httpsRequiredNoStore: {
        readonly status: 400;
        readonly error: "https_required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorInternalErrorNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyIsRequired: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidContentLengthContentLengthMustContainOnlyDecimalDigits: {
        readonly status: 400;
        readonly error: "invalid_content_length";
        readonly message: "Content-Length must contain only decimal digits";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly payloadTooLargeRequestBodyExceeds4096: {
        readonly status: 413;
        readonly error: "payload_too_large";
        readonly message: "Request body exceeds 4096 bytes";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly requestTooLarge: {
        readonly status: 413;
        readonly error: "request_too_large";
        readonly message: "Request body is too large";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyMustBeUTF8JSON: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be UTF-8 JSON";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestV4: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be a JSON object";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly rateLimitedTooManyRequestsTry: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly message: "Too many requests. Try again later.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(retryAfterSeconds)";
        };
    };
    readonly serviceUnavailable: {
        readonly status: 503;
        readonly error: "service_unavailable";
        readonly message: "Identity service is temporarily unavailable.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "retry-after": "60";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestInvalidPollRequest: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid poll request";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly flowUnavailableIdentityFlowIsUnavailable: {
        readonly status: 410;
        readonly error: "flow_unavailable";
        readonly message: "Identity flow is unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly wrongFlow: {
        readonly status: 403;
        readonly error: "wrong_flow";
        readonly message: "This authorization belongs to another sign-in mode";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly callbackFailed: {
        readonly status: 410;
        readonly error: "callback_failed";
        readonly message: "Identity sign-in failed; start again";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly flowConsumed: {
        readonly status: 410;
        readonly error: "flow_consumed";
        readonly message: "Identity flow was already consumed";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly identityIncomplete: {
        readonly status: 502;
        readonly error: "identity_incomplete";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly assertionUnavailable: {
        readonly status: 503;
        readonly error: "assertion_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const identityPostV1OauthStart: {
    readonly notFoundNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly httpsRequiredNoStore: {
        readonly status: 400;
        readonly error: "https_required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorInternalErrorNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyIsRequired: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidContentLengthContentLengthMustContainOnlyDecimalDigits: {
        readonly status: 400;
        readonly error: "invalid_content_length";
        readonly message: "Content-Length must contain only decimal digits";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly payloadTooLargeRequestBodyExceeds4096: {
        readonly status: 413;
        readonly error: "payload_too_large";
        readonly message: "Request body exceeds 4096 bytes";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly requestTooLarge: {
        readonly status: 413;
        readonly error: "request_too_large";
        readonly message: "Request body is too large";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyMustBeUTF8JSON: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be UTF-8 JSON";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestV4: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be a JSON object";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly rateLimitedTooManyRequestsTry: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly message: "Too many requests. Try again later.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(retryAfterSeconds)";
        };
    };
    readonly serviceUnavailable: {
        readonly status: 503;
        readonly error: "service_unavailable";
        readonly message: "Identity service is temporarily unavailable.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "retry-after": "60";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestInvalidLocalReturnOrigin: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid local return origin";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestInvalidIdentityAudience: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid identity audience";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly flowUnavailable: {
        readonly status: 503;
        readonly error: "flow_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly preflightForbidden: {
            readonly status: 403;
            readonly error: "preflight_forbidden";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const identityGetV1OauthAuthorize: {
    readonly notFoundNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly httpsRequiredNoStore: {
        readonly status: 400;
        readonly error: "https_required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorInternalErrorNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestInvalidAuthorizationLink: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid authorization link";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly flowExpired: {
        readonly status: 410;
        readonly error: "flow_expired";
        readonly message: "Authorization flow is unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const identityGetV1OauthCallback: {
    readonly notFoundNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly httpsRequiredNoStore: {
        readonly status: 400;
        readonly error: "https_required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorInternalErrorNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly signInFailed: {
        readonly status: 400;
        readonly html: {
            readonly title: "Sign-in failed";
            readonly message: "The sign-in response was invalid or expired.";
        };
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "text/html; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "content-security-policy": "`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`";
        };
    };
    readonly signInExpired: {
        readonly status: 410;
        readonly html: {
            readonly title: "Sign-in expired";
            readonly message: "Start sign-in again from Slop or your terminal.";
        };
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "text/html; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "content-security-policy": "`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`";
        };
    };
    readonly signInFailedGitHubIdentityCouldNot: {
        readonly status: 502;
        readonly html: {
            readonly title: "Sign-in failed";
            readonly message: "GitHub identity could not be verified.";
        };
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "text/html; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "content-security-policy": "`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`";
        };
    };
    readonly signInFailedGitHubAccountIdentityIs: {
        readonly status: 502;
        readonly html: {
            readonly title: "Sign-in failed";
            readonly message: "GitHub account identity is incomplete.";
        };
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "text/html; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "content-security-policy": "`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`";
        };
    };
    readonly signInExpiredTheSignInTook: {
        readonly status: 410;
        readonly html: {
            readonly title: "Sign-in expired";
            readonly message: "The sign-in took too long. Start again from your original tab or terminal.";
        };
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "text/html; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "content-security-policy": "`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const identityPostV1OauthPoll: {
    readonly notFoundNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly httpsRequiredNoStore: {
        readonly status: 400;
        readonly error: "https_required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorInternalErrorNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyIsRequired: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidContentLengthContentLengthMustContainOnlyDecimalDigits: {
        readonly status: 400;
        readonly error: "invalid_content_length";
        readonly message: "Content-Length must contain only decimal digits";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly payloadTooLargeRequestBodyExceeds4096: {
        readonly status: 413;
        readonly error: "payload_too_large";
        readonly message: "Request body exceeds 4096 bytes";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly requestTooLarge: {
        readonly status: 413;
        readonly error: "request_too_large";
        readonly message: "Request body is too large";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyMustBeUTF8JSON: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be UTF-8 JSON";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestV4: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be a JSON object";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly rateLimitedTooManyRequestsTry: {
        readonly status: 429;
        readonly error: "rate_limited";
        readonly message: "Too many requests. Try again later.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
        readonly headersFrom: {
            readonly "retry-after": "String(retryAfterSeconds)";
        };
    };
    readonly serviceUnavailable: {
        readonly status: 503;
        readonly error: "service_unavailable";
        readonly message: "Identity service is temporarily unavailable.";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "retry-after": "60";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestInvalidPollRequest: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid poll request";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly flowUnavailableIdentityFlowIsUnavailable: {
        readonly status: 410;
        readonly error: "flow_unavailable";
        readonly message: "Identity flow is unavailable";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly wrongFlow: {
        readonly status: 403;
        readonly error: "wrong_flow";
        readonly message: "This authorization belongs to another sign-in mode";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly callbackFailed: {
        readonly status: 410;
        readonly error: "callback_failed";
        readonly message: "Identity sign-in failed; start again";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly flowConsumed: {
        readonly status: 410;
        readonly error: "flow_consumed";
        readonly message: "Identity flow was already consumed";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly identityIncomplete: {
        readonly status: 502;
        readonly error: "identity_incomplete";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly assertionUnavailable: {
        readonly status: 503;
        readonly error: "assertion_unavailable";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly originForbiddenNoStore: {
        readonly status: 403;
        readonly error: "origin_forbidden";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly otherMethods: {
        readonly notFoundNoStore: {
            readonly status: 404;
            readonly error: "not_found";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
        readonly preflightForbidden: {
            readonly status: 403;
            readonly error: "preflight_forbidden";
            readonly headers: {
                readonly "cache-control": "no-store";
                readonly "content-type": "application/json; charset=utf-8";
                readonly "referrer-policy": "no-referrer";
                readonly "x-content-type-options": "nosniff";
            };
        };
    };
};
export declare const identityPostV1AssertionsConsume: {
    readonly notFoundNoStore: {
        readonly status: 404;
        readonly error: "not_found";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly httpsRequiredNoStore: {
        readonly status: 400;
        readonly error: "https_required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly internalErrorInternalErrorNoStore: {
        readonly status: 500;
        readonly error: "internal_error";
        readonly message: "Internal error";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyIsRequired: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body is required";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidContentLengthContentLengthMustContainOnlyDecimalDigits: {
        readonly status: 400;
        readonly error: "invalid_content_length";
        readonly message: "Content-Length must contain only decimal digits";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly payloadTooLargeRequestBodyExceeds4096: {
        readonly status: 413;
        readonly error: "payload_too_large";
        readonly message: "Request body exceeds 4096 bytes";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly requestTooLarge: {
        readonly status: 413;
        readonly error: "request_too_large";
        readonly message: "Request body is too large";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestRequestBodyMustBeUTF8JSON: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be UTF-8 JSON";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestV4: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Request body must be a JSON object";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unauthorizedIdentityAssertionIsInvalid: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Identity assertion is invalid";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly invalidRequestInvalidAssertionAudience: {
        readonly status: 400;
        readonly error: "invalid_request";
        readonly message: "Invalid assertion audience";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
    readonly unauthorizedIdentityAssertionIsInvalidUsedOrExpired: {
        readonly status: 401;
        readonly error: "unauthorized";
        readonly message: "Identity assertion is invalid, used, or expired";
        readonly headers: {
            readonly "cache-control": "no-store";
            readonly "content-type": "application/json; charset=utf-8";
            readonly "referrer-policy": "no-referrer";
            readonly "x-content-type-options": "nosniff";
        };
    };
};

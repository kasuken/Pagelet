import type { PublishPort } from '../core/ports.js';

export interface GitHubPublishOptions {
  /** e.g. https://api.github.com/repos/<owner>/<repo>/actions/workflows/publish-site.yml/dispatches */
  dispatchUrl: string;
  /** Fine-grained token with actions:write on this repository only. Server-side only. */
  token: string;
  ref?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Triggers the static publish workflow with workflow_dispatch. The workflow reads the publication by ID and
 * exits if it already succeeded, so repeated dispatches cannot publish twice. The token never reaches the browser.
 */
export function createGitHubPublish(options: GitHubPublishOptions): PublishPort {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async triggerBuild({ idempotencyKey, publicationId }, signal) {
      const response = await doFetch(options.dispatchUrl, {
        method: 'POST',
        signal,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${options.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: options.ref ?? 'main', inputs: { publication_id: publicationId, idempotency_key: idempotencyKey } }),
      });
      if (response.status !== 204) throw new Error(`Build dispatch returned HTTP ${response.status}`);
      return { runUrl: null };
    },
  };
}

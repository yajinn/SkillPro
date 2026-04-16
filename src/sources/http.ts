/**
 * Fetch wrapper with GitHub token support.
 *
 * Uses built-in fetch() (Node 20+). Injects GitHub token when present
 * in the GITHUB_TOKEN environment variable. Sets a 30-second timeout
 * via AbortController.
 */

export async function httpGet(url: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': 'SkillForge/2.0',
  };

  const token = process.env.GITHUB_TOKEN;
  if (token && url.includes('api.github.com')) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 403 && url.includes('api.github.com')) {
        throw new Error(
          `fetch failed for ${url}: GitHub API rate limit exceeded ` +
            `(HTTP ${response.status}). Set GITHUB_TOKEN env var to raise limit from 60/hr to 5000/hr`,
        );
      }
      throw new Error(
        `fetch failed for ${url}: HTTP ${response.status} ${response.statusText}`,
      );
    }

    return await response.text();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`fetch timed out after 30s for ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

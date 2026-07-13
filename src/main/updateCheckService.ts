import type { AppUpdateCheckResult } from '../shared/agentdockTypes.js';

const LATEST_RELEASE_PAGE_URL =
  'https://github.com/peyoba/AgentDock-Releases/releases/latest';
const TAGGED_RELEASE_PATH_PREFIX = '/peyoba/AgentDock-Releases/releases/tag/';

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(candidateVersion: string, currentVersion: string): boolean {
  const candidateParts = parseVersion(candidateVersion);
  const currentParts = parseVersion(currentVersion);
  if (!candidateParts || !currentParts) {
    return false;
  }

  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

export function isAllowedReleaseUrl(releaseUrl: string): boolean {
  try {
    const parsedUrl = new URL(releaseUrl);
    return (
      parsedUrl.origin === 'https://github.com' &&
      parsedUrl.pathname.startsWith('/peyoba/AgentDock-Releases/releases/')
    );
  } catch {
    return false;
  }
}

export async function checkForAppUpdate({
  currentVersion,
  fetchRelease = fetch,
}: {
  currentVersion: string;
  fetchRelease?: typeof fetch;
}): Promise<AppUpdateCheckResult> {
  try {
    const response = await fetchRelease(LATEST_RELEASE_PAGE_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }

    const releaseUrl = response.url;
    const parsedReleaseUrl = new URL(releaseUrl);
    if (
      !isAllowedReleaseUrl(releaseUrl) ||
      !parsedReleaseUrl.pathname.startsWith(TAGGED_RELEASE_PATH_PREFIX)
    ) {
      throw new Error('Invalid release URL');
    }
    const releaseTag = decodeURIComponent(
      parsedReleaseUrl.pathname.slice(TAGGED_RELEASE_PATH_PREFIX.length),
    );
    const latestVersion = releaseTag.replace(/^v/, '');
    if (!parseVersion(latestVersion)) {
      throw new Error('Invalid release version or URL');
    }

    return {
      status: isNewerVersion(latestVersion, currentVersion) ? 'available' : 'current',
      currentVersion,
      latestVersion,
      releaseUrl,
    };
  } catch {
    return {
      status: 'error',
      currentVersion,
      message: '暂时无法检查更新，请稍后重试',
    };
  }
}

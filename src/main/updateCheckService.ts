import type { AppUpdateCheckResult } from '../shared/agentdockTypes.js';

/**
 * 使用 Atom 源而不是 /releases/latest 或 REST API：
 * - /releases/latest 会跳过 pre-release（当前 v0.1.2 就是 pre-release）
 * - REST API 匿名 60 次/小时，容易 403
 * - releases.atom 公开、含 pre-release、无需鉴权
 */
const RELEASES_ATOM_URL = 'https://github.com/peyoba/AgentDock-Releases/releases.atom';
const TAGGED_RELEASE_PATH_PREFIX = '/peyoba/AgentDock-Releases/releases/tag/';

export type GithubReleaseSummary = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  html_url?: string;
  name?: string | null;
};

export type PickedRelease = {
  latestVersion: string;
  releaseUrl: string;
  releaseName?: string;
};

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

function compareVersionsDesc(left: string, right: string): number {
  if (isNewerVersion(left, right)) {
    return -1;
  }
  if (isNewerVersion(right, left)) {
    return 1;
  }
  return 0;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTagEntries(atomXml: string): GithubReleaseSummary[] {
  const entries: GithubReleaseSummary[] = [];
  const entryPattern = /<entry\b[\s\S]*?<\/entry>/gi;
  for (const entryMatch of atomXml.matchAll(entryPattern)) {
    const entryXml = entryMatch[0];
    const linkMatch =
      entryXml.match(/<link\b[^>]*\brel="alternate"[^>]*\bhref="([^"]+)"/i) ??
      entryXml.match(/<link\b[^>]*\bhref="([^"]+)"[^>]*\brel="alternate"/i) ??
      entryXml.match(/<link\b[^>]*\bhref="([^"]+)"/i);
    const titleMatch = entryXml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const idMatch = entryXml.match(/<id\b[^>]*>([\s\S]*?)<\/id>/i);
    const releaseUrl = linkMatch?.[1] ? decodeXmlEntities(linkMatch[1].trim()) : '';
    const releaseName = titleMatch?.[1]
      ? decodeXmlEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim())
      : undefined;
    let tagName = '';
    if (releaseUrl) {
      try {
        const pathname = new URL(releaseUrl).pathname;
        const prefix = '/peyoba/AgentDock-Releases/releases/tag/';
        if (pathname.startsWith(prefix)) {
          tagName = decodeURIComponent(pathname.slice(prefix.length));
        }
      } catch {
        tagName = '';
      }
    }
    if (!tagName && idMatch?.[1]) {
      const idText = decodeXmlEntities(idMatch[1].trim());
      const idTag = idText.match(/\/(v?\d+\.\d+\.\d+)\s*$/);
      if (idTag) {
        tagName = idTag[1];
      }
    }
    if (!tagName && releaseName) {
      const titleTag = releaseName.match(/\bv?\d+\.\d+\.\d+\b/);
      if (titleTag) {
        tagName = titleTag[0];
      }
    }
    entries.push({
      tag_name: tagName,
      draft: false,
      html_url: releaseUrl,
      name: releaseName,
    });
  }
  return entries;
}

export function pickLatestRelease(releases: GithubReleaseSummary[]): PickedRelease | undefined {
  const candidates = releases
    .filter((release) => release && release.draft !== true)
    .map((release) => {
      const tagName = typeof release.tag_name === 'string' ? release.tag_name : '';
      const version = tagName.replace(/^v/, '');
      const releaseUrl = typeof release.html_url === 'string' ? release.html_url : '';
      const releaseName =
        typeof release.name === 'string' && release.name.trim() ? release.name.trim() : undefined;
      return {
        version,
        releaseUrl,
        releaseName,
      };
    })
    .filter((release) => parseVersion(release.version) && isAllowedReleaseUrl(release.releaseUrl))
    .sort((left, right) => compareVersionsDesc(left.version, right.version));

  const best = candidates[0];
  if (!best) {
    return undefined;
  }

  return {
    latestVersion: best.version,
    releaseUrl: best.releaseUrl,
    releaseName: best.releaseName,
  };
}

export async function checkForAppUpdate({
  currentVersion,
  fetchRelease = fetch,
}: {
  currentVersion: string;
  fetchRelease?: typeof fetch;
}): Promise<AppUpdateCheckResult> {
  try {
    const response = await fetchRelease(RELEASES_ATOM_URL, {
      headers: {
        Accept: 'application/atom+xml, application/xml, text/xml, */*',
        'User-Agent': 'AgentDock-UpdateCheck',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }

    const atomXml = await response.text();
    if (typeof atomXml !== 'string' || !atomXml.includes('<entry')) {
      throw new Error('Invalid releases feed');
    }

    const latest = pickLatestRelease(extractTagEntries(atomXml));
    if (!latest) {
      throw new Error('No valid releases');
    }

    if (!isAllowedReleaseUrl(latest.releaseUrl)) {
      throw new Error('Invalid release URL');
    }
    const parsedReleaseUrl = new URL(latest.releaseUrl);
    if (!parsedReleaseUrl.pathname.startsWith(TAGGED_RELEASE_PATH_PREFIX)) {
      throw new Error('Invalid release path');
    }

    return {
      status: isNewerVersion(latest.latestVersion, currentVersion) ? 'available' : 'current',
      currentVersion,
      latestVersion: latest.latestVersion,
      releaseName: latest.releaseName,
      releaseUrl: latest.releaseUrl,
    };
  } catch {
    return {
      status: 'error',
      currentVersion,
      message: '暂时无法检查更新，请稍后重试',
    };
  }
}

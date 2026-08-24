export const PUBLIC_SOURCE_URL = 'https://github.com/designdelulu/AI-Development-Dashboard';
export const PERSONAL_SITE = 'https://ericbarker.co';
export const ARTICLE_URL = 'https://designdelulu.com/blog/ai-development-dashboard.html';
export const ORGANIZATION_URL = 'https://designdelulu.com';
export const ORGANIZATION_NAME = 'Design Delulu';
export const AUTHOR_NAME = 'Eric Barker';

export function releaseInfo(settings = {}, { repositoryPublic = true } = {}) {
  const publicNow = typeof settings.repositoryPublic === 'boolean'
    ? settings.repositoryPublic
    : repositoryPublic === true;
  return {
    author: AUTHOR_NAME,
    year: 2026,
    personalSite: PERSONAL_SITE,
    articleUrl: ARTICLE_URL,
    articleLabel: 'Read how this was built',
    organizationUrl: ORGANIZATION_URL,
    organizationName: ORGANIZATION_NAME,
    repositoryPublic: publicNow,
    sourceUrl: publicNow ? (settings.sourceUrl || PUBLIC_SOURCE_URL) : null,
    sourceLabel: 'Source code'
  };
}

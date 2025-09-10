import { NextResponse } from 'next/server';

import { getAvailableApiSites, getCacheTime } from '@/lib/config';
import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import { getStorage } from '@/lib/db';
import { searchFromApi } from '@/lib/downstream';

export const runtime = 'edge';

// 处理 OPTIONS 预检请求（OrionTV 客户端需要）
export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  // 从 Authorization header 或 query parameter 获取用户名
  let userName: string | undefined = searchParams.get('user') || undefined;
  if (!userName) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      userName = authHeader.substring(7);
    }
  }

  // 统一获取缓存时间，避免重复调用
  const cacheTime = await getCacheTime();

  // 如果没有 query，直接返回空结果
  if (!query) {
    const response = NextResponse.json(
      { regular_results: [], adult_results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
    return addCorsHeaders(response);
  }

  try {
    // 检查是否明确要求包含成人内容
    const includeAdult = searchParams.get('include_adult') === 'true';

    // 获取用户的成人内容过滤设置
    let shouldFilterAdult = true; // 默认过滤
    if (userName) {
      try {
        const storage = getStorage();
        const userSettings = await storage.getUserSettings(userName);
        shouldFilterAdult = userSettings?.filter_adult_content !== false;
      } catch {
        shouldFilterAdult = true;
      }
    }

    // 根据用户设置和请求参数，决定最终过滤策略
    const finalShouldFilter = shouldFilterAdult || !includeAdult;

    // 获取可用的资源站（已根据策略过滤）
    const availableSites = await getAvailableApiSites(finalShouldFilter);

    if (!availableSites || availableSites.length === 0) {
      const response = NextResponse.json(
        { regular_results: [], adult_results: [] },
        {
          headers: {
            'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
            'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          },
        }
      );
      return addCorsHeaders(response);
    }

    // 并发搜索（即使有源失败，也不会影响整体）
    const searchPromises = availableSites.map((site) => searchFromApi(site, query));
    const results = await Promise.allSettled(searchPromises);
    const searchResults = results
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => (r as PromiseFulfilledResult<any[]>).value);

    // 所有结果都作为常规结果返回
    const response = NextResponse.json(
      { regular_results: searchResults, adult_results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
    return addCorsHeaders(response);
  } catch (error) {
    const response = NextResponse.json(
      { regular_results: [], adult_results: [], error: '搜索失败' },
      { status: 500 }
    );
    return addCorsHeaders(response);
  }
}

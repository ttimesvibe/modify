const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

const TTL = 30 * 24 * 60 * 60; // 30일

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // POST /save — 세션 메타데이터 저장
      if (method === 'POST' && path === '/save') {
        const body = await request.json();
        if (!body.id) return err('id required');

        const key = `review:${body.id}`;
        body.updatedAt = new Date().toISOString();

        // stats 자동 계산
        if (body.cards) {
          body.stats = {
            total: body.cards.length,
            checked: body.cards.filter(c => c.checked).length,
          };
        }

        await env.SESSIONS.put(key, JSON.stringify(body), {
          expirationTtl: TTL,
          metadata: {
            title: body.title || '제목 없음',
            videoId: body.videoId || '',
            total: body.stats?.total || 0,
            checked: body.stats?.checked || 0,
            updatedAt: body.updatedAt,
          },
        });

        return json({ ok: true, id: body.id });
      }

      // POST /save-image — 개별 이미지 저장
      if (method === 'POST' && path === '/save-image') {
        const body = await request.json();
        if (!body.sessionId || !body.cardId || !body.imageData) {
          return err('sessionId, cardId, imageData required');
        }

        const key = `img:${body.sessionId}:${body.cardId}`;
        await env.SESSIONS.put(key, body.imageData, {
          expirationTtl: TTL,
        });

        return json({ ok: true, key });
      }

      // GET /load/:id — 세션 로드
      if (method === 'GET' && path.startsWith('/load/')) {
        const id = path.replace('/load/', '');
        if (!id) return err('id required');

        const data = await env.SESSIONS.get(`review:${id}`);
        if (!data) return err('not found', 404);

        return json(JSON.parse(data));
      }

      // GET /image/:sessionId/:cardId — 이미지 로드
      if (method === 'GET' && path.startsWith('/image/')) {
        const parts = path.replace('/image/', '').split('/');
        if (parts.length !== 2) return err('sessionId/cardId required');

        const [sessionId, cardId] = parts;
        const data = await env.SESSIONS.get(`img:${sessionId}:${cardId}`);
        if (!data) return err('image not found', 404);

        return json({ imageData: data });
      }

      // DELETE /image/:sessionId/:cardId — 이미지 삭제
      if (method === 'DELETE' && path.startsWith('/image/')) {
        const parts = path.replace('/image/', '').split('/');
        if (parts.length !== 2) return err('sessionId/cardId required');

        const [sessionId, cardId] = parts;
        await env.SESSIONS.delete(`img:${sessionId}:${cardId}`);

        return json({ ok: true });
      }

      // GET /sessions — 세션 목록
      if (method === 'GET' && path === '/sessions') {
        const list = await env.SESSIONS.list({ prefix: 'review:' });
        const sessions = list.keys.map(k => ({
          id: k.name.replace('review:', ''),
          ...k.metadata,
        }));

        // 최신순 정렬
        sessions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

        return json(sessions);
      }

      // DELETE /session/:id — 세션 삭제 (메타 + 이미지 전부)
      if (method === 'DELETE' && path.startsWith('/session/')) {
        const id = path.replace('/session/', '');
        if (!id) return err('id required');

        // 메타데이터 로드해서 카드 ID 확인
        const raw = await env.SESSIONS.get(`review:${id}`);
        if (raw) {
          const data = JSON.parse(raw);
          // 이미지 키 전부 삭제
          if (data.cards) {
            await Promise.all(
              data.cards
                .filter(c => c.hasImage)
                .map(c => env.SESSIONS.delete(`img:${id}:${c.id}`))
            );
          }
        }

        // 메타데이터 키 삭제
        await env.SESSIONS.delete(`review:${id}`);

        return json({ ok: true });
      }

      return err('not found', 404);
    } catch (e) {
      return err(e.message, 500);
    }
  },
};

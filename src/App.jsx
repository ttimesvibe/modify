import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─── Config ───
const WORKER_URL = 'https://modify.ttimes6000.workers.dev'; // e.g. https://video-review.xxx.workers.dev
const AUTOSAVE_DELAY = 180_000; // 3분

// ─── Styles ───
const T = {
  bg: '#0F1117',
  surface: '#1A1D27',
  surfaceAlt: '#242836',
  border: '#2E3348',
  borderHover: '#454B66',
  text: '#E8E9ED',
  textDim: '#8B90A5',
  textMuted: '#5E6380',
  accent: '#6C9CFC',
  accentDim: '#4A7AE0',
  accentBg: 'rgba(108,156,252,0.08)',
  red: '#F87171',
  redBg: 'rgba(248,113,113,0.1)',
  yellow: '#FBBF24',
  yellowBg: 'rgba(251,191,36,0.1)',
  green: '#34D399',
  greenBg: 'rgba(52,211,153,0.1)',
  checkedBg: '#161922',
  checkedBorder: '#1E2230',
  fontMono: "'JetBrains Mono', 'Fira Code', monospace",
  fontBody: "'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif",
};

const CATEGORIES = [
  { value: 'subtitle', label: '자막', icon: '💬' },
  { value: 'cut', label: '컷편집', icon: '✂️' },
  { value: 'graphic', label: '그래픽', icon: '🎨' },
  { value: 'audio', label: '오디오', icon: '🔊' },
  { value: 'etc', label: '기타', icon: '📌' },
];

// 카테고리별 색상 (우선순위 제거 — 카테고리로 좌측 보더 색상 결정)
const CAT_COLORS = {
  subtitle: { color: '#F87171', bg: 'rgba(248,113,113,0.1)' },
  cut: { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' },
  graphic: { color: '#A78BFA', bg: 'rgba(167,139,250,0.1)' },
  audio: { color: '#34D399', bg: 'rgba(52,211,153,0.1)' },
  etc: { color: '#6C9CFC', bg: 'rgba(108,156,252,0.1)' },
};

// ─── Helpers ───
function genId() { return Math.random().toString(36).slice(2, 10); }

function fmtTime(sec) {
  if (sec == null) return '--:--';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${m}:${String(ss).padStart(2,'0')}`;
}

function parseYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/v\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function resizeImage(blob, maxW = 640, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(maxW / img.width, 1);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((b) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(b);
      }, 'image/jpeg', quality);
    };
    img.src = URL.createObjectURL(blob);
  });
}

async function api(path, opts = {}) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

// ─── Components ───

function YouTubePlayer({ videoId, onPlayerReady }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    if (!videoId) return;

    const initPlayer = () => {
      if (playerRef.current) { playerRef.current.destroy(); }
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: { onReady: () => onPlayerReady(playerRef.current) },
      });
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => { if (playerRef.current) playerRef.current.destroy(); };
  }, [videoId]);

  return (
    <div style={{ position: 'relative', paddingTop: '56.25%', background: '#000', borderRadius: 12, overflow: 'hidden', border: `1px solid ${T.border}` }}>
      <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
    </div>
  );
}

function CardForm({ onSubmit, currentTime, onCancel }) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('subtitle');
  const [imageData, setImageData] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [tsStart, setTsStart] = useState(currentTime ?? 0);
  const [tsEnd, setTsEnd] = useState('');
  const textRef = useRef(null);

  useEffect(() => { textRef.current?.focus(); }, []);

  // Ctrl+V 이미지 붙여넣기
  useEffect(() => {
    const handler = async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          const b64 = await resizeImage(blob);
          setImageData(b64);
          setImagePreview(`data:image/jpeg;base64,${b64}`);
          break;
        }
      }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, []);

  const handleSubmit = () => {
    if (!content.trim()) return;
    onSubmit({
      id: genId(),
      timestamp: tsStart,
      timestampEnd: tsEnd !== '' ? parseFloat(tsEnd) : null,
      content: content.trim(),
      category,
      hasImage: !!imageData,
      imageData: imageData || null,
      checked: false,
      reply: '',
      createdAt: new Date().toISOString(),
    });
    setContent(''); setImageData(null); setImagePreview(null);
  };

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 12,
      padding: 20, marginBottom: 16,
      boxShadow: `0 0 20px rgba(108,156,252,0.06)`,
    }}>
      {/* 타임스탬프 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: T.textMuted, fontSize: 12, fontFamily: T.fontBody }}>시작</span>
          <input
            type="text" value={fmtTime(tsStart)}
            onChange={e => {
              const p = e.target.value.split(':').map(Number);
              if (p.length === 2) setTsStart(p[0] * 60 + p[1]);
              else if (p.length === 3) setTsStart(p[0] * 3600 + p[1] * 60 + p[2]);
            }}
            style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
              color: T.accent, fontFamily: T.fontMono, fontSize: 14, padding: '4px 8px',
              width: 72, textAlign: 'center',
            }}
          />
        </div>
        <span style={{ color: T.textMuted }}>~</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: T.textMuted, fontSize: 12, fontFamily: T.fontBody }}>끝</span>
          <input
            type="text" placeholder="선택"
            value={tsEnd !== '' ? fmtTime(tsEnd) : ''}
            onChange={e => {
              if (!e.target.value) { setTsEnd(''); return; }
              const p = e.target.value.split(':').map(Number);
              if (p.length === 2) setTsEnd(p[0] * 60 + p[1]);
              else if (p.length === 3) setTsEnd(p[0] * 3600 + p[1] * 60 + p[2]);
            }}
            style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
              color: T.text, fontFamily: T.fontMono, fontSize: 14, padding: '4px 8px',
              width: 72, textAlign: 'center',
            }}
          />
        </div>
      </div>

      {/* 카테고리 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => (
          <button key={c.value} onClick={() => setCategory(c.value)}
            style={{
              background: category === c.value ? T.accentBg : T.surfaceAlt,
              border: `1px solid ${category === c.value ? T.accent : T.border}`,
              borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
              color: category === c.value ? T.accent : T.textDim, fontSize: 13,
              fontFamily: T.fontBody, transition: 'all 0.15s',
            }}
          >{c.icon} {c.label}</button>
        ))}
      </div>

      {/* 이미지 프리뷰 */}
      {imagePreview && (
        <div style={{ marginBottom: 14, position: 'relative', display: 'inline-block' }}>
          <img src={imagePreview} alt="캡처" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, border: `1px solid ${T.border}` }} />
          <button onClick={() => { setImageData(null); setImagePreview(null); }}
            style={{
              position: 'absolute', top: -8, right: -8,
              background: T.red, color: '#fff', border: 'none', borderRadius: '50%',
              width: 22, height: 22, cursor: 'pointer', fontSize: 12, lineHeight: '22px',
            }}>✕</button>
        </div>
      )}
      {!imagePreview && (
        <div style={{
          border: `1px dashed ${T.border}`, borderRadius: 8, padding: '12px 16px',
          marginBottom: 14, color: T.textMuted, fontSize: 13, textAlign: 'center',
          fontFamily: T.fontBody,
        }}>
          📋 Ctrl+V로 캡처 이미지 붙여넣기
        </div>
      )}

      {/* 수정 내용 */}
      <textarea
        ref={textRef}
        value={content} onChange={e => setContent(e.target.value)}
        placeholder="수정 내용을 입력하세요..."
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
        style={{
          width: '100%', minHeight: 80, background: T.surfaceAlt, border: `1px solid ${T.border}`,
          borderRadius: 8, color: T.text, fontFamily: T.fontBody, fontSize: 14,
          padding: 12, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
        }}
      />

      {/* 버튼 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button onClick={onCancel}
          style={{
            background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8,
            color: T.textDim, padding: '8px 16px', cursor: 'pointer', fontSize: 13,
            fontFamily: T.fontBody,
          }}>취소</button>
        <button onClick={handleSubmit}
          style={{
            background: T.accent, border: 'none', borderRadius: 8,
            color: '#fff', padding: '8px 20px', cursor: 'pointer', fontSize: 13,
            fontFamily: T.fontBody, fontWeight: 600,
          }}>추가 (⌘↵)</button>
      </div>
    </div>
  );
}

function ReviewCard({ card, onCheck, onReply, onDelete, onSeek, onEdit, images }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(card.content);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState(card.reply || '');
  const cat = CATEGORIES.find(c => c.value === card.category) || CATEGORIES[4];
  const catColor = CAT_COLORS[card.category] || CAT_COLORS.etc;
  const imgSrc = images[card.id];

  return (
    <div style={{
      background: card.checked ? T.checkedBg : T.surface,
      border: `1px solid ${card.checked ? T.checkedBorder : T.border}`,
      borderRadius: 12, padding: 16, marginBottom: 10,
      opacity: card.checked ? 0.65 : 1,
      transition: 'all 0.2s',
      borderLeft: `3px solid ${catColor.color}`,
    }}>
      {/* 헤더: 타임스탬프 + 카테고리 + 우선순위 + 체크 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => onSeek(card.timestamp)}
            style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
              color: T.accent, fontFamily: T.fontMono, fontSize: 13, padding: '3px 8px',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.target.style.borderColor = T.accent}
            onMouseLeave={e => e.target.style.borderColor = T.border}
          >
            ▶ {fmtTime(card.timestamp)}
            {card.timestampEnd != null && `~${fmtTime(card.timestampEnd)}`}
          </button>
          <span style={{
            fontSize: 12, color: catColor.color, background: catColor.bg,
            padding: '2px 8px', borderRadius: 4, fontFamily: T.fontBody,
          }}>{cat.icon} {cat.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => onDelete(card.id)} title="삭제"
            style={{
              background: 'transparent', border: 'none', color: T.textMuted,
              cursor: 'pointer', fontSize: 14, padding: 4, opacity: 0.5,
            }}
            onMouseEnter={e => e.target.style.opacity = 1}
            onMouseLeave={e => e.target.style.opacity = 0.5}
          >🗑</button>
          <button onClick={() => onCheck(card.id)}
            style={{
              borderRadius: 6, padding: '4px 10px',
              background: card.checked ? T.green : 'transparent',
              border: `2px solid ${card.checked ? T.green : T.border}`,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              color: card.checked ? '#fff' : T.textMuted, fontSize: 12, transition: 'all 0.15s',
              fontFamily: T.fontBody,
            }}
          >{card.checked ? '✓' : '☐'} 편집 완료 체크</button>
        </div>
      </div>

      {/* 캡처 이미지 */}
      {card.hasImage && imgSrc && (
        <img src={`data:image/jpeg;base64,${imgSrc}`} alt="캡처"
          style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8, marginBottom: 10, border: `1px solid ${T.border}` }} />
      )}
      {card.hasImage && !imgSrc && (
        <div style={{
          background: T.surfaceAlt, borderRadius: 8, padding: 20, marginBottom: 10,
          textAlign: 'center', color: T.textMuted, fontSize: 13,
        }}>이미지 로딩 중...</div>
      )}

      {/* 수정 내용 */}
      {editing ? (
        <div style={{ marginBottom: 8 }}>
          <textarea value={editText} onChange={e => setEditText(e.target.value)}
            style={{
              width: '100%', minHeight: 60, background: T.surfaceAlt, border: `1px solid ${T.accent}`,
              borderRadius: 8, color: T.text, fontFamily: T.fontBody, fontSize: 14,
              padding: 10, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
            }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={() => { onEdit(card.id, editText); setEditing(false); }}
              style={{ background: T.accent, border: 'none', borderRadius: 6, color: '#fff', padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>저장</button>
            <button onClick={() => { setEditText(card.content); setEditing(false); }}
              style={{ background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textDim, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>취소</button>
          </div>
        </div>
      ) : (
        <p onClick={() => setEditing(true)}
          style={{
            color: card.checked ? T.textMuted : T.text, fontSize: 14, lineHeight: 1.6,
            margin: '0 0 8px 0', cursor: 'pointer', fontFamily: T.fontBody,
            textDecoration: card.checked ? 'line-through' : 'none',
            whiteSpace: 'pre-wrap',
          }}
          title="클릭하여 수정"
        >{card.content}</p>
      )}

      {/* 답변 */}
      {card.reply && !showReply && (
        <div onClick={() => setShowReply(true)}
          style={{
            background: T.accentBg, border: `1px solid ${T.border}`, borderRadius: 8,
            padding: '8px 12px', fontSize: 13, color: T.accent, cursor: 'pointer',
            fontFamily: T.fontBody,
          }}>
          💬 {card.reply}
        </div>
      )}
      {showReply && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <input value={replyText} onChange={e => setReplyText(e.target.value)}
            placeholder="답변 입력..."
            style={{
              flex: 1, background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
              color: T.text, fontFamily: T.fontBody, fontSize: 13, padding: '6px 10px', outline: 'none',
            }} />
          <button onClick={() => { onReply(card.id, replyText); setShowReply(false); }}
            style={{ background: T.accent, border: 'none', borderRadius: 6, color: '#fff', padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>저장</button>
        </div>
      )}
      {!card.reply && !showReply && (
        <button onClick={() => setShowReply(true)}
          style={{
            background: 'transparent', border: 'none', color: T.textMuted,
            fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: T.fontBody,
          }}>💬 답변 달기</button>
      )}
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const [view, setView] = useState('home'); // home | review
  const [sessionId, setSessionId] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoId, setVideoId] = useState('');
  const [title, setTitle] = useState('');
  const [cards, setCards] = useState([]);
  const [images, setImages] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [autoSaveStatus, setAutoSaveStatus] = useState('');
  const [filter, setFilter] = useState('all'); // all | unchecked | checked

  const playerRef = useRef(null);
  const autoSaveTimer = useRef(null);
  const lastSnapshot = useRef('');
  const sessionIdRef = useRef('');

  // URL 파라미터로 세션 로드
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('s');
    if (s) {
      loadSession(s);
    } else {
      loadSessions();
    }
  }, []);

  // sessionIdRef 동기화
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // 자동 저장 (카드 변경 감지)
  useEffect(() => {
    if (!sessionId || !cards.length) return;
    const snap = JSON.stringify(cards);
    if (snap === lastSnapshot.current) return;

    setAutoSaveStatus('⏳ 자동 저장 대기...');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        setAutoSaveStatus('💾 저장 중...');
        await api('/save', {
          method: 'POST',
          body: { id: sid, videoUrl, videoId, title, cards },
        });
        lastSnapshot.current = JSON.stringify(cards);
        setAutoSaveStatus('✓ 저장됨');
        setTimeout(() => setAutoSaveStatus(''), 3000);
      } catch { setAutoSaveStatus('❌ 저장 실패'); }
    }, AUTOSAVE_DELAY);

    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [cards, title]);

  async function loadSessions() {
    try {
      const data = await api('/sessions');
      setSessions(data);
    } catch { /* ignore */ }
  }

  async function loadSession(id) {
    try {
      const data = await api(`/load/${id}`);
      setSessionId(data.id);
      setVideoUrl(data.videoUrl || '');
      setVideoId(data.videoId || '');
      setTitle(data.title || '');
      setCards(data.cards || []);
      lastSnapshot.current = JSON.stringify(data.cards || []);
      setView('review');

      // 이미지 로드
      const imgCards = (data.cards || []).filter(c => c.hasImage);
      for (const c of imgCards) {
        try {
          const imgData = await api(`/image/${id}/${c.id}`);
          setImages(prev => ({ ...prev, [c.id]: imgData.imageData }));
        } catch { /* image missing */ }
      }
    } catch {
      alert('세션을 찾을 수 없습니다');
    }
  }

  async function handleStart() {
    const vid = parseYouTubeId(videoUrl);
    if (!vid) { alert('유효한 YouTube URL을 입력해주세요'); return; }
    const sid = genId();
    setVideoId(vid);
    setSessionId(sid);
    setCards([]);
    setImages({});
    lastSnapshot.current = '';
    setView('review');

    // 초기 저장
    await api('/save', {
      method: 'POST',
      body: { id: sid, videoUrl, videoId: vid, title: title || '새 리뷰', cards: [] },
    });

    // URL 업데이트
    window.history.replaceState(null, '', `?s=${sid}`);
  }

  function handlePlayerReady(player) {
    playerRef.current = player;
    // 주기적 시간 갱신
    setInterval(() => {
      if (playerRef.current?.getCurrentTime) {
        setCurrentTime(playerRef.current.getCurrentTime());
      }
    }, 500);
  }

  // 즉시 저장 (카드 추가/삭제/체크 시)
  async function saveNow(cardsToSave) {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      setAutoSaveStatus('💾 저장 중...');
      await api('/save', {
        method: 'POST',
        body: { id: sid, videoUrl, videoId, title, cards: cardsToSave },
      });
      lastSnapshot.current = JSON.stringify(cardsToSave);
      if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
      setAutoSaveStatus('✓ 저장됨');
      setTimeout(() => setAutoSaveStatus(''), 3000);
    } catch { setAutoSaveStatus('❌ 저장 실패'); }
  }

  async function handleAddCard(card) {
    const newCards = [...cards, card].sort((a, b) => a.timestamp - b.timestamp);
    setCards(newCards);
    setShowForm(false);

    // 이미지가 있으면 즉시 업로드
    if (card.imageData) {
      try {
        await api('/save-image', {
          method: 'POST',
          body: { sessionId, cardId: card.id, imageData: card.imageData },
        });
        setImages(prev => ({ ...prev, [card.id]: card.imageData }));
      } catch { console.error('image save failed'); }
    }

    // 즉시 저장
    await saveNow(newCards);
  }

  function handleCheck(cardId) {
    const newCards = cards.map(c => c.id === cardId ? { ...c, checked: !c.checked } : c);
    setCards(newCards);
    saveNow(newCards);
  }

  function handleReply(cardId, reply) {
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, reply } : c));
  }

  function handleEdit(cardId, content) {
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, content } : c));
  }

  async function handleDelete(cardId) {
    const card = cards.find(c => c.id === cardId);
    const newCards = cards.filter(c => c.id !== cardId);
    setCards(newCards);
    if (card?.hasImage) {
      try { await api(`/image/${sessionId}/${cardId}`, { method: 'DELETE' }); } catch {}
      setImages(prev => { const n = { ...prev }; delete n[cardId]; return n; });
    }
    // 즉시 저장
    await saveNow(newCards);
  }

  function handleSeek(sec) {
    if (playerRef.current?.seekTo) {
      playerRef.current.seekTo(sec, true);
      // 프레임이 로드될 때까지 잠깐 재생 후 정지
      playerRef.current.playVideo();
      setTimeout(() => {
        playerRef.current.pauseVideo();
      }, 300);
    }
  }

  async function handleShare() {
    const url = `${window.location.origin}${window.location.pathname}?s=${sessionId}`;
    try {
      // 저장 먼저
      await api('/save', {
        method: 'POST',
        body: { id: sessionId, videoUrl, videoId, title, cards },
      });
      lastSnapshot.current = JSON.stringify(cards);
      if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
      setAutoSaveStatus('✓ 저장됨');

      await navigator.clipboard.writeText(url);
      alert('공유 링크가 복사되었습니다:\n' + url);
    } catch {
      prompt('공유 링크:', url);
    }
  }

  function handleReset() {
    setView('home');
    setSessionId('');
    setVideoUrl('');
    setVideoId('');
    setTitle('');
    setCards([]);
    setImages({});
    setShowForm(false);
    lastSnapshot.current = '';
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    setAutoSaveStatus('');
    window.history.replaceState(null, '', window.location.pathname);
    loadSessions();
  }

  const filteredCards = cards.filter(c => {
    if (filter === 'unchecked') return !c.checked;
    if (filter === 'checked') return c.checked;
    return true;
  }).sort((a, b) => {
    // 편집 완료 체크된 카드는 맨 아래로, 각 그룹 내에서는 시간순
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    return a.timestamp - b.timestamp;
  });

  const stats = { total: cards.length, checked: cards.filter(c => c.checked).length };

  // ─── Home View ───
  if (view === 'home') {
    return (
      <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.fontBody }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '60px 20px' }}>
          <h1 style={{
            fontSize: 28, fontWeight: 700, marginBottom: 8,
            background: 'linear-gradient(135deg, #6C9CFC, #A78BFA)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Video Review</h1>
          <p style={{ color: T.textDim, fontSize: 14, marginBottom: 40 }}>
            영상 수정 사항을 건건이 기록하고 공유합니다
          </p>

          {/* 새 리뷰 */}
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
            padding: 24, marginBottom: 32,
          }}>
            <label style={{ fontSize: 13, color: T.textDim, display: 'block', marginBottom: 8 }}>YouTube URL</label>
            <input
              value={videoUrl} onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              style={{
                width: '100%', background: T.surfaceAlt, border: `1px solid ${T.border}`,
                borderRadius: 8, color: T.text, fontFamily: T.fontMono, fontSize: 14,
                padding: '10px 14px', outline: 'none', boxSizing: 'border-box', marginBottom: 12,
              }}
            />
            <label style={{ fontSize: 13, color: T.textDim, display: 'block', marginBottom: 8 }}>리뷰 제목 (선택)</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="예: 박종천 2편 최종 리뷰"
              style={{
                width: '100%', background: T.surfaceAlt, border: `1px solid ${T.border}`,
                borderRadius: 8, color: T.text, fontFamily: T.fontBody, fontSize: 14,
                padding: '10px 14px', outline: 'none', boxSizing: 'border-box', marginBottom: 16,
              }}
            />
            <button onClick={handleStart}
              style={{
                width: '100%', background: T.accent, border: 'none', borderRadius: 8,
                color: '#fff', padding: '12px 0', cursor: 'pointer', fontSize: 15,
                fontWeight: 600, fontFamily: T.fontBody,
              }}>리뷰 시작</button>
          </div>

          {/* 이전 세션 */}
          {sessions.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, color: T.textDim, marginBottom: 12, fontWeight: 500 }}>최근 리뷰</h3>
              {sessions.map(s => (
                <div key={s.id} onClick={() => loadSession(s.id)}
                  style={{
                    background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
                    padding: '14px 16px', marginBottom: 8, cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = T.borderHover}
                  onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{s.title || '제목 없음'}</div>
                    <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>
                      {s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('ko') : ''}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 13, color: (s.checked || 0) === (s.total || 0) ? T.green : T.textDim,
                    fontFamily: T.fontMono,
                  }}>
                    {s.checked || 0}/{s.total || 0}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Review View ───
  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.fontBody }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '16px 16px 80px' }}>

        {/* 헤더 */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 16, flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={handleReset}
              style={{
                background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 6,
                color: T.textDim, padding: '4px 10px', cursor: 'pointer', fontSize: 13,
              }}>← 홈</button>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="리뷰 제목"
              style={{
                background: 'transparent', border: 'none', color: T.text, fontSize: 17,
                fontWeight: 600, outline: 'none', fontFamily: T.fontBody, width: 240,
              }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {autoSaveStatus && (
              <span style={{ fontSize: 12, color: T.textMuted }}>{autoSaveStatus}</span>
            )}
            <span style={{
              fontSize: 13, fontFamily: T.fontMono,
              color: stats.checked === stats.total && stats.total > 0 ? T.green : T.textDim,
            }}>
              {stats.checked}/{stats.total}
            </span>
            <button onClick={handleShare}
              style={{
                background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
                color: T.text, padding: '6px 12px', cursor: 'pointer', fontSize: 13,
              }}>🔗 공유</button>
          </div>
        </div>

        {/* YouTube Player */}
        <div style={{ marginBottom: 16 }}>
          <YouTubePlayer videoId={videoId} onPlayerReady={handlePlayerReady} />
        </div>

        {/* 수정 요청 추가 버튼 */}
        {!showForm ? (
          <button onClick={() => setShowForm(true)}
            style={{
              width: '100%', background: T.surface, border: `1px dashed ${T.border}`,
              borderRadius: 10, padding: '14px 0', cursor: 'pointer',
              color: T.accent, fontSize: 14, fontFamily: T.fontBody,
              marginBottom: 16, transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.target.style.borderColor = T.accent}
            onMouseLeave={e => e.target.style.borderColor = T.border}
          >
            ➕ 수정 요청 추가 &nbsp;
            <span style={{ color: T.textMuted, fontFamily: T.fontMono, fontSize: 13 }}>
              (현재 ▶ {fmtTime(currentTime)})
            </span>
          </button>
        ) : (
          <CardForm
            currentTime={currentTime}
            onSubmit={handleAddCard}
            onCancel={() => setShowForm(false)}
          />
        )}

        {/* 필터 */}
        {cards.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {[
              { v: 'all', l: `전체 (${stats.total})` },
              { v: 'unchecked', l: `미완료 (${stats.total - stats.checked})` },
              { v: 'checked', l: `완료 (${stats.checked})` },
            ].map(f => (
              <button key={f.v} onClick={() => setFilter(f.v)}
                style={{
                  background: filter === f.v ? T.accentBg : 'transparent',
                  border: `1px solid ${filter === f.v ? T.accent : T.border}`,
                  borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                  color: filter === f.v ? T.accent : T.textDim, fontSize: 12,
                  fontFamily: T.fontBody,
                }}>{f.l}</button>
            ))}
          </div>
        )}

        {/* 카드 리스트 */}
        {filteredCards.map(card => (
          <ReviewCard
            key={card.id}
            card={card}
            images={images}
            onCheck={handleCheck}
            onReply={handleReply}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onSeek={handleSeek}
          />
        ))}

        {cards.length === 0 && (
          <div style={{
            textAlign: 'center', padding: 60, color: T.textMuted, fontSize: 14,
          }}>
            영상을 보면서 수정할 부분이 있으면<br />
            위 버튼을 눌러 추가해주세요
          </div>
        )}
      </div>
    </div>
  );
}

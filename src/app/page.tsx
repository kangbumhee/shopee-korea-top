'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';

interface Product {
  id: number; sid: number; nm: string; img: string;
  pr: number; pMin: number; pMax: number; pOld: number; disc: string;
  sold: number; hist: number; like: number; rate: number; rv: number;
  sn: string; sl: string; off: boolean; pref: boolean;
  cat: string; catBig: string; catId: number;
}

interface CountryMeta {
  country: string; name: string; domain: string; currency: string;
  supported: boolean; collected: string; totalProducts: number; totalSellers: number;
  categories: { big: [string, number][]; mid: [string, number][] };
}

interface CountryData { meta: CountryMeta; products: Product[]; }

const COUNTRIES: Record<string, { flag: string; name: string }> = {
  sg: { flag: '🇸🇬', name: 'Singapore' },
  my: { flag: '🇲🇾', name: 'Malaysia' },
  th: { flag: '🇹🇭', name: 'Thailand' },
  ph: { flag: '🇵🇭', name: 'Philippines' },
  tw: { flag: '🇹🇼', name: 'Taiwan' },
  vn: { flag: '🇻🇳', name: 'Vietnam' },
  br: { flag: '🇧🇷', name: 'Brazil' },
  mx: { flag: '🇲🇽', name: 'Mexico' },
};

function imgUrl(key: string, country: string) {
  if (!key) return '';
  if (key.startsWith('http')) return key;
  const cc = country === 'tw' ? 'tw' : country === 'my' ? 'my' : country === 'th' ? 'th' : country === 'vn' ? 'vn' : country === 'ph' ? 'ph' : country === 'br' ? 'br' : country === 'mx' ? 'mx' : 'sg';
  return `https://down-${cc}.img.susercontent.com/file/${key}`;
}

export default function Home() {
  const [index, setIndex] = useState<Record<string, CountryMeta>>({});
  const [activeCountry, setActiveCountry] = useState('sg');
  const [data, setData] = useState<CountryData | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [catBig, setCatBig] = useState('');
  const [catMid, setCatMid] = useState('');
  const [sortBy, setSortBy] = useState('sold_d');
  const [minSold, setMinSold] = useState(0);
  const [excludeMall, setExcludeMall] = useState(false);
  const [onlyPreferred, setOnlyPreferred] = useState(false);
  const [showCount, setShowCount] = useState(200);

  // 인덱스 로드
  useEffect(() => {
    fetch('/data/index.json').then(r => r.json()).then(setIndex).catch(() => {});
  }, []);

  // 나라별 데이터 로드
  useEffect(() => {
    setLoading(true);
    setShowCount(200);
    fetch(`/data/${activeCountry}.json`)
      .then(r => r.json())
      .then((d: CountryData) => { setData(d); setLoading(false); })
      .catch(() => { setData(null); setLoading(false); });
  }, [activeCountry]);

  // 필터 리셋
  useEffect(() => { setCatBig(''); setCatMid(''); setSearch(''); }, [activeCountry]);

  const filtered = useMemo(() => {
    if (!data?.products) return [];
    const q = search.toLowerCase();
    let f = data.products.filter(p => {
      if (p.sold < minSold) return false;
      if (catBig && p.catBig !== catBig) return false;
      if (catMid && p.cat !== catMid) return false;
      if (excludeMall && p.off) return false;
      if (onlyPreferred && !p.pref) return false;
      if (q && !p.nm.toLowerCase().includes(q) && !p.sn.toLowerCase().includes(q)) return false;
      return true;
    });
    const [key, dir] = sortBy.split('_');
    const m: Record<string, (p: Product) => number> = {
      sold: p => p.sold, hist: p => p.hist, price: p => p.pr, rate: p => p.rate, like: p => p.like,
    };
    const fn = m[key] || m.sold;
    f.sort((a, b) => dir === 'a' ? fn(a) - fn(b) : fn(b) - fn(a));
    return f;
  }, [data, search, catBig, catMid, sortBy, minSold, excludeMall, onlyPreferred]);

  // 대분류 선택 시 해당 중분류만 필터링
  const filteredMidCats = useMemo(() => {
    if (!data?.products) return data?.meta?.categories?.mid || [];
    if (!catBig) return data.meta.categories.mid || [];

    const midCount: Record<string, number> = {};
    data.products.forEach(p => {
      if (p.catBig === catBig) {
        const m = p.cat || '기타';
        midCount[m] = (midCount[m] || 0) + 1;
      }
    });
    return Object.entries(midCount).sort((a, b) => b[1] - a[1]) as [string, number][];
  }, [data, catBig]);

  const handleScroll = useCallback(() => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) {
      setShowCount(c => Math.min(c + 100, filtered.length));
    }
  }, [filtered.length]);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const meta = data?.meta;
  const currency = meta?.currency || 'SGD';
  const domain = meta?.domain || 'shopee.sg';

  const exportCSV = () => {
    let csv = '\uFEFF순위,상품명,셀러,대분류,중분류,가격,월판매,누적,평점,리뷰,좋아요,할인,Mall,Preferred,URL\n';
    filtered.forEach((p, i) => {
      csv += `${i+1},"${(p.nm||'').replace(/"/g,'""')}","${p.sn}","${p.catBig}","${p.cat}",${p.pr.toFixed(2)},${p.sold},${p.hist},${p.rate?.toFixed(1)||''},${p.rv},${p.like},${p.disc},${p.off},${p.pref},https://${domain}/product/${p.sid}/${p.id}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `shopee_korea_${activeCountry}_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ meta: data?.meta, products: filtered }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `shopee_korea_${activeCountry}_${new Date().toISOString().split('T')[0]}.json`; a.click();
  };

  return (
    <>
      {/* Header */}
      <div className="header">
        <h1><em>Korea Top</em></h1>
        <div className="stats">
          {meta ? (
            <>총 <b>{meta.totalProducts?.toLocaleString()}</b>개 | <b>{meta.totalSellers}</b>셀러 | 수집: {new Date(meta.collected).toLocaleString('ko-KR')}</>
          ) : '데이터 로딩중...'}
        </div>
      </div>

      {/* Country Tabs */}
      <div className="country-tabs">
        {Object.entries(COUNTRIES).map(([code, { flag, name }]) => {
          const meta = index[code];
          const supported = meta?.supported !== false;
          const count = meta?.totalProducts || 0;
          return (
            <div
              key={code}
              className={`country-tab ${activeCountry === code ? 'active' : ''} ${!supported && count === 0 ? 'disabled' : ''}`}
              onClick={() => supported && setActiveCountry(code)}
            >
              {flag} {name}
              <span className="cnt">{count > 0 ? count.toLocaleString() : supported ? '...' : 'N/A'}</span>
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="controls">
        <input type="text" placeholder="🔍 상품명, 셀러명..." value={search} onChange={e => setSearch(e.target.value)} />
        <select value={catBig} onChange={e => { setCatBig(e.target.value); setCatMid(''); }}>
          <option value="">전체 대분류</option>
          {(meta?.categories?.big || []).map(([name, cnt]) => (
            <option key={name} value={name}>{name} ({cnt})</option>
          ))}
        </select>
        <select value={catMid} onChange={e => { setCatMid(e.target.value); }}>
          <option value="">전체 중분류</option>
          {filteredMidCats.map(([name, cnt]) => (
            <option key={name} value={name}>{name} ({cnt})</option>
          ))}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="sold_d">월판매↓</option>
          <option value="sold_a">월판매↑</option>
          <option value="hist_d">누적↓</option>
          <option value="price_a">가격↑</option>
          <option value="price_d">가격↓</option>
          <option value="rate_d">평점↓</option>
          <option value="like_d">좋아요↓</option>
        </select>
        <select value={minSold} onChange={e => setMinSold(Number(e.target.value))}>
          <option value={0}>전체</option>
          <option value={10}>월10+</option>
          <option value={50}>월50+</option>
          <option value={100}>월100+</option>
          <option value={500}>월500+</option>
          <option value={1000}>월1K+</option>
          <option value={5000}>월5K+</option>
        </select>
        <button className={`tog ${excludeMall ? 'active' : ''}`} onClick={() => setExcludeMall(!excludeMall)}>🏢 Mall제외</button>
        <button className={`tog ${onlyPreferred ? 'active' : ''}`} onClick={() => setOnlyPreferred(!onlyPreferred)}>⭐ Preferred</button>
        <button className="btn" onClick={exportJSON}>📦 JSON</button>
        <button className="btn btn-fill" onClick={exportCSV}>📁 CSV</button>
      </div>

      {/* Filter Count */}
      <div className="filter-count">
        표시: <b>{Math.min(showCount, filtered.length)}</b> / {filtered.length}개
        {excludeMall && ' | 🏢Mall제외'}{onlyPreferred && ' | ⭐Preferred만'}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="loading">로딩중...</div>
      ) : (
        <div className="grid">
          {filtered.slice(0, showCount).map((p, i) => {
            const r = i + 1;
            const url = `https://${domain}/product/${p.sid}/${p.id}`;
            return (
              <div key={p.id} className="card" onClick={() => window.open(url, '_blank')}>
                <div className={`rank ${r <= 3 ? 'top3' : ''}`}>#{r}</div>
                <div className="badges">
                  {p.off && <span className="badge badge-mall">Mall</span>}
                  {p.pref && <span className="badge badge-pref">Preferred+</span>}
                  {p.disc && <span className="badge badge-disc">{p.disc}</span>}
                </div>
                <div className="img-wrap">
                  <img src={imgUrl(p.img, activeCountry)} loading="lazy" alt="" onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }} />
                  <div className="sold-badge">🔥 {p.sold.toLocaleString()} /mo</div>
                  {p.cat && <div className="cat-tag">{p.cat}</div>}
                </div>
                <div className="info">
                  <div className="title">{p.nm}</div>
                  <div className="price-row">
                    <span className="price-now">
                      {p.pMin !== p.pMax ? `${currency} ${p.pMin.toFixed(2)}~${p.pMax.toFixed(2)}` : `${currency} ${p.pr.toFixed(2)}`}
                    </span>
                    {p.pOld > p.pr && <span className="price-old">{currency} {p.pOld.toFixed(2)}</span>}
                  </div>
                  <div className="meta-row">
                    <span>⭐{p.rate ? p.rate.toFixed(1) : '-'} ({p.rv.toLocaleString()})</span>
                    <span>❤️{p.like.toLocaleString()}</span>
                    <span>누적{p.hist.toLocaleString()}</span>
                  </div>
                  <div className="shop-row">
                    <span>🏪</span>
                    <span className="shop-name">{p.sn}</span>
                    <span style={{ marginLeft: 'auto', color: '#ff6633' }}>📍{p.sl || 'KR'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="footer">
        Korea Top · 자동 수집
      </div>
    </>
  );
}
